"use strict";
// =========================================================================
// Aides communes des tests navigateur (voir run.cjs pour le lanceur).
//
// Leçons apprises pendant leur écriture, encodées ici pour ne pas les
// réapprendre :
// - TOUJOURS accepter les dialogues (page.on("dialog")) : un alert() non géré
//   fige la session CDP entière, le test semble « pendre ».
// - Un profil Edge neuf n'a AUCUNE donnée FleetYards : forcer
//   syncFleetyardsCargoHolds() avant tout test du visualiseur, sinon la scène
//   est vide et le test ne prouve rien.
// - Les sondes du visualiseur (__cargoViewerTestProbe...) n'existent qu'avec
//   ?probes=1 dans l'URL (voir js/cargo-viewer.js) — openApp l'ajoute.
// - activateTab passe par document.startViewTransition : asynchrone, et qui
//   s'ANNULE en headless — openApp la rend synchrone, et switchTab attend que
//   le panneau soit réellement affiché.
// - page.click() sur un élément masqué attend indéfiniment sa visibilité :
//   cliquer les onglets via switchTab (page.evaluate + el.click()).
// =========================================================================
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Lus dans le source plutôt que recopiés : si l'app change de clé de stockage
// ou de version de schéma, les tests suivent sans édition (et sans neutraliser
// la synchro par erreur avec une valeur périmée — voir openApp).
const APP_JS = fs.readFileSync(path.join(REPO_ROOT, "js", "app.js"), "utf8");
const readConst = (name, re) => {
  const m = APP_JS.match(re);
  if (!m) throw new Error(`${name} introuvable dans js/app.js — les tests doivent être mis à jour`);
  return m[1];
};
const STORAGE_KEY = readConst("STORAGE_KEY", /const STORAGE_KEY = "([^"]+)"/);
const DATA_SCHEMA_VERSION = Number(readConst("DATA_SCHEMA_VERSION", /const DATA_SCHEMA_VERSION = (\d+)/));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

// Petit serveur statique sans dépendance : sert la racine du dépôt telle
// quelle, comme GitHub Pages. Port dédié pour ne pas gêner un serveur de dev
// (python -m http.server 8080) éventuellement déjà lancé.
function startStaticServer(port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(REPO_ROOT, urlPath === "/" ? "index.html" : urlPath);
    if (!filePath.startsWith(REPO_ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function findEdge() {
  const candidates = [
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error("msedge.exe introuvable — définir EDGE_PATH");
  return found;
}

// Lance Edge headless sur un profil NEUF (déterminisme : pas de cache, pas de
// session) et attend que l'endpoint CDP réponde.
async function launchEdge(cdpPort) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sc-cargo-tests-"));
  const child = spawn(
    findEdge(),
    [
      "--headless=new",
      "--disable-gpu",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${cdpPort}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${cdpPort}/json/version`, (r) => {
          r.resume();
          r.statusCode === 200 ? resolve() : reject(new Error(String(r.statusCode)));
        }).on("error", reject);
      });
      break;
    } catch (e) {
      if (Date.now() > deadline) throw new Error("Edge/CDP ne répond pas : " + e.message);
      await sleep(300);
    }
  }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}` });
  const kill = () => {
    try {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    } catch (e) {
      /* déjà mort */
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      /* verrouillé par un reste de processus — le tmp sera nettoyé par l'OS */
    }
  };
  return { browser, kill };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ouvre l'app sur une page neuve : dialogues acceptés (et mémorisés), erreurs
// JS collectées, sondes activées (?probes=1) sauf demande contraire, et
// synchro FleetYards forcée (profil neuf = aucune donnée) sauf skipSync.
async function openApp(ctx, { probes = true, skipSync = false } = {}) {
  const page = await ctx.browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  // Avant TOUT script de la page (evaluateOnNewDocument) :
  // 1. vider le localStorage — il est partagé par tout le profil Edge, donc
  //    sans ça une suite hérite de l'état sauvegardé par la précédente ;
  // 2. rendre les transitions de vue SYNCHRONES. document.startViewTransition
  //    (utilisé par activateTab) est asynchrone et s'annule en headless
  //    (« Transition was aborted because of invalid state ») : la bascule
  //    d'onglet n'avait alors pas lieu, le canvas restait masqué et tout
  //    glisser souris tombait dans le vide. On teste la logique de l'app,
  //    pas l'animation du navigateur.
  await page.evaluateOnNewDocument(
    (storageKey, schemaVersion) => {
      try {
        localStorage.clear();
        // Neutralise la synchro d'ARRIÈRE-PLAN (maybeAutoSync) : elle ne part
        // que si le cache UEX est périmé OU si dataSchemaVersion a changé. On
        // sème donc un état « déjà frais ». Sinon runFullSync se termine au
        // milieu d'un test et rappelle renderAll(), ce qui reconstruit la
        // scène 3D — la cible du glisser disparaît et le geste tombe dans le
        // vide. C'était la cause d'échecs INTERMITTENTS qui se déplaçaient
        // d'une suite à l'autre. Les données dont les tests ont besoin sont
        // chargées explicitement (syncFleetyardsCargoHolds dans openApp).
        localStorage.setItem(
          storageKey,
          JSON.stringify({ uexSyncedAt: Date.now(), dataSchemaVersion: schemaVersion })
        );
      } catch (e) {
        /* premier chargement : rien à vider */
      }
      document.startViewTransition = (cb) => {
        cb();
        const done = Promise.resolve();
        return { finished: done, ready: done, updateCallbackDone: done, skipTransition() {} };
      };
    },
    STORAGE_KEY,
    DATA_SCHEMA_VERSION
  );
  // L'app n'utilise plus alert()/confirm() (voir js/ui-feedback.js), mais on
  // garde ce filet : si un appel réapparaît, un dialogue non géré FIGERAIT la
  // session CDP au lieu d'échouer proprement.
  const alerts = [];
  const errors = [];
  page.on("dialog", (d) => {
    alerts.push(d.message());
    d.accept();
  });
  // Erreurs remontées par le NAVIGATEUR lui-même, jamais par le site : une
  // extension Edge qui parle à un service worker absent. Observé une fois sur
  // sept passages, sur une suite différente à chaque fois. Les laisser passer
  // faisait échouer une suite au hasard pour une cause étrangère au produit.
  const BRUIT_NAVIGATEUR = [/Could not establish connection\. Receiving end does not exist/i];
  page.on("pageerror", (e) => {
    if (BRUIT_NAVIGATEUR.some((re) => re.test(e.message))) return;
    errors.push(e.message);
  });

  // Journal des toasts. Ils s'effacent tout seuls au bout de quelques
  // secondes : lire le DOM au moment de l'assertion raterait un message paru
  // plus tôt dans le test. On les enregistre donc à leur apparition.
  await page.evaluateOnNewDocument(() => {
    window.__toastLog = [];
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType === 1 && node.classList.contains("toast")) {
            const kind = (node.className.match(/toast-(success|error|info)/) || [])[1] || "info";
            window.__toastLog.push({ kind, text: node.querySelector(".toast-text").textContent });
          }
        }
      }
      // On observe `document` et non `document.documentElement` : ce script
      // s'exécute avant TOUT contenu de la page, l'élément racine n'existe
      // pas encore (« parameter 1 is not of type 'Node' »).
    }).observe(document, { childList: true, subtree: true });
  });

  await page.goto(`${ctx.baseUrl}/${probes ? "?probes=1" : ""}`, { waitUntil: "networkidle0", timeout: 60000 });
  if (!skipSync) {
    await page.evaluate(async () => {
      await syncFleetyardsCargoHolds();
    });
  }
  const toasts = () => page.evaluate(() => window.__toastLog.slice());
  return { page, alerts, errors, toasts };
}

// Bascule d'onglet + attente que le panneau soit RÉELLEMENT affiché. On ne
// clique pas via page.click() : un bouton d'onglet masqué (ex. Propositions
// pour un non-admin) ferait attendre puppeteer indéfiniment sa visibilité.
async function switchTab(page, tabId) {
  await page.evaluate((id) => {
    const btn = document.querySelector(`[data-tab="${id}"]`);
    if (btn) btn.click();
  }, tabId);
  await page.waitForFunction((id) => document.getElementById(id).style.display !== "none", { timeout: 5000 }, tabId);
}

// Coordonnées écran d'une cible de glisser, une fois la vue STABILISÉE.
// __cargoViewerTestProbe projette la position du module avec la caméra
// courante : juste après un changement de vue (setCargoViewerView), la caméra
// bouge encore et la projection est périmée — le glisser tombe alors à côté et
// le raycast ne touche rien. Symptôme observé : un test qui passe une fois sur
// deux. On attend donc deux lectures consécutives identiques plutôt qu'un
// sleep arbitraire.
async function stableProbe(page, { tries = 40, delay = 100 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const p = await page.evaluate(() => window.__cargoViewerTestProbe());
    if (!p) throw new Error("sonde indisponible (?probes=1 manquant ou scène vide)");
    const rounded = { x: Math.round(p.x), y: Math.round(p.y) };
    if (last && last.x === rounded.x && last.y === rounded.y) return { ...p, ...rounded };
    last = rounded;
    await sleep(delay);
  }
  throw new Error("la vue ne se stabilise pas (sonde toujours mouvante)");
}

// Glisser souris réel sur la cible courante du visualiseur, en partant d'une
// position stabilisée.
async function dragFrom(page, dx, dy) {
  // Amène le visualiseur dans le viewport AVANT de projeter la cible : la vue
  // 3D fait 560px de haut et, selon la hauteur de l'en-tête (qui varie avec ce
  // qu'il contient), son bas peut passer sous la ligne de flottaison. La cible
  // du glisser tomberait alors hors écran et le geste dans le vide. Ne dépend
  // plus d'un budget de hauteur d'en-tête — un vrai joueur fait défiler de
  // toute façon pour atteindre la vue.
  await page.evaluate(() => {
    const el = document.getElementById("cargo-viewer-3d");
    if (el) el.scrollIntoView({ block: "center" });
  });
  const p = await stableProbe(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 4 });
  await page.mouse.up();
  await sleep(200);
  return p;
}

// Construit un vrai rangement (mission -> optimisation -> rangement) : l'état
// qu'exigent renderCargoStepView et les tests de proposition. Vaisseau par
// défaut : Caterpillar (14 soutes, noms distincts).
async function buildPackedState(page, ship = "Caterpillar") {
  const loc = await page.evaluate(() => {
    const o = Array.from(document.querySelectorAll("#locations-datalist option")).map((x) => x.value);
    return { a: o.find((v) => v.startsWith("Lorville")), b: o.find((v) => v.startsWith("Area 18")) };
  });
  if (!loc.a || !loc.b) throw new Error("lieux de départ introuvables (datalist vide ?)");
  await page.type("#mission-name", "Test");
  await page.type("#mission-giver", "Covalex");
  await page.type("#mission-reward", "1000");
  await page.type(".cargo-commodity-input", "Agricultural Supplies");
  await page.type(".cargo-quantity-input", "4");
  await page.type(".cargo-pickup-input", loc.a);
  await page.type(".cargo-dropoff-input", loc.b);
  await page.click("#mission-submit-btn");
  await sleep(400);
  await page.select("#ship-select", ship);
  await sleep(300);
  await switchTab(page, "optimize-tab");
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) =>
      (x.textContent || "").toUpperCase().includes("OPTIMISER")
    );
    if (b) b.click();
  });
  await sleep(800);
  await switchTab(page, "cargo-tab");
  await page.evaluate(() => {
    const b = document.getElementById("pack-cargo-btn");
    if (b) b.click();
  });
  await sleep(900);
  const packed = await page.evaluate(() => !!cargoPackState);
  if (!packed) throw new Error("le rangement ne s'est pas construit");
}

// Collecteur d'assertions : les échecs s'accumulent au lieu d'interrompre,
// pour voir TOUT ce qui casse en un passage.
function makeChecker() {
  const failures = [];
  return {
    check(cond, msg) {
      if (!cond) failures.push(msg);
    },
    failures,
  };
}

module.exports = { REPO_ROOT, startStaticServer, launchEdge, openApp, switchTab, stableProbe, dragFrom, buildPackedState, makeChecker, sleep };
