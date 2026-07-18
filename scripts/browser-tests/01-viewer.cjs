"use strict";
// Le visualiseur 3D : sondes derrière ?probes=1, repères qui suivent les
// bornes RÉELLES du bloc (y compris en coordonnées négatives), sol + axes en
// mode édition seulement.
const { openApp, makeChecker } = require("./lib.cjs");

module.exports = {
  name: "Visualiseur : sondes, bornes, repères, sol/axes",
  async run(ctx) {
    const { check, failures } = makeChecker();

    // --- Les sondes n'existent PAS sans le drapeau (production). ----------
    {
      const { page } = await openApp(ctx, { probes: false, skipSync: true });
      const probes = await page.evaluate(() => ({
        scene: typeof window.__sceneAudit,
        labels: typeof window.__labelAudit,
        probe: typeof window.__cargoViewerTestProbe,
      }));
      check(probes.scene === "undefined", "PROD : __sceneAudit exposée sans ?probes=1");
      check(probes.labels === "undefined", "PROD : __labelAudit exposée sans ?probes=1");
      check(probes.probe === "undefined", "PROD : __cargoViewerTestProbe exposée sans ?probes=1");
      await page.close();
    }

    // --- Avec le drapeau : bornes, repères, sol/axes. ---------------------
    const { page, errors } = await openApp(ctx);
    const r = await page.evaluate(() => {
      const holds = getShipCargoHolds("Caterpillar");

      // Vue RÉSULTAT (pas d'édition) : ni sol ni axes.
      setCargoLayoutEditing(false);
      renderCargoViewer3D(holds, [], 0, false, {});
      const normal = window.__sceneAudit();

      // Mode ÉDITION, bloc glissé en coordonnées NÉGATIVES (le glisser
      // horizontal est libre, seul le sol vertical est borné).
      const moved = {};
      getResolvedCargoGrid().forEach((m) => {
        moved[m.name] = { x: m.position.x - 6, y: m.position.y, z: m.position.z - 10 };
      });
      setCargoLayoutEditing(true);
      renderCargoViewer3D(holds, [], 0, false, moved);
      const edit = window.__sceneAudit();

      const layout = getResolvedCargoGrid();
      const bounds = {
        minX: Math.min(...layout.map((m) => m.position.x)),
        maxX: Math.max(...layout.map((m) => m.position.x + m.dimensions.x)),
        minZ: Math.min(...layout.map((m) => m.position.z)),
        maxZ: Math.max(...layout.map((m) => m.position.z + m.dimensions.y)),
      };
      const labels = window.__labelAudit();
      setCargoLayoutEditing(false);
      return { normal, edit, bounds, labels };
    });

    check(r.bounds.minX < 0, "le bloc n'est pas allé en négatif (bornage X revenu ?)");
    check(r.normal.floor === 0 && r.normal.axes === 0, "sol/axes présents en vue résultat");
    check(r.edit.floor === 1 && r.edit.axes === 1, "sol/axes absents en mode édition");
    // Les 4 repères doivent ENCADRER le bloc, où qu'il soit.
    check(r.labels.right.x < r.bounds.minX, `repère droit (${r.labels.right.x}) ne colle pas à minX (${r.bounds.minX})`);
    check(r.labels.left.x > r.bounds.maxX, `repère gauche (${r.labels.left.x}) ne dépasse pas maxX (${r.bounds.maxX})`);
    check(r.labels.rear.z < r.bounds.minZ, `repère arrière (${r.labels.rear.z}) ne colle pas à minZ (${r.bounds.minZ})`);
    check(r.labels.front.z > r.bounds.maxZ, `repère avant (${r.labels.front.z}) ne dépasse pas maxZ (${r.bounds.maxZ})`);
    check(errors.length === 0, "erreurs page : " + errors.join("; "));
    await page.close();
    return failures;
  },
};
