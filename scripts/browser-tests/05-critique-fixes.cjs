"use strict";
// Correctifs issus de la critique Impeccable : retours des actions fréquentes,
// focus clavier préservé, annulation de suppression, anneaux de focus, accès
// clavier de la dropzone, débordement mobile, et boucle 3D au repos.
const { openApp, switchTab, makeChecker, sleep } = require("./lib.cjs");

module.exports = {
  name: "Correctifs critique : retours, focus, annulation, mobile",
  async run(ctx) {
    const { check, failures } = makeChecker();
    const { page, errors, toasts } = await openApp(ctx);

    // --- Les actions fréquentes ne sont plus muettes. ---------------------
    const added = await page.evaluate(() => {
      document.getElementById("mission-name").value = "Convoi test";
      // Le formulaire refuse une mission sans ligne de cargaison, et exige des
      // lieux réellement résolvables (findLocationByLabel).
      const locs = allLocations().slice(0, 2);
      const row = document.querySelector("#cargo-fields .cargo-field-row");
      row.querySelector(".cargo-commodity-input").value = "Gold";
      row.querySelector(".cargo-quantity-input").value = "10";
      row.querySelector(".cargo-pickup-input").value = locationLabel(locs[0]);
      row.querySelector(".cargo-dropoff-input").value = locationLabel(locs[1]);
      document.getElementById("mission-form").requestSubmit();
      return state.missions.map((m) => m.name);
    });
    check(added.includes("Convoi test"), "la mission n'a pas été enregistrée : " + JSON.stringify(added));
    let shown = await toasts();
    check(
      shown.some((x) => x.kind === "success" && /Convoi test/.test(x.text)),
      "aucun toast de succès à l'ajout d'une mission : " + JSON.stringify(shown)
    );

    // Nom de lieu vide : échouait en SILENCE total avant.
    await page.evaluate(() => {
      document.getElementById("new-location-name").value = "   ";
      document.getElementById("add-location-form").requestSubmit();
    });
    shown = await toasts();
    check(
      shown.some((x) => x.kind === "error"),
      "un nom de lieu vide doit produire une erreur visible : " + JSON.stringify(shown)
    );

    // --- Cocher une mission ne détruit plus le focus. ---------------------
    await switchTab(page, "missions-tab");
    const focusKept = await page.evaluate(() => {
      const cb = document.querySelector("#missions-tbody input[type=checkbox]");
      if (!cb) return { erreur: "aucune case à cocher" };
      cb.focus();
      const avant = document.activeElement === cb;
      cb.click(); // déclenche le handler `change`
      return {
        avant,
        toujoursFocalisee: document.activeElement === cb,
        toujoursDansLeDom: document.body.contains(cb),
        resumeMisAJour: document.getElementById("missions-summary").textContent,
      };
    });
    check(focusKept.avant, "préalable : la case n'a pas pris le focus");
    check(focusKept.toujoursDansLeDom, "la case a été retirée du DOM au changement (table reconstruite)");
    check(focusKept.toujoursFocalisee, "le focus a été perdu en cochant — enchaîner deux cases redevient impossible");
    check(/\d/.test(focusKept.resumeMisAJour), "le pied de tableau ne s'est pas mis à jour : " + focusKept.resumeMisAJour);

    // --- Suppression annulable. -------------------------------------------
    const del = await page.evaluate(() => {
      const before = state.missions.length;
      const rows = document.querySelectorAll("#missions-tbody tr");
      const delBtn = rows[0].querySelector("button.btn-danger");
      delBtn.click();
      const apres = state.missions.length;
      const undo = document.querySelector(".toast-action");
      return { before, apres, aBoutonAnnuler: !!undo, libelle: undo ? undo.textContent : null };
    });
    check(del.apres === del.before - 1, `suppression : ${del.before} -> ${del.apres}`);
    check(del.aBoutonAnnuler, "le toast de suppression ne porte pas de bouton d'annulation");

    const undone = await page.evaluate(() => {
      document.querySelector(".toast-action").click();
      return { total: state.missions.length, noms: state.missions.map((m) => m.name) };
    });
    check(undone.total === del.before, `annulation : ${undone.total} au lieu de ${del.before}`);
    check(undone.noms.includes("Convoi test"), "la mission rétablie a perdu son nom : " + JSON.stringify(undone.noms));

    // --- Anneau de focus : les 3 boutons d'en-tête étaient écrasés par un
    //     sélecteur d'ID plus spécifique. --------------------------------
    const rings = await page.evaluate(() => {
      const out = {};
      ["login-btn", "lang-toggle", "theme-toggle", "ocr-dropzone"].forEach((id) => {
        const el = document.getElementById(id);
        const repos = getComputedStyle(el).boxShadow;
        el.focus();
        // :focus-visible ne s'arme pas toujours sur un focus programmatique :
        // on lit la règle telle que le navigateur la calculerait au clavier.
        const focus = getComputedStyle(el).boxShadow;
        out[id] = { change: focus !== repos, focusVisible: el.matches(":focus-visible") };
        el.blur();
      });
      return out;
    });
    Object.entries(rings).forEach(([id, r]) => {
      check(r.change, `#${id} : aucun changement visible au focus (anneau absent)`);
    });

    // --- La dropzone répond au clavier. -----------------------------------
    const dz = await page.evaluate(() => {
      const el = document.getElementById("ocr-dropzone");
      let ouvert = false;
      const input = document.getElementById("ocr-file-input");
      const real = input.click;
      input.click = () => { ouvert = true; };
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      const parEntree = ouvert;
      ouvert = false;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      input.click = real;
      return { parEntree, parEspace: ouvert, role: el.getAttribute("role"), aria: el.getAttribute("aria-label") };
    });
    check(dz.parEntree, "Entrée n'ouvre pas le sélecteur de fichiers sur la dropzone");
    check(dz.parEspace, "Espace n'ouvre pas le sélecteur de fichiers sur la dropzone");
    check(dz.role === "button", `dropzone : role="${dz.role}" au lieu de "button"`);
    check(!!dz.aria, "dropzone sans aria-label");

    // --- Plus de débordement horizontal à 375px, sur tous les onglets. ----
    await page.setViewport({ width: 375, height: 800 });
    await sleep(200);
    const tabs = ["new-mission-tab", "missions-tab", "optimize-tab", "cargo-tab", "history-tab", "companies-tab"];
    for (const id of tabs) {
      await switchTab(page, id);
      const o = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      check(o.scroll <= o.client + 1, `${id} : débordement horizontal ${o.scroll} > ${o.client}`);
    }
    await page.setViewport({ width: 1500, height: 1000 });

    check(errors.length === 0, "erreurs page : " + errors.join("; "));
    await page.close();
    return failures;
  },
};
