"use strict";
// L'éditeur admin de grilles : sélection au clic, rotation 90° (échange X/Y à
// capacité constante), « Tout déplacer » rigide au vrai glisser souris, et
// sortie vers un état cohérent.
const { openApp, switchTab, dragFrom, makeChecker, sleep } = require("./lib.cjs");

module.exports = {
  name: "Éditeur admin : sélection, rotation, tout-déplacer, sortie",
  async run(ctx) {
    const { check, failures } = makeChecker();
    const { page, errors } = await openApp(ctx);
    await switchTab(page, "cargo-tab");

    // --- Entrée + sélection au clic (chemin réel du picker). --------------
    const sel = await page.evaluate(() => {
      isAdminUser = true;
      state.selectedShip = "Caterpillar";
      state.cargoViewerLayout = {};
      document.getElementById("ship-select").value = "Caterpillar";
      document.getElementById("cargo-viewer-panel").style.display = "";
      renderCargoViewer3D(getShipHolds("Caterpillar"), [], 0, false, {});
      enterAdminGridEdit();
      const before = document.getElementById("admin-grid-selected").style.display;
      window.onCargoModulePicked(adminGridDraft[0].name);
      return {
        draft: adminGridDraft.length,
        before,
        after: document.getElementById("admin-grid-selected").style.display,
        rotateDisabled: document.getElementById("admin-grid-rotate-btn").disabled,
        name: document.getElementById("admin-grid-selected-name").textContent,
      };
    });
    check(sel.draft === 14, `brouillon : 14 soutes attendues, ${sel.draft}`);
    check(sel.before === "none" && sel.after !== "none", "le sous-menu n'apparaît pas à la sélection");
    check(!sel.rotateDisabled, "« Pivoter » devrait s'activer à la sélection");
    check(!!sel.name, "nom du module sélectionné vide");

    // --- Rotation 90° : X<->Y, capacité constante, 4x = identité. ---------
    const rot = await page.evaluate(() => {
      const target = adminGridDraft.find(
        (m) => Math.round(m.dimensions.x / 1.25) !== Math.round(m.dimensions.y / 1.25)
      );
      adminGridSelected = target.name;
      renderAdminGridEditor();
      const cells = (m) => ({ x: Math.round(m.dimensions.x / 1.25), y: Math.round(m.dimensions.y / 1.25) });
      const before = { cells: cells(target), cap: target.capacity, pos: { ...target.position } };
      document.getElementById("admin-grid-rotate-btn").click();
      const after = { cells: cells(target), cap: target.capacity, pos: { ...target.position } };
      document.getElementById("admin-grid-rotate-btn").click();
      document.getElementById("admin-grid-rotate-btn").click();
      document.getElementById("admin-grid-rotate-btn").click();
      return { before, after, final: { cells: cells(target), cap: target.capacity } };
    });
    check(
      rot.after.cells.x === rot.before.cells.y && rot.after.cells.y === rot.before.cells.x,
      "la rotation n'échange pas X et Y"
    );
    check(rot.after.cap === rot.before.cap, `capacité changée par la rotation : ${rot.before.cap} -> ${rot.after.cap}`);
    check(JSON.stringify(rot.after.pos) === JSON.stringify(rot.before.pos), "la rotation a déplacé le module");
    check(JSON.stringify(rot.final.cells) === JSON.stringify(rot.before.cells), "4 rotations ne reviennent pas au départ");

    // --- « Tout déplacer » : bloc RIGIDE au vrai glisser souris. ----------
    await page.evaluate(() => {
      document.getElementById("admin-grid-moveall-btn").click();
      window.__before = adminGridDraft.map((m) => ({ name: m.name, x: m.position.x, z: m.position.z }));
      setCargoViewerView("top");
    });
    await dragFrom(page, 120, 40);
    const move = await page.evaluate(() => {
      const deltas = adminGridDraft.map((m) => {
        const b = window.__before.find((x) => x.name === m.name);
        return { dx: +(m.position.x - b.x).toFixed(3), dz: +(m.position.z - b.z).toFixed(3) };
      });
      delete window.__before;
      return { deltas, label: document.getElementById("admin-grid-moveall-btn").textContent };
    });
    const d0 = move.deltas[0];
    check(d0.dx !== 0 || d0.dz !== 0, "« Tout déplacer » : rien n'a bougé au glisser");
    check(
      move.deltas.every((d) => d.dx === d0.dx && d.dz === d0.dz),
      "« Tout déplacer » : le bloc s'est DÉFORMÉ (deltas différents)"
    );
    check(/ON/.test(move.label), "le bouton « Tout déplacer » n'affiche pas l'état actif");

    // --- Sortie : état cohérent, bouton de rangement réactivé. ------------
    const exit = await page.evaluate(() => {
      exitAdminGridEdit();
      const v = (id) => document.getElementById(id).style.display !== "none";
      return {
        panel: v("admin-grid-panel"),
        edit: v("cargo-viewer-edit-btn"),
        done: v("cargo-viewer-edit-done-btn"),
        packDisabled: document.getElementById("pack-cargo-btn").disabled,
        draft: adminGridDraft,
      };
    });
    check(!exit.panel, "sortie : le panneau admin reste ouvert");
    check(exit.edit && !exit.done, "sortie : contrôles joueur incohérents (Éditer/Terminer)");
    check(!exit.packDisabled, "sortie : « Calculer le rangement » reste désactivé");
    check(exit.draft === null, "sortie : le brouillon admin n'est pas vidé");
    check(errors.length === 0, "erreurs page : " + errors.join("; "));
    await page.close();
    return failures;
  },
};
