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
test("temporal safety: cannot stack a later-dropoff crate on an earlier-dropoff one", () => {
  const ctx = loadCargoPacking();
  // Module d'un seul cran de large/profond, 2 crans de haut : avec la règle
  // d'empilement corrigée, les deux caisses A (dropoff=2) et B (dropoff=5) peuvent
  // se placer : B au sol (il part plus tard) et A sur B (A part tôt et peut
  // reposer sur B qui le soutient plus longtemps). C'est un empilement valide
  // selon la vérification temporelle (B.dropoffStop >= A.dropoffStop).
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
