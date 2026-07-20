"use strict";
// Trajets avec revisites (solveRevisitExact). Cas déclencheur : deux missions
// imposent l'ordre inverse entre les deux mêmes stations (livrer A->B pendant
// qu'on récupère B->A), ce que le calcul strict ne peut pas représenter.
//
// Le test central n'est PAS le cas signalé, c'est la comparaison à une
// recherche exhaustive : sur des instances tirées au hasard, l'ordre rendu
// doit égaler le meilleur ordre atteignable.
const { openApp, makeChecker } = require("./lib.cjs");

const EVERUS = "uex-station-10";
const BAIJINI = "uex-station-6";
const TRESSLER = "uex-station-23";

module.exports = {
  name: "Trajet avec revisites : exactitude, précédence, repli",
  async run(ctx) {
    const { check, failures } = makeChecker();
    const { page, errors } = await openApp(ctx, { skipSync: true });

    // --- Cas remonté par un joueur : un arrêt en trop à Everus. -----------
    const signale = await page.evaluate((L) => {
      const missions = [
        { id: 1, name: "Direct Large Cargo Hz", included: true, cargoItems: [
          { commodity: "Hydrogen", quantity: 1235, pickupId: L.EVERUS, dropoffId: L.BAIJINI } ] },
        { id: 2, name: "Large Cargo Haul", included: true, cargoItems: [
          { commodity: "Waste", quantity: 157, pickupId: L.BAIJINI, dropoffId: L.EVERUS },
          { commodity: "Waste", quantity: 158, pickupId: L.TRESSLER, dropoffId: L.EVERUS } ] },
        { id: 3, name: "Direct Medium Cargo", included: true, cargoItems: [
          { commodity: "Pressurized Ice", quantity: 410, pickupId: L.BAIJINI, dropoffId: L.EVERUS },
          { commodity: "Pressurized Ice", quantity: 290, pickupId: L.TRESSLER, dropoffId: L.EVERUS } ] },
        { id: 4, name: "Direct Large Cargo H:", included: true, cargoItems: [
          { commodity: "Waste", quantity: 550, pickupId: L.BAIJINI, dropoffId: L.EVERUS } ] },
      ];
      const r = optimizeRoute(missions, L.EVERUS, new Set(), true);
      return {
        erreur: r.error || null,
        total: r.total,
        arrets: r.stopCount,
        approx: !!r.approximate,
        revisite: !!r.revisited,
        pic: r.maxCargoLoad,
        chemin: (r.steps || []).map((s) => s.locId),
      };
    }, { EVERUS, BAIJINI, TRESSLER });

    check(!signale.erreur, "le cas signalé ne doit pas échouer : " + signale.erreur);
    // Le glouton rendait 5 arrêts / 122 Gm en repassant par Everus au milieu.
    check(signale.arrets === 4, `cas signalé : 4 arrêts attendus, ${signale.arrets}`);
    check(signale.total === 120, `cas signalé : 120 Gm attendus, ${signale.total}`);
    check(!signale.approx, "trajet résolu exactement : ne doit plus être marqué approché");
    check(signale.revisite, "Everus est bien visité deux fois : le drapeau revisited doit rester");
    // Everus > Baijini > Tressler > Everus et son miroir font tous deux 120 Gm
    // en 4 arrêts ; on doit rendre celui dont le pic de charge est le plus bas.
    check(signale.pic === 1565, `départage sur la charge : pic de 1565 attendu, ${signale.pic}`);

    // --- Optimalité prouvée par recherche exhaustive. ---------------------
    const exhaustif = await page.evaluate((L) => {
      const lieux = [L.EVERUS, L.BAIJINI, L.TRESSLER, "uex-station-1", "uex-station-2"];
      // Générateur déterministe : un échec doit être rejouable à l'identique.
      let graine = 12345;
      const rnd = (n) => {
        graine = (graine * 1103515245 + 12345) & 0x7fffffff;
        return graine % n;
      };

      // Meilleur trajet atteignable, tous ordres d'actions confondus.
      const forceBrute = (taches, depart) => {
        const k = taches.length;
        const etat = new Array(k).fill(0);
        let meilleur = Infinity;
        const explore = (ici, parcouru) => {
          if (parcouru >= meilleur) return; // élagage
          if (etat.every((s) => s === 2)) {
            meilleur = Math.min(meilleur, parcouru);
            return;
          }
          for (let t = 0; t < k; t++) {
            if (etat[t] === 2) continue;
            const cible = etat[t] === 0 ? taches[t].p : taches[t].d;
            etat[t]++;
            explore(cible, parcouru + (cible === ici ? 0 : getDistance(ici, cible)));
            etat[t]--;
          }
        };
        explore(depart, 0);
        return meilleur;
      };

      const resultats = [];
      for (let essai = 0; essai < 25; essai++) {
        const k = 2 + rnd(3); // 2 à 4 couples distincts
        const taches = [];
        const vus = new Set();
        while (taches.length < k) {
          const p = lieux[rnd(lieux.length)];
          const d = lieux[rnd(lieux.length)];
          if (p === d || vus.has(`${p}>${d}`)) continue;
          vus.add(`${p}>${d}`);
          taches.push({ p, d });
        }
        const depart = lieux[rnd(lieux.length)];
        const missions = taches.map((t, i) => ({
          id: i + 1, name: "M" + i, included: true,
          cargoItems: [{ commodity: "C", quantity: 10, pickupId: t.p, dropoffId: t.d }],
        }));

        const r = optimizeRoute(missions, depart, new Set(), true);
        if (r.error || r.approximate) continue; // instance repliée sur le glouton
        const optimal = forceBrute(taches, depart);

        // Précédence : chaque ligne doit être récupérée avant d'être déposée.
        const vu = new Map();
        let precedenceOk = true;
        r.steps.forEach((s, i) => {
          s.actions.forEach((a) => {
            a.items.forEach((it) => {
              const cle = `${it.pickupId}>${it.dropoffId}`;
              if (a.type === "pickup") vu.set(cle, i);
              else if (!vu.has(cle) || vu.get(cle) > i) precedenceOk = false;
            });
          });
        });

        resultats.push({ essai, rendu: r.total, optimal: Math.round(optimal * 100) / 100, precedenceOk, depart, taches });
      }
      return resultats;
    }, { EVERUS, BAIJINI, TRESSLER });

    if (process.env.DEBUG_ROUTE) {
      console.log("  instances:", exhaustif.length,
        "| optima finis:", exhaustif.filter((r) => Number.isFinite(r.optimal)).length,
        "| exemples:", JSON.stringify(exhaustif.slice(0, 4).map((r) => [r.rendu, r.optimal])));
    }
    check(exhaustif.length >= 15, `trop peu d'instances comparées (${exhaustif.length})`);
    const sousOptimaux = exhaustif.filter((r) => r.rendu > r.optimal + 1e-6);
    check(
      sousOptimaux.length === 0,
      "trajets plus longs que l'optimum exhaustif : " + JSON.stringify(sousOptimaux.slice(0, 3))
    );
    const precedenceKo = exhaustif.filter((r) => !r.precedenceOk);
    check(
      precedenceKo.length === 0,
      "dépôt avant récupération : " + JSON.stringify(precedenceKo.slice(0, 3).map((r) => r.taches))
    );

    // --- Le calcul strict (sans revisite) n'a pas bougé. ------------------
    const strict = await page.evaluate((L) => {
      const missions = [
        { id: 1, name: "A", included: true, cargoItems: [
          { commodity: "C", quantity: 10, pickupId: L.EVERUS, dropoffId: L.BAIJINI } ] },
        { id: 2, name: "B", included: true, cargoItems: [
          { commodity: "C", quantity: 10, pickupId: L.BAIJINI, dropoffId: L.TRESSLER } ] },
      ];
      const r = optimizeRoute(missions, L.EVERUS, new Set(), false);
      return { erreur: r.error || null, total: r.total, arrets: r.stopCount, revisite: !!r.revisited };
    }, { EVERUS, BAIJINI, TRESSLER });
    check(!strict.erreur, "trajet sans contradiction : ne doit pas échouer (" + strict.erreur + ")");
    check(strict.arrets === 3 && !strict.revisite, `strict : 3 arrêts sans revisite, obtenu ${strict.arrets}`);
    check(strict.total === 23 + 59, `strict : ${23 + 59} Gm attendus, ${strict.total}`);

    // --- Sans "autoriser les revisites", le cycle reste une erreur nommée. -
    const refus = await page.evaluate((L) => {
      const missions = [
        { id: 1, name: "A", included: true, cargoItems: [
          { commodity: "C", quantity: 10, pickupId: L.EVERUS, dropoffId: L.BAIJINI } ] },
        { id: 2, name: "B", included: true, cargoItems: [
          { commodity: "C", quantity: 10, pickupId: L.BAIJINI, dropoffId: L.EVERUS } ] },
      ];
      const r = optimizeRoute(missions, L.EVERUS, new Set(), false);
      return { erreur: r.error || null };
    }, { EVERUS, BAIJINI, TRESSLER });
    check(!!refus.erreur, "revisites refusées : un cycle doit rester une erreur explicite");
    check(
      /Everus|Baijini/.test(refus.erreur || ""),
      "l'erreur de cycle doit nommer les deux lieux en conflit : " + refus.erreur
    );

    check(errors.length === 0, "erreurs page : " + errors.join("; "));
    await page.close();
    return failures;
  },
};
