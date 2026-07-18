"use strict";
// Grilles communautaires (brique 2b) + les correctifs de robustesse de la
// revue complète. Supabase n'est PAS joignable en test : on vérifie donc la
// dégradation propre, la logique de verrouillage/déverrouillage et l'onglet de
// modération avec des fonctions cloud remplacées.
const { openApp, buildPackedState, makeChecker, sleep } = require("./lib.cjs");

module.exports = {
  name: "Grilles communautaires : proposer, déverrouiller, modérer, robustesse",
  async run(ctx) {
    const { check, failures } = makeChecker();
    const { page, errors, alerts } = await openApp(ctx);

    // --- Dégradation : sans les tables 2b, rien ne casse. -----------------
    const degraded = await page.evaluate(async () => ({
      submitSansCompte: await submitLayoutProposal("Caterpillar", [], 0, false, "x"),
      pending: await fetchPendingSubmissions(),
    }));
    check(degraded.submitSansCompte === false, "proposer sans compte devrait renvoyer false");
    check(Array.isArray(degraded.pending) && degraded.pending.length === 0, "lister sans table devrait renvoyer []");

    // --- Correctifs de la revue : uexGet, migrations, aria, SIGNED_OUT. ---
    const review = await page.evaluate(async () => {
      const o = {};
      o.aria = {
        prev: document.getElementById("cargo-step-prev").getAttribute("aria-label"),
        next: document.getElementById("cargo-step-next").getAttribute("aria-label"),
      };
      // uexGet doit échouer proprement sur une réponse non-ok (pas
      // « Unexpected token < » sur une page d'erreur HTML).
      const realFetch = window.fetch;
      window.fetch = async () => ({ ok: false, status: 503, json: async () => { throw new Error("html"); } });
      try {
        await uexGet("terminals");
        o.uex = "aucune erreur";
      } catch (e) {
        o.uex = e.message;
      }
      window.fetch = realFetch;
      // L'état venu du cloud doit repasser par les migrations de forme.
      const saved = state.missions;
      state.missions = [{ id: 9, name: "V", commodity: "Gold", cargo: "5", pickupId: "a", dropoffId: "b" }];
      migratePlayerDataInPlace();
      const m = state.missions[0];
      o.migration = {
        ok: Array.isArray(m.cargoItems) && m.cargoItems[0].commodity === "Gold" && m.cargoItems[0].pickupId === "a",
        nettoye: !("commodity" in m),
      };
      state.missions = saved;
      // Déconnexion : plus rien d'admin ne doit rester affiché.
      isAdminUser = true;
      renderSubmissionsEntry();
      const avant = document.getElementById("submissions-tab-btn").style.display !== "none";
      handleSignedOutUI();
      o.signout = { avant, admin: isAdminUser, apres: document.getElementById("submissions-tab-btn").style.display !== "none" };
      return o;
    });
    check(review.aria.prev === "Arrêt précédent" && review.aria.next === "Arrêt suivant", "aria-labels non traduits");
    check(/HTTP 503/.test(review.uex), "uexGet n'échoue pas proprement : " + review.uex);
    check(review.migration.ok && review.migration.nettoye, "migration d'un état cloud ancien format : " + JSON.stringify(review.migration));
    check(review.signout.avant && !review.signout.admin && !review.signout.apres, "SIGNED_OUT ne nettoie pas l'UI admin");

    // --- Verrouillage / porte de sortie / bouton Proposer. ----------------
    await buildPackedState(page);
    const gate = await page.evaluate(() => {
      const v = (id) => document.getElementById(id).style.display !== "none";
      const o = {};
      const ship = getCargoViewerShipName();
      const holds = getShipHolds(ship);
      // Grille publiée simulée (l'état réel du site en a plusieurs).
      state.approvedShipGrids = {
        [ship]: {
          grid: holds.map((h, i) => ({
            name: h.name, dimensions: h.dimensions, capacity: h.capacity,
            maxContainerSize: h.maxContainerSize, position: { x: i * 2.5, y: 0, z: 0 },
          })),
          orientation: 0, mirror: false,
        },
      };
      state.cargoViewerUnlocked = {};
      state.cargoViewerLayout = {};
      isAdminUser = false;

      cloudUserId = null;
      renderCargoStepView();
      // Déconnecté sur grille publiée : PAS de cul-de-sac — « Corriger » reste
      // accessible (déverrouiller est local), « Proposer » non (envoi = compte).
      o.deconnecte = { edit: v("cargo-viewer-edit-btn"), corr: v("propose-correction-btn"), prop: v("propose-layout-btn") };

      cloudUserId = "u1";
      renderCargoStepView();
      o.connecteVerrouille = { corr: v("propose-correction-btn"), prop: v("propose-layout-btn") };

      proposeCorrection();
      o.deverrouille = {
        unlocked: !!state.cargoViewerUnlocked[ship],
        seeded: Object.keys(state.cargoViewerLayout[ship] || {}).length,
        edit: v("cargo-viewer-edit-btn"),
        // Déverrouiller ne suffit PAS : « Proposer » exige une vraie modif.
        prop: v("propose-layout-btn"),
      };

      const g = getResolvedCargoGrid();
      window.persistCargoModulePosition(g[0].name, g[0].position.x + 2.5, g[0].position.y, g[0].position.z);
      o.apresModif = { prop: v("propose-layout-btn"), change: hasLayoutChanges(ship) };
      o.modules = holds.length;
      return o;
    });
    check(!gate.deconnecte.edit && gate.deconnecte.corr, "déconnecté + grille publiée : « Corriger » doit rester accessible");
    check(!gate.deconnecte.prop, "déconnecté : « Proposer » ne doit pas être visible");
    check(gate.connecteVerrouille.corr && !gate.connecteVerrouille.prop, "connecté verrouillé : « Corriger » seul attendu");
    check(gate.deverrouille.unlocked, "« Corriger » n'a pas déverrouillé");
    check(gate.deverrouille.seeded === gate.modules, `disposition non amorcée depuis la publiée (${gate.deverrouille.seeded}/${gate.modules})`);
    check(gate.deverrouille.edit, "après déverrouillage : « Éditer » devrait revenir");
    check(!gate.deverrouille.prop, "« Proposer » visible sans aucune modification réelle");
    check(gate.apresModif.prop && gate.apresModif.change, "« Proposer » n'apparaît pas après un déplacement réel");

    // --- Envoi : payload complet, et échecs jamais silencieux. ------------
    const submit = await page.evaluate(async () => {
      let captured = null;
      const real = window.submitLayoutProposal;
      submitLayoutProposal = (ship, grid, orientation, mirror) => {
        captured = { ship, modules: grid.length, positionnes: grid.every((m) => m.position), orientation, mirror };
        return Promise.resolve(true);
      };
      await proposeCurrentLayout();
      submitLayoutProposal = real;
      // Session expirée en cours de route : doit alerter, pas se taire.
      const savedId = cloudUserId;
      cloudUserId = null;
      await proposeCurrentLayout();
      cloudUserId = savedId;
      return captured;
    });
    check(submit && submit.modules > 0 && submit.positionnes, "payload de proposition incomplet : " + JSON.stringify(submit));
    check(alerts.some((a) => /connect/i.test(a)), "session expirée : l'échec est resté silencieux");

    // --- Onglet de modération (admin) : liste, aperçu, validation. --------
    const mod = await page.evaluate(async () => {
      isAdminUser = false;
      renderSubmissionsEntry();
      const cacheJoueur = document.getElementById("submissions-tab-btn").style.display === "none";
      isAdminUser = true;
      renderSubmissionsEntry();
      const visibleAdmin = document.getElementById("submissions-tab-btn").style.display !== "none";

      const ship = getCargoViewerShipName();
      const grid = getShipHolds(ship).map((h, i) => ({
        name: h.name, dimensions: h.dimensions, capacity: h.capacity,
        maxContainerSize: h.maxContainerSize, position: { x: i * 2.5, y: 0, z: 0 },
      }));
      const subs = [
        { id: "s1", ship_name: ship, grid, orientation: 1, mirror: false, submitter_name: "Alice", created_at: "2026-07-17T10:00:00Z" },
        { id: "s2", ship_name: "Ironclad", grid, orientation: 0, mirror: true, submitter_name: "Bob", created_at: "2026-07-17T11:00:00Z" },
      ];
      const realFetch = window.fetchPendingSubmissions;
      const realApprove = window.approveSubmission;
      fetchPendingSubmissions = () => Promise.resolve(subs.slice());
      await renderSubmissionsTab();
      const rows = document.querySelectorAll("#submissions-list .admin-grid-row");
      const texte = document.getElementById("submissions-list").textContent;

      // « Aperçu » : bascule vers la vue 3D et rend la grille PROPOSÉE sans caisse.
      let apercu = null;
      const realRender = window.renderCargoViewer3D;
      renderCargoViewer3D = (h, c, or_, mi) => { apercu = { modules: h.length, caisses: c.length, orientation: or_ }; };
      rows[0].querySelectorAll("button")[0].click();
      renderCargoViewer3D = realRender;

      // « Valider » : retire la ligne et rafraîchit le cache local.
      approveSubmission = () => Promise.resolve(true);
      fetchPendingSubmissions = () => Promise.resolve(subs.filter((s) => s.id !== "s1"));
      await rows[0].querySelectorAll("button")[1].click();
      await new Promise((r) => setTimeout(r, 150));
      const restantes = document.querySelectorAll("#submissions-list .admin-grid-row").length;
      fetchPendingSubmissions = realFetch;
      approveSubmission = realApprove;
      return { cacheJoueur, visibleAdmin, lignes: rows.length, actions: rows[0].querySelectorAll("button").length, texte, apercu, restantes };
    });
    check(mod.cacheJoueur, "l'onglet de modération est visible pour un joueur");
    check(mod.visibleAdmin, "l'onglet de modération n'apparaît pas pour un admin");
    check(mod.lignes === 2 && mod.actions === 3, `liste : 2 lignes x 3 actions attendues (${mod.lignes}x${mod.actions})`);
    check(/Alice/.test(mod.texte), "la ligne n'affiche pas l'auteur");
    check(mod.apercu && mod.apercu.modules > 0, "« Aperçu » n'a pas rendu la grille proposée");
    check(mod.apercu && mod.apercu.caisses === 0, "« Aperçu » doit afficher ZÉRO caisse");
    check(mod.apercu && mod.apercu.orientation === 1, "« Aperçu » ne transmet pas l'orientation de la proposition");
    check(mod.restantes === 1, `après validation : 1 ligne restante attendue (${mod.restantes})`);

    check(errors.length === 0, "erreurs page : " + errors.join("; "));
    await page.close();
    return failures;
  },
};
