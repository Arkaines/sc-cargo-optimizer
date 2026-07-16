"use strict";
// Suite de non-régression pour js/cargo-packing.js — pas de framework de
// test (le projet n'en a pas), juste un runner minimal avec assert natif.
// Usage : node scripts/cargo-packing-tests.cjs

const assert = require("assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadCargoPacking() {
  const code = fs.readFileSync(path.join(PROJECT_ROOT, "js/cargo-packing.js"), "utf8");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "js/cargo-packing.js" });
  return ctx;
}

function loadFixture(name) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
  const missionById = new Map();
  data.entries.forEach((e) => {
    if (!missionById.has(e.missionId)) missionById.set(e.missionId, { id: e.missionId, name: e.missionName });
  });
  const entries = data.entries.map((e) => ({
    quantity: e.quantity,
    commodity: e.commodity,
    mission: missionById.get(e.missionId),
    maxCargoBoxSize: e.maxCargoBoxSize,
    pickupStop: e.pickupStop,
    dropoffStop: e.dropoffStop,
  }));
  return { entries, holds: data.holds, stepCount: data.stepCount };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// --- Sanity : imbrication simple, sans conflit ---------------------------
test("nested: one lateral slot, non-overlapping intervals -> 0 conflict", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 3 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 2 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 4);
  assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.unplaced.length, 0);
});

// --- Sanity : un seul couloir, intervalles croisés -> conflit inévitable --
test("single footprint slot, crossing intervals -> 1 conflict", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 4);
  assert.strictEqual(r.conflicts.length, 1);
});

// --- Sanity : deux couloirs, intervalles croisés -> évitable -------------
test("two footprint slots, crossing intervals -> 0 conflict", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 2.5, y: 3.75, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 4);
  assert.strictEqual(r.conflicts.length, 0);
});

// --- Empilement : règle de taille (corrigée) ------------------------------
test("stacking rule: equal-size crate on equal-size crate is allowed", () => {
  const ctx = loadCargoPacking();
  assert.strictEqual(ctx.canStackOn(4, 4), true);
});

test("stacking rule: larger crate on smaller crate is forbidden", () => {
  const ctx = loadCargoPacking();
  assert.strictEqual(ctx.canStackOn(4, 1), false);
});

test("stacking rule: smaller crate on larger crate is allowed", () => {
  const ctx = loadCargoPacking();
  assert.strictEqual(ctx.canStackOn(1, 4), true);
});

// --- Empilement : sécurité temporelle (le support ne doit pas partir avant) -
//
// Tests directs sur hasValidSupport(grid, pos, size, boxScu, dropoffStop).
// La forme d'une cellule de grille occupée est { scu, dropoffStop, missionId }
// (voir markPlaced dans js/cargo-packing.js). On construit ici une grille
// minimale à la main plutôt que de passer par simulateRoutePacking, pour
// isoler la vérification temporelle de l'ordre de placement des caisses
// (voir le commentaire sur le test "real data: Raft" plus bas : l'ordre de
// placement peut masquer complètement ce qu'une règle rejette ou non).
function makeEmptyGrid(sizeX, sizeY, sizeZ) {
  const grid = [];
  for (let x = 0; x < sizeX; x++) {
    grid[x] = [];
    for (let y = 0; y < sizeY; y++) {
      grid[x][y] = new Array(sizeZ).fill(null);
    }
  }
  return grid;
}

test("hasValidSupport: rejects a crate resting on a support that leaves earlier", () => {
  const ctx = loadCargoPacking();
  const grid = makeEmptyGrid(1, 1, 2);
  // Caisse au sol (z=0) : elle part au stop 2 (tôt).
  grid[0][0][0] = { scu: 4, dropoffStop: 2, missionId: "m1" };
  // On tente de poser une caisse à z=1 qui doit rester jusqu'au stop 5 (tard) :
  // le support partirait avant elle -> doit être rejeté.
  const ok = ctx.hasValidSupport(grid, [0, 0, 1], [1, 1, 1], 4, 5);
  assert.strictEqual(ok, false, "support leaving before the crate above must be rejected");
});

test("hasValidSupport: allows a crate resting on a support that leaves at the same time or later", () => {
  const ctx = loadCargoPacking();
  const grid = makeEmptyGrid(1, 1, 2);
  // Caisse au sol (z=0) : elle part au stop 5 (tard), reste large donc peut
  // soutenir une caisse plus petite ou égale (canStackOn).
  grid[0][0][0] = { scu: 4, dropoffStop: 5, missionId: "m1" };
  // Caisse posée dessus qui part au stop 2 (plus tôt que son support) : sûr.
  const okEarlier = ctx.hasValidSupport(grid, [0, 0, 1], [1, 1, 1], 1, 2);
  assert.strictEqual(okEarlier, true, "support leaving after the crate above must be allowed");
  // Cas limite : même stop de livraison que le support -> autorisé (>=).
  const okEqual = ctx.hasValidSupport(grid, [0, 0, 1], [1, 1, 1], 1, 5);
  assert.strictEqual(okEqual, true, "support leaving at the exact same stop must be allowed");
});

// --- Empilement : scénario d'intégration (ordre de placement sûr) --------
test("stacking scenario: a safe dropoff order (later-dropoff crate placed first) packs both crates", () => {
  const ctx = loadCargoPacking();
  // Module d'un seul cran de large/profond, 2 crans de haut : avec la règle
  // d'empilement corrigée, les deux caisses A (dropoff=2) et B (dropoff=5)
  // peuvent se placer : B au sol (il part plus tard) et A sur B (A part tôt
  // et peut reposer sur B qui le soutient plus longtemps). Ce test vérifie
  // qu'un ordre de livraison SÛR aboutit bien à un placement complet — il ne
  // prouve PAS le rejet d'un empilement dangereux (voir les deux tests
  // directs sur hasValidSupport ci-dessus pour ça : avec ce scénario précis,
  // simulateRoutePacking place B au sol en premier de toute façon [tri par
  // dropoffStop décroissant], donc la branche de rejet de la vérification
  // temporelle n'est jamais exercée ici).
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 1.25, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 0, dropoffStop: 5 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 6);
  assert.strictEqual(r.placements.length, 2, "both boxes should be placeable");
  assert.strictEqual(r.unplaced.length, 0, "no boxes should be unplaced");
});

// --- Données réelles : Hull B (16 modules, 10 contrats) -------------------
test("real data: Hull B (16 modules, 10 real contracts) -> 0 conflicts", () => {
  const ctx = loadCargoPacking();
  const { entries, holds, stepCount } = loadFixture("hull-b-real.json");
  const r = ctx.simulateRoutePacking(entries, holds, stepCount);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, `expected 0 conflicts, got ${r.conflicts.length}`);
});

// --- Données réelles : Raft (1 module, 10 contrats) -----------------------
// Le nombre de conflits toléré est passé de 9 à 12 avec les deux fixes de
// cette tâche. Décomposition mesurée en isolant chaque changement (voir
// review de la tâche 2) :
//   - baseline avant tâche (canStackOn strict, pas de check temporel) : 9
//   - check temporel seul (canStackOn resté strict)                   : 11
//   - canStackOn permissif seul (pas de check temporel)               : 12
//   - les deux changements combinés (diff réel de cette tâche)        : 12
// Autrement dit, le fix temporel légitime n'explique que 2 des 3 conflits
// supplémentaires. Le principal responsable est le fix de canStackOn
// (strict -> <=) : simulateRoutePacking place les caisses une par une dans
// un ordre fixe, et donner à une caisse plus de positions légales (parce que
// l'empilement à taille égale est maintenant permis) change l'état de la
// grille vu par les caisses suivantes, ce qui peut orienter toute la
// séquence vers un agencement final moins bon même si chaque choix
// individuel reste localement optimal (comparaison hiérarchique stricte
// existante). C'est un effet de bord réel, dépendant de l'ordre glouton de
// placement, d'un fix par ailleurs correct — pas un bug à corriger dans
// cette tâche : les tâches 3 à 6 (réservation de zones par mission,
// empilement inter-contrats) changent la stratégie de placement et sont
// censées faire redescendre ce nombre.
test("real data: Raft (1 module, 10 real contracts) -> at most 12 conflicts (updated after stacking fix)", () => {
  const ctx = loadCargoPacking();
  const { entries, holds, stepCount } = loadFixture("raft-real.json");
  const r = ctx.simulateRoutePacking(entries, holds, stepCount);
  assert.strictEqual(r.unplaced.length, 0);
  assert.ok(r.conflicts.length <= 12, `expected <= 12 conflicts (after fix), got ${r.conflicts.length}`);
});

let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}`);
    console.log(`  ${err.message}`);
  }
});
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
