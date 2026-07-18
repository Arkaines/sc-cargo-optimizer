"use strict";
// Réservations d'emplacement (véhicule garé) : conversion monde -> cellules de
// module (l'échange Y/Z, le point le plus fragile), grille virtuelle glissable,
// stockage, liste + effacement, et exclusion effective par le rangement.
const { openApp, switchTab, stableProbe, dragFrom, makeChecker, sleep } = require("./lib.cjs");

module.exports = {
  name: "Réservations : conversion, glisser, liste, exclusion au rangement",
  async run(ctx) {
    const { check, failures } = makeChecker();
    const { page, errors } = await openApp(ctx);
    await switchTab(page, "cargo-tab");

    // --- La conversion monde -> module (fonction pure). -------------------
    const conv = await page.evaluate(() => {
      renderCargoViewer3D(getShipHolds("Caterpillar"), [], 0, false, {});
      const grid = getResolvedCargoGrid();
      const m0 = grid[0];
      const cx = Math.round(m0.dimensions.x / 1.25);
      const cy = Math.round(m0.dimensions.y / 1.25);
      // Grille synthétique : deux modules 1x2 accolés le long de viewer-Z, un
      // véhicule 1x2 posé sur la couture -> une empreinte dans CHACUN.
      const synth = [
        { moduleKey: "A", name: "A", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, position: { x: 0, y: 0, z: 0 } },
        { moduleKey: "B", name: "B", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, position: { x: 0, y: 0, z: 2.5 } },
      ];
      return {
        keyed: grid.every((m) => typeof m.moduleKey === "string"),
        coin: resolveVehicleReservations(m0.position.x, m0.position.z, 1, 1, grid),
        plein: resolveVehicleReservations(m0.position.x, m0.position.z, cx, cy, grid),
        cx,
        cy,
        m0key: m0.moduleKey,
        loin: resolveVehicleReservations(99999, 99999, 2, 2, grid),
        cheval: resolveVehicleReservations(0, 1.25, 1, 2, synth),
      };
    });
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check(conv.keyed, "getResolvedCargoGrid n'expose pas moduleKey");
    check(eq(conv.coin, [{ moduleKey: conv.m0key, x0: 0, y0: 0, sx: 1, sy: 1 }]), "1x1 au coin : " + JSON.stringify(conv.coin));
    check(
      eq(conv.plein, [{ moduleKey: conv.m0key, x0: 0, y0: 0, sx: conv.cx, sy: conv.cy }]),
      "module entier : " + JSON.stringify(conv.plein)
    );
    check(eq(conv.loin, []), "véhicule hors de toute soute : " + JSON.stringify(conv.loin));
    check(
      eq(conv.cheval, [
        { moduleKey: "A", x0: 0, y0: 1, sx: 1, sy: 1 },
        { moduleKey: "B", x0: 0, y0: 0, sx: 1, sy: 1 },
      ]),
      "à cheval sur deux soutes : " + JSON.stringify(conv.cheval)
    );

    // --- Mode réservation : seul le véhicule est cliquable, le glisser
    //     déclenche bien la dépose (et pas la persistance d'un module). -----
    await page.evaluate(() => {
      state.selectedShip = "Caterpillar";
      state.cargoReservations = {};
      document.getElementById("ship-select").value = "Caterpillar";
      document.getElementById("cargo-viewer-panel").style.display = "";
      renderCargoViewer3D(getShipHolds("Caterpillar"), [], 0, false, {});
      enterReservationEdit();
      setCargoViewerView("top");
      document.getElementById("reservation-len").value = "2";
      document.getElementById("reservation-wid").value = "2";
      document.getElementById("reservation-place-btn").click();
      window.__drop = null;
      window.__realDrop = window.onReservationVehicleDropped;
      window.onReservationVehicleDropped = (vx, vz, sx, sy) => {
        window.__drop = { sx, sy };
      };
    });
    await stableProbe(page); // attend que la vue se pose avant de mesurer
    const audit = await page.evaluate(() => ({
      vehicle: window.__sceneAudit().reservationVehicle,
      pickCount: window.__cargoViewerTestProbe().pickMeshCount,
    }));
    check(audit.vehicle === 1, "« Placer » n'a pas créé la grille virtuelle");
    check(audit.pickCount === 1, `en mode réservation, seul le véhicule doit être cliquable (${audit.pickCount})`);

    await dragFrom(page, 40, 20);
    const drop = await page.evaluate(() => {
      const d = window.__drop;
      window.onReservationVehicleDropped = window.__realDrop;
      delete window.__drop;
      delete window.__realDrop;
      return d;
    });
    check(drop && drop.sx === 2 && drop.sy === 2, "le glisser n'a pas déclenché la dépose 2x2 : " + JSON.stringify(drop));

    // --- Dépose réelle -> stockage, overlay, liste, total SCU, effacement. -
    const store = await page.evaluate(() => {
      const m0 = getResolvedCargoGrid()[0];
      setReservationVehicleSize(3, 2);
      window.onReservationVehicleDropped(m0.position.x, m0.position.z, 3, 2);
      const listed = document.getElementById("reservation-list").textContent;
      const del = document.querySelector("#reservation-list button");
      return {
        key: m0.moduleKey,
        stored: JSON.parse(JSON.stringify(state.cargoReservations.Caterpillar || {})),
        overlay: window.__sceneAudit().reservationOverlay,
        listed,
        hasDelete: !!del,
      };
    });
    const fp = store.stored[store.key] && store.stored[store.key][0];
    check(fp && fp.sx === 3 && fp.sy === 2, "empreinte 3x2 non stockée : " + JSON.stringify(store.stored));
    check(store.overlay >= 1, "aucune réservation dessinée après la dépose");
    check(/SCU/.test(store.listed), "le total « X SCU réservés » n'apparaît pas");
    check(store.hasDelete, "pas de bouton « Effacer » dans la liste");

    // --- Le rangement exclut réellement la zone (bout en bout). -----------
    const packing = await page.evaluate(() => {
      const holds = getShipHolds("Caterpillar");
      const entries = [
        { quantity: 1, commodity: "A", mission: { id: 1, name: "M" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 },
      ];
      // On SNAPSHOTE la réservation posée à l'étape précédente : l'écraser
      // ici rendrait le « Effacer » suivant inopérant (removeReservationVehicle
      // sort tôt si le vaisseau n'a plus d'entrée) et le DOM resterait figé —
      // ce qui ressemblerait à un bug du produit alors que c'est le test.
      const snapshot = JSON.parse(JSON.stringify(state.cargoReservations));
      state.cargoReservations = {};
      const sans = simulateRoutePacking(entries, holds, 2, getShipAccessFaces("Caterpillar"), getShipReservations("Caterpillar"));
      const landed = sans.placements[0].module.name;
      const target = holds.find((h) => h.name === landed);
      const cells = (d) => Math.max(1, Math.round(d / 1.25));
      state.cargoReservations = {
        Caterpillar: {
          [landed]: [{ x0: 0, y0: 0, sx: cells(target.dimensions.x), sy: cells(target.dimensions.y), vid: "t" }],
        },
      };
      const avec = simulateRoutePacking(entries, holds, 2, getShipAccessFaces("Caterpillar"), getShipReservations("Caterpillar"));
      state.cargoReservations = snapshot;
      return {
        landed,
        sans: sans.placements.filter((p) => p.module.name === landed).length,
        avec: avec.placements.filter((p) => p.module.name === landed).length,
      };
    });
    check(packing.sans >= 1, "cas de test : rien ne se plaçait dans la soute ciblée");
    check(packing.avec === 0, "la soute entièrement réservée accueille encore une caisse");

    const clear = await page.evaluate(() => {
      const btn = document.querySelector("#reservation-list button");
      if (btn) btn.click();
      return {
        stored: JSON.parse(JSON.stringify(state.cargoReservations.Caterpillar || {})),
        listed: document.getElementById("reservation-list").textContent,
      };
    });
    check(Object.keys(clear.stored).length === 0, "« Effacer » n'a pas vidé l'état : " + JSON.stringify(clear.stored));
    check(!/SCU/.test(clear.listed), "le total persiste après « Effacer »");
    check(errors.length === 0, "erreurs page : " + errors.join("; "));
    await page.close();
    return failures;
  },
};
