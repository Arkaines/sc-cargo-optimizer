"use strict";
// =========================================================================
// Lanceur des tests navigateur (Edge headless + puppeteer-core).
//
// Usage :  node scripts/browser-tests/run.cjs [filtre]
//   - sans argument : toutes les suites (fichiers NN-*.cjs de ce dossier)
//   - avec argument : seules les suites dont le nom contient le filtre
//                     (ex. `node scripts/browser-tests/run.cjs admin`)
//
// Autonome : démarre son propre serveur statique (port 8123) et son propre
// Edge headless (profil neuf, CDP 9500) — rien à lancer avant, rien ne touche
// un serveur de dev déjà ouvert sur 8080. Nécessite Edge (ou EDGE_PATH) et
// `npm install` dans scripts/ (puppeteer-core).
//
// Ces suites sont le filet de sécurité du visualiseur 3D et des parcours
// UI — tout ce que `scripts/cargo-packing-tests.cjs` (l'algorithme pur) ne
// peut pas couvrir. Elles parlent à la vraie API FleetYards au chargement de
// chaque page (profil neuf oblige) : compter quelques secondes par suite.
// =========================================================================
const fs = require("fs");
const path = require("path");
const { startStaticServer, launchEdge } = require("./lib.cjs");

const HTTP_PORT = 8123;
const CDP_PORT = 9500;

async function main() {
  const filter = process.argv[2] || "";
  const suiteFiles = fs
    .readdirSync(__dirname)
    .filter((f) => /^\d\d-.*\.cjs$/.test(f) && f.includes(filter))
    .sort();
  if (!suiteFiles.length) {
    console.error(`Aucune suite ne correspond à « ${filter} »`);
    process.exit(2);
  }

  const server = await startStaticServer(HTTP_PORT);
  const { browser, kill } = await launchEdge(CDP_PORT);
  const ctx = { browser, baseUrl: `http://127.0.0.1:${HTTP_PORT}` };

  let totalFailures = 0;
  try {
    for (const file of suiteFiles) {
      const suite = require(path.join(__dirname, file));
      process.stdout.write(`\n=== ${suite.name} (${file}) ===\n`);
      const started = Date.now();
      let failures;
      try {
        failures = await suite.run(ctx);
      } catch (err) {
        failures = [`exception non prévue : ${err.message}`];
      }
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (failures.length) {
        totalFailures += failures.length;
        console.log(`ÉCHEC (${secs}s) :`);
        failures.forEach((f) => console.log(`  - ${f}`));
      } else {
        console.log(`OK (${secs}s)`);
      }
    }
  } finally {
    kill();
    server.close();
  }

  console.log(
    totalFailures
      ? `\n${totalFailures} échec(s) — voir ci-dessus.`
      : `\nToutes les suites passent (${suiteFiles.length}).`
  );
  process.exit(totalFailures ? 1 : 0);
}

main().catch((e) => {
  console.error("Lanceur en échec :", e);
  process.exit(2);
});
