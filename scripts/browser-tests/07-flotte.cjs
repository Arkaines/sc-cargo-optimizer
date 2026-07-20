"use strict";
// Balayage de TOUS les gros porteurs, pas d'un vaisseau témoin.
//
// Demandé par un joueur : « ne teste pas que le Raft, teste sur l'ensemble des
// vaisseaux qui ont de gros volumes ». Le risque réel est de corriger le
// rangement pour un vaisseau et de le casser silencieusement sur un autre — ce
// qui a failli arriver plusieurs fois : une correction validée sur un cas a
// triplé les conflits du Raft, une autre en a créé deux là où il n'y en avait
// aucun. Un seul jeu de données ne protège de rien.
//
// Ce test vit ici plutôt que dans scripts/cargo-packing-tests.cjs parce qu'il
// lui faut la vraie liste des vaisseaux FleetYards, qui n'existe que dans la
// page (state.fleetyardsCargoHolds), pas dans le contexte vm du harnais pur.
const { openApp, makeChecker } = require("./lib.cjs");

// Seuil de « gros volume ». En dessous, un vaisseau n'a souvent qu'une soute
// et le rangement n'a aucune décision à prendre.
const CAPACITE_MINI = 400;
// Charge d'essai. À 60 % de la capacité, les 12 gros porteurs placent tout
// sans aucun conflit (mesuré le 2026-07-20) : c'est donc un invariant net.
// Plus haut, la géométrie de certaines soutes commence légitimement à refuser
// des caisses (voir la note sur les tailles de caisse ci-dessous).
const CHARGE_PCT = 60;

module.exports = {
  name: "Flotte : rangement sur tous les vaisseaux de gros volume",
  async run(ctx) {
    const { check, failures } = makeChecker();
    const { page, errors } = await openApp(ctx);

    const resultats = await page.evaluate(
      ({ capaciteMini, chargePct }) => {
        const out = [];
        Object.keys(state.fleetyardsCargoHolds || {}).forEach((nom) => {
          const holds = getShipHolds(nom) || [];
          const capacite = holds.reduce((s, h) => s + (h.capacity || 0), 0);
          if (capacite < capaciteMini) return;

          // Taille de caisse que TOUTES les soutes acceptent. Sans ça le test
          // signalerait des refus parfaitement légitimes : une caisse de
          // 32 SCU mesure 2x8x2 crans et ne peut pas entrer dans une grille de
          // hangar de 4x4x4, ce qui est vrai en jeu aussi. L'Idris-P place
          // 962/962 SCU en caisses de 16 et seulement 194 en caisses de 32 —
          // ce n'est pas un défaut de rangement, c'est la géométrie.
          const maxCommun = holds.reduce((m, h) => Math.min(m, h.maxContainerSize || 32), 32);
          const q = Math.round((capacite * chargePct) / 100);
          const entries = [
            { quantity: Math.round(q * 0.5), commodity: "A", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: maxCommun },
            { quantity: Math.round(q * 0.3), commodity: "B", mission: { id: 2, name: "M2" }, pickupStop: 0, dropoffStop: 2, maxCargoBoxSize: maxCommun },
            { quantity: Math.round(q * 0.2), commodity: "C", mission: { id: 3, name: "M3" }, pickupStop: 1, dropoffStop: 3, maxCargoBoxSize: maxCommun },
          ];

          try {
            const r = simulateRoutePacking(entries, holds, 4, { back: true }, null);
            out.push({
              nom, capacite, maxCommun, demande: q,
              nonPlace: r.unplaced.length,
              conflits: r.conflicts.length,
              place: r.placements.reduce((s, p) => s + p.size[0] * p.size[1] * p.size[2], 0),
            });
          } catch (e) {
            out.push({ nom, capacite, erreur: String((e && e.message) || e).slice(0, 120) });
          }
        });
        return out.sort((a, b) => b.capacite - a.capacite);
      },
      { capaciteMini: CAPACITE_MINI, chargePct: CHARGE_PCT }
    );

    // Garde-fou contre un test qui passerait à vide (données non chargées).
    check(
      resultats.length >= 10,
      `seulement ${resultats.length} vaisseaux de ${CAPACITE_MINI}+ SCU analysés — données FleetYards absentes ?`
    );

    const plantes = resultats.filter((r) => r.erreur);
    check(plantes.length === 0, "le rangement a levé une exception : " + JSON.stringify(plantes.slice(0, 3)));

    const refuses = resultats.filter((r) => !r.erreur && r.nonPlace > 0);
    check(
      refuses.length === 0,
      "caisses refusées alors que la taille tient dans toutes les soutes : " +
        JSON.stringify(refuses.map((r) => `${r.nom} ${r.nonPlace} non placées (${r.place}/${r.demande} SCU)`))
    );

    const enConflit = resultats.filter((r) => !r.erreur && r.conflits > 0);
    check(
      enConflit.length === 0,
      "conflits d'accès là où il n'y en avait aucun : " +
        JSON.stringify(enConflit.map((r) => `${r.nom} ${r.conflits}`))
    );

    if (process.env.DEBUG_FLOTTE) {
      resultats.forEach((r) =>
        console.log(
          `  ${r.nom.padEnd(24)} ${String(r.capacite).padStart(5)} SCU  caisses<=${r.maxCommun}  ` +
            (r.erreur ? `ERREUR ${r.erreur}` : `${r.place}/${r.demande} placés, ${r.conflits} conflit(s)`)
        )
      );
    }

    check(errors.length === 0, "erreurs page : " + errors.join("; "));
    await page.close();
    return failures;
  },
};
