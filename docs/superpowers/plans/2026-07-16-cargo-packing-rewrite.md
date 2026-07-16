# Cargo Packing Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reactive, chronological-only cargo-packing logic in `js/cargo-packing.js` with a static, full-manifest planner that reserves each mission a real 3D zone (width × height × length) up front, allows safe cross-mission crate stacking, and only ever accepts an unavoidable conflict after confirming the entire ship has been searched.

**Architecture:** Same single file, same public entry point (`simulateRoutePacking`), same `{ placements, unplaced, conflicts, peakStepIndex }` return shape — `js/app.js` and `js/cargo-viewer.js` do not change. Internally: (1) a corrected, temporally-safe stacking primitive used everywhere crates can rest on other crates, (2) a 3D-aware `assignMissionZones` with two tiers (independent width-lane, then safe cross-mission height-stacking), (3) the existing chronological grid walk kept as the mechanism that models real, time-varying occupancy — it now always searches the mission's full 3D zone before ever falling through to a ship-wide, then last-resort, search.

**Tech Stack:** Vanilla JS (`"use strict"`, classic script, no build step), Node `vm` module + `assert` for testing (no test framework exists in this repo), Puppeteer scripts (already used ad hoc this session) for whole-app browser verification.

## Global Constraints

- No behavior change to `js/app.js` or `js/cargo-viewer.js` — `simulateRoutePacking(cargoEntries, holds, stepCount)` keeps its exact signature and return shape.
- Crate footprint/height values in `SCU_BOX_SIZES` are FleetYards-verified real dimensions — never change them without re-verifying against the API.
- Stacking rule: a crate may only rest on a crate of **equal or larger** SCU size (Task 2 fixes this from the previous, backwards "strictly smaller" rule).
- Position comparison is **strictly hierarchical** (see `isBetterPosition`), never an additive score — this was tried and measurably regressed a real scenario (Section 4 of the design spec).
- Every improvement claim must be backed by running `node scripts/cargo-packing-tests.cjs` (real data) — never assumed from reading the code.
- Full design context: `docs/superpowers/specs/2026-07-16-cargo-packing-rewrite-design.md`.

---

## Task 1: Regression test harness and real-data fixtures — ALREADY DONE

**Status:** Completed and committed (`ed53cc7`) while writing this plan, so the remaining tasks have a verified baseline to work against. Nothing to do here except be aware it exists.

**Files:**
- `scripts/cargo-packing-tests.cjs` — assert-based runner (no framework), loads `js/cargo-packing.js` via `vm` per test.
- `scripts/fixtures/raft-real.json`, `scripts/fixtures/hull-b-real.json` — the same 10 real user contracts (23 cargo lines), with the Raft's single 192-SCU hold and Hull B's 16 real holds respectively.

**Interfaces:**
- Produces: `node scripts/cargo-packing-tests.cjs` — exits 0 and prints `5/5 passed` when nothing has regressed. Every later task ends with running this command.

Current baseline (do not regress below these without an explicit, deliberate reason recorded in the task's commit message):
- Hull B: 0 conflicts.
- Raft: at most 9 conflicts (the test allows `<= 9` since Tasks 2-6 are expected to improve this, not just match it).

---

## Task 2: Fix the stacking rule and close the temporal support-safety gap

**Files:**
- Modify: `js/cargo-packing.js:110-139` (`canStackOn`, `hasValidSupport`)
- Modify: `js/cargo-packing.js:394-410` (`tryStackOnExisting` — one call site of `hasValidSupport` gains an argument)
- Modify: `js/cargo-packing.js:336-383` (`findBestPosition` — the other call site)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `hasValidSupport(grid, pos, size, boxScu, dropoffStop)` — **signature changes**, gains a required `dropoffStop` parameter. Every existing call site must be updated in this same task.

### Context for this task

Two separate bugs live in the current stacking logic:

1. `canStackOn(newScu, baseScu)` returns `newScu < baseScu` (strictly smaller only). The real rule, confirmed by the user, is **equal or smaller is fine, only strictly larger is forbidden** — you can stack two 4-SCU crates on each other; you cannot put a 4-SCU crate on a 1-SCU crate.
2. `hasValidSupport` checks the size rule but never checks **how long** the supporting crate will stay. If crate A (dropoff at stop 3) is under crate B (dropoff at stop 10), A leaving at stop 3 leaves B floating in mid-air with no code path ever noticing. This is a real, previously-undiscovered gap — it is also exactly what makes cross-mission stacking (Task 4) safe or unsafe, so it must be fixed here, generically, before Task 4 relies on it.

The fix: `hasValidSupport` also takes the new crate's `dropoffStop` and requires every supporting cell's stored `dropoffStop` to be `>=` the new crate's `dropoffStop` (the support must leave at the same time or later, never earlier). Grid cells already store `{ dropoffStop, scu, missionId }` (see `markPlaced` call sites), so this only needs a new comparison, no new data.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/cargo-packing-tests.cjs`, right after the "two footprint slots" test and before the "Données réelles" comment block:

```js
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
  // Module d'un seul cran de large/profond, 2 crans de haut : la seule
  // façon de loger les deux caisses A (dropoff=2) et B (dropoff=5, plus
  // tardif) est d'empiler B sur A. C'est justement interdit : A partirait
  // avant B, qui se retrouverait en l'air.
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 1.25, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 0, dropoffStop: 5 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 6);
  assert.strictEqual(r.unplaced.length, 1, "B should be unplaced: the only geometric spot is unsafe to stack on");
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: the 3 stacking-rule tests FAIL (`canStackOn(4,4)` is currently `false`, not `true`). The temporal-safety test currently PASSES for the wrong reason (today's code doesn't have height=2 zones separated this way in this exact 1x1x2 module — verify by running it; if it unexpectedly passes already, that's fine, it becomes a lock-in test for Step 4, not a red step. If it fails with `unplaced.length !== 1`, note the actual value before moving on.)

- [ ] **Step 3: Fix `canStackOn` and `hasValidSupport`**

Replace in `js/cargo-packing.js`:

```js
// Règle d'empilement : une caisse ne peut reposer sur une autre que si sa
// taille est INFÉRIEURE OU ÉGALE à celle de la caisse du dessous (ex. deux
// caisses de 4 SCU peuvent se poser l'une sur l'autre ; une caisse de 4 SCU
// ne peut PAS se poser sur une caisse de 1 SCU) — spécifique au jeu, pas une
// simple histoire de tenir géométriquement dans l'empreinte. Confirmé par
// l'utilisateur : la règle avait été implémentée à l'envers ("strictement
// plus petite uniquement"), ce qui interdisait à tort deux caisses de même
// taille de s'empiler.
function canStackOn(newScu, baseScu) {
  return newScu <= baseScu;
}

// Une caisse ne peut jamais flotter : elle doit reposer au sol (z=0) ou avoir
// toute son empreinte directement soutenue par d'autres caisses juste en
// dessous (contact complet, pas de trou, taille autorisée par canStackOn, ET
// dont la date de livraison est ÉGALE OU POSTÉRIEURE à celle de la caisse du
// dessus) — sans cette dernière vérification, une caisse pourrait reposer
// sur une caisse qui repart plus tôt et se retrouver en l'air en cours de
// route sans qu'aucun conflit ne soit jamais détecté. z (index 2) est
// toujours l'axe vertical réel (voir cellsFromDimensions), indépendamment de
// l'axe d'accès choisi pour ce module (depthAxis). C'est cette règle,
// appliquée partout où une caisse peut en supporter une autre (pas seulement
// au sein d'un même contrat), qui rend l'empilement croisé entre contrats
// sûr (voir assignMissionZones).
function hasValidSupport(grid, pos, size, boxScu, dropoffStop) {
  const [px, py, pz] = pos;
  const [sx, sy] = size;
  if (pz === 0) return true;
  for (let x = px; x < px + sx; x++) {
    for (let y = py; y < py + sy; y++) {
      const below = grid[x][y][pz - 1];
      if (!below) return false;
      if (!canStackOn(boxScu, below.scu)) return false;
      if (below.dropoffStop < dropoffStop) return false;
    }
  }
  return true;
}
```

- [ ] **Step 4: Update both call sites to pass `dropoffStop`**

In `tryStackOnExisting` (around line 402), change:
```js
if (canPlace(m.grid, m.cellDims, pos, size) && hasValidSupport(m.grid, pos, size, box.scu)) {
```
to:
```js
if (canPlace(m.grid, m.cellDims, pos, size) && hasValidSupport(m.grid, pos, size, box.scu, dropoffStop)) {
```

In `findBestPosition` (around line 363), change:
```js
if (!hasValidSupport(grid, pos, size, box.scu)) continue;
```
to:
```js
if (!hasValidSupport(grid, pos, size, box.scu, dropoffStop)) continue;
```

- [ ] **Step 5: Run the tests to verify they now pass**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: `8/8 passed` (5 from Task 1 plus the 3 new stacking tests; the temporal-safety test was written in Step 1 as part of this same batch).

- [ ] **Step 6: Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Corrige la règle d'empilement (égal/plus grand autorisé) et ajoute la sécurité temporelle de support"
```

---

## Task 3: 3D-aware zone reservation, Tier 1 (independent width-lane, full height)

**Files:**
- Modify: `js/cargo-packing.js:412-567` (`assignMissionZones`)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes: `boxes` (array of `{ box: { scu, footprint, height }, entry: { mission: { id }, ... }, pickupStop, dropoffStop, ... }`), `modules` (array of `{ hold, cellDims, depthAxis, grid, activeBoxes, layerUsage }`, as built in `simulateRoutePacking`).
- Produces: `assignMissionZones(boxes, modules)` returns `Map<missionId, Array<Zone>>` where a `Zone` is now:
  ```
  {
    module,               // reference to the module object (unchanged)
    widthAxis,            // int 0-2: which cell axis is "width" for this module
    heightAxis,           // int 0-2: which cell axis is "height" (Z, almost always)
    widthStart, widthEnd, // int cell range on widthAxis
    heightStart, heightEnd, // int cell range on heightAxis (0..full height for Tier 1)
    minPickupStop,        // int: earliest pickupStop among this mission's boxes (needed by Task 4)
    maxDropoffStop,       // int: latest dropoffStop among this mission's boxes (needed by Task 4)
  }
  ```
  This **replaces** the previous `{ module, laneAxis, laneStart, laneEnd }` shape — every reader of a zone (in `simulateRoutePacking`, updated in Task 5) must use the new field names.

### Context for this task

The existing 1D lane-packing logic (pack missions into independent width-lanes, full depth, but *all* of the height reserved to the owning mission by default) is correct and stays almost as-is — this task only renames `laneAxis`/`laneStart`/`laneEnd` to the `width*`/`height*` vocabulary from the design spec, and adds an explicit `heightStart`/`heightEnd` (always the module's full height range for a Tier 1 zone) plus the mission's presence window (`minPickupStop`/`maxDropoffStop`), both of which Task 4 needs. No behavioral change yet — Task 4 adds the new Tier 2 fallback.

- [ ] **Step 1: Write the failing test**

Add to `scripts/cargo-packing-tests.cjs`, after the stacking-rule tests:

```js
// --- Zonage 3D : tier 1, voie indépendante en largeur ---------------------
test("zone assignment: two missions on a wide module each get their own width-lane, full height", () => {
  const ctx = loadCargoPacking();
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2], // largeur=8, profondeur=12, hauteur=2 (forme du Raft)
      depthAxis: 1,
    },
  ];
  const boxes = [
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 0, dropoffStop: 5 },
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 1, dropoffStop: 9 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  const z1 = zones.get(1)[0];
  const z2 = zones.get(2)[0];
  assert.strictEqual(z1.heightStart, 0);
  assert.strictEqual(z1.heightEnd, 2, "tier 1 zone reserves the full height for its own mission");
  assert.strictEqual(z2.heightStart, 0);
  assert.strictEqual(z2.heightEnd, 2);
  // Les deux voies en largeur ne doivent jamais se recouvrir.
  const overlap = z1.widthStart < z2.widthEnd && z2.widthStart < z1.widthEnd;
  assert.strictEqual(overlap, false, "the two missions must not share a width range");
  assert.strictEqual(z1.minPickupStop, 0);
  assert.strictEqual(z1.maxDropoffStop, 5);
  assert.strictEqual(z2.minPickupStop, 1);
  assert.strictEqual(z2.maxDropoffStop, 9);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: FAIL — current zones use `laneStart`/`laneEnd`, so `z1.heightStart` is `undefined`, not `0`.

- [ ] **Step 3: Rewrite `assignMissionZones`**

Replace the entire function (from `function assignMissionZones(boxes, modules) {` through its closing `}` and the preceding comment block) with:

```js
// Réserve à chaque contrat (mission) sa/ses propre(s) zone(s) 3D AVANT même
// de commencer à ranger quoi que ce soit : le trajet entier est déjà connu
// (quantités, tailles, dates de récup/livraison de TOUTES les marchandises),
// ce n'est pas un vrai flux en ligne — voir le principe général dans
// docs/superpowers/specs/2026-07-16-cargo-packing-rewrite-design.md.
//
// Tier 1 (cette fonction, sans le tier 2 — voir Task 4) : découpe chaque
// module en VOIES le long de l'axe latéral le plus large (widthAxis), PAS le
// long de l'axe de profondeur — chaque voie garde TOUTE la profondeur ET
// TOUTE la hauteur du module pour ce contrat. Découper par tranches de
// profondeur entières gaspillait la plupart de la capacité réelle d'un
// vaisseau (un cran de profondeur ENTIER par contrat, bien plus que
// nécessaire) ; découper par largeur laisse à chaque contrat de quoi étaler
// ses propres caisses selon leur ordre de sortie (voir missionBoxRank).
//
// Renvoie une Map missionId -> [{ module, widthAxis, heightAxis, widthStart,
// widthEnd, heightStart, heightEnd, minPickupStop, maxDropoffStop }, ...]
// (une zone par tranche de largeur réservée ; plusieurs zones si le contrat
// ne tient pas dans un seul module). Prend les caisses déjà décomposées (pas
// les lignes de cargaison brutes) pour connaître la vraie empreinte de
// chacune.
function moduleAxes(cellDims, depthAxis) {
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  // Z (index 2) est toujours l'axe vertical réel — sert de hauteur, sauf
  // dans le cas rare où l'axe de profondeur choisi EST déjà Z (module plus
  // haut que long) : on retombe alors sur "le plus grand des deux axes
  // restants = largeur".
  if (depthAxis !== 2) return { widthAxis: planeAxes.find((a) => a !== 2), heightAxis: 2 };
  const [a, b] = planeAxes;
  return cellDims[a] >= cellDims[b] ? { widthAxis: a, heightAxis: b } : { widthAxis: b, heightAxis: a };
}

function assignMissionZones(boxes, modules) {
  const missionNeed = new Map();
  boxes.forEach((b) => {
    const missionId = b.entry.mission && b.entry.mission.id;
    if (missionId == null) return; // pas de contrat identifiable : pas de zone dédiée, recherche libre à l'exécution.
    const cur = missionNeed.get(missionId) || {
      mission: b.entry.mission,
      totalScu: 0,
      minFootprintNeeded: 1,
      minPickupStop: b.pickupStop,
      maxDropoffStop: b.dropoffStop,
    };
    cur.totalScu += b.box.scu;
    // Une caisse ne peut pivoter qu'à plat (voir boxOrientations) : sa PLUS
    // PETITE dimension d'empreinte est le minimum de crans qu'il lui faut
    // d'un coup sur l'axe de largeur, quelle que soit l'orientation choisie.
    const minFootprint = Math.min(b.box.footprint[0], b.box.footprint[1]);
    if (minFootprint > cur.minFootprintNeeded) cur.minFootprintNeeded = minFootprint;
    if (b.pickupStop < cur.minPickupStop) cur.minPickupStop = b.pickupStop;
    if (b.dropoffStop > cur.maxDropoffStop) cur.maxDropoffStop = b.dropoffStop;
    missionNeed.set(missionId, cur);
  });

  // loEdge/hiEdge : bornes encore libres de chaque module SUR L'AXE DE
  // LARGEUR, DES DEUX CÔTÉS (pas juste un pointeur qui avance depuis un
  // bord) — un premier contrat dans un module prend un côté (lo), le
  // suivant l'autre (hi), en alternance.
  const moduleState = modules.map((m) => {
    const { widthAxis, heightAxis } = moduleAxes(m.cellDims, m.depthAxis);
    return {
      module: m,
      widthAxis,
      heightAxis,
      laneCapacity: m.cellDims[m.depthAxis] * m.cellDims[heightAxis],
      loEdge: 0,
      hiEdge: m.cellDims[widthAxis],
      maxWidth: m.cellDims[widthAxis],
      nextSide: "lo",
    };
  });

  // Les plus gros contrats d'abord : leur donne la première chance de tenir
  // entiers dans un seul module plutôt que d'être scindés inutilement.
  const missionsSorted = [...missionNeed.values()].sort((a, b) => b.totalScu - a.totalScu);
  const zonesByMission = new Map();

  missionsSorted.forEach(({ mission, totalScu, minFootprintNeeded, minPickupStop, maxDropoffStop }) => {
    let remaining = totalScu;
    const zones = [];
    while (remaining > 0.0001) {
      const openModules = moduleState.filter((ms) => ms.hiEdge - ms.loEdge > 0);
      if (!openModules.length) break; // Plus de voie libre nulle part : le tier 2 (Task 4) ou le repli en recherche libre prendra le relais.

      const freeCapOf = (ms) => (ms.hiEdge - ms.loEdge) * ms.laneCapacity;
      const isFresh = (ms) => ms.loEdge === 0 && ms.hiEdge === ms.maxWidth;

      let bestFit = null;
      openModules.forEach((ms) => {
        if (!isFresh(ms)) return;
        const freeCap = freeCapOf(ms);
        if (freeCap >= remaining && (!bestFit || freeCap < bestFit.freeCap)) bestFit = { ms, freeCap };
      });
      if (!bestFit) {
        openModules.forEach((ms) => {
          if (isFresh(ms)) return;
          const freeCap = freeCapOf(ms);
          if (freeCap >= remaining && (!bestFit || freeCap < bestFit.freeCap)) bestFit = { ms, freeCap };
        });
      }
      const ms =
        bestFit?.ms ||
        openModules.reduce((best, cur) => {
          const curFresh = isFresh(cur) ? 1 : 0;
          const bestFresh = isFresh(best) ? 1 : 0;
          if (curFresh !== bestFresh) return curFresh > bestFresh ? cur : best;
          return freeCapOf(cur) > freeCapOf(best) ? cur : best;
        });

      const freeWidth = ms.hiEdge - ms.loEdge;
      const neededWidth = Math.min(freeWidth, Math.max(minFootprintNeeded, Math.ceil(remaining / ms.laneCapacity)));
      const side = ms.nextSide;
      ms.nextSide = side === "lo" ? "hi" : "lo";

      let widthStart, widthEnd;
      if (side === "lo") {
        widthStart = ms.loEdge;
        widthEnd = ms.loEdge + neededWidth;
        ms.loEdge = widthEnd;
      } else {
        widthEnd = ms.hiEdge;
        widthStart = ms.hiEdge - neededWidth;
        ms.hiEdge = widthStart;
      }
      zones.push({
        module: ms.module,
        widthAxis: ms.widthAxis,
        heightAxis: ms.heightAxis,
        widthStart,
        widthEnd,
        heightStart: 0,
        heightEnd: ms.module.cellDims[ms.heightAxis],
        minPickupStop,
        maxDropoffStop,
      });
      remaining -= neededWidth * ms.laneCapacity;
    }
    zonesByMission.set(mission.id, zones);
  });

  return zonesByMission;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: the new zone-assignment test passes. The Hull B / Raft real-data tests will now FAIL or error, because `simulateRoutePacking` still reads the old `laneAxis`/`laneStart`/`laneEnd` field names — that's expected and fixed in Task 5. For this task, only check the new unit test passes; ignore real-data failures for now (Task 5 wires them back together).

- [ ] **Step 5: Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Réécrit assignMissionZones en 3D (largeur/hauteur/profondeur), tier 1 seul pour l'instant"
```

---

## Task 4: 3D-aware zone reservation, Tier 2 (safe cross-mission height-stacking)

> **Revision note (post-Task-3 discovery):** the version below replaces an earlier draft that gated a Tier-2 host on `heightEnd < module full height`. That precondition can never be true: Task 3's Tier-1 zones always reserve the module's *full* height by design (tested and approved — see `zone assignment: two missions on a wide module each get their own width-lane, full height`), so no Tier-1 zone ever has "spare height" to report. A Task 4 implementer correctly caught this by direct execution and escalated instead of guessing (exactly the right call). The design is corrected here: a Tier-2 guest zone reuses the **entire spatial footprint** of its host (same width AND height range), not a carved-out sub-range above it. This matches the design spec's own words (Section 3): reserving a zone only guarantees *temporal* safety; it does not carve out guaranteed physical capacity, and actual non-overlap is enforced later, at the crate level, by `canPlace` (grid occupancy) and `hasValidSupport` (Task 2's temporal/size check) — a guest's crates can only occupy cells the host's crates aren't already using, and can only rest on a host crate that safely outlasts them. If a mission's real need doesn't fit inside the shared footprint once crates are actually placed, it falls through to Task 6's ship-wide last-resort search, exactly as the spec already anticipates ("If no position inside the zone satisfies the size rule, that mission falls through to the ship-wide search"). This does **not** require touching Task 3's code at all — Tier-1 zones stay exactly as implemented.

**Files:**
- Modify: `js/cargo-packing.js` (inside `assignMissionZones`, the `while (remaining > 0.0001)` loop from Task 3)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes: the `moduleState` array and zone shape from Task 3.
- Produces: no new function, but `assignMissionZones` now also returns, for some missions, a zone whose `module`/`widthAxis`/`heightAxis`/`widthStart`/`widthEnd`/`heightStart`/`heightEnd` are identical to another mission's existing zone (a Tier-2 guest sharing its host's footprint).

### Context for this task

When Task 3's `openModules` filter finds no free width-lane anywhere, instead of immediately `break`-ing (falling through to the ship-wide search), try stacking the candidate mission on top of an **already-placed zone** (from any mission, Tier 1 or Tier 2) whose presence window (`minPickupStop`..`maxDropoffStop`) **fully contains** the candidate's. This is only temporally safe because of that containment — the host is guaranteed present for the guest's entire stay. Track already-placed zones in a flat list as they're created so later missions can search them as potential hosts. Because zone reservation happens before any crate is actually placed (the "static, full-manifest" principle), there is no way to know upfront exactly how much of the host's footprint will still be free — so a Tier-2 grant is advisory capacity, not a guaranteed allocation, and satisfies the WHOLE candidate mission's remaining need in one grant (ending the `while` loop for that mission); Task 5's real crate-level search is what determines what actually fits, and Task 6's ship-wide search is the safety net for whatever doesn't.

- [ ] **Step 1: Write the failing test**

Add to `scripts/cargo-packing-tests.cjs`, right after the Task 3 zone-assignment test:

```js
// --- Zonage 3D : tier 2, empilement croisé sécurisé entre contrats -------
test("zone assignment: a mission whose window is fully contained by another gets stacked on it", () => {
  const ctx = loadCargoPacking();
  // Module étroit : une seule voie en largeur possible (8 crans, mais
  // chaque caisse a besoin de 8 crans à elle seule, donc AUCUNE voie libre
  // ne reste pour un deuxième contrat).
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2],
      depthAxis: 1,
    },
  ];
  const boxes = [
    // Hôte : présent du stop 0 au stop 10, prend toute la largeur.
    { box: { scu: 32, footprint: [8, 12], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 0, dropoffStop: 10 },
    // Invité : présent du stop 2 au stop 5, ENTIÈREMENT à l'intérieur de la fenêtre de l'hôte.
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 2, dropoffStop: 5 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  const guestZones = zones.get(2);
  assert.ok(guestZones && guestZones.length, "the guest mission must get a zone via tier 2 stacking");
  const guest = guestZones[0];
  const host = zones.get(1)[0];
  // Le tier 2 réutilise EXACTEMENT l'empreinte spatiale de l'hôte (pas une
  // sous-plage de hauteur découpée) — la non-collision réelle est assurée
  // plus tard, caisse par caisse, par canPlace/hasValidSupport (Task 5), pas
  // par le zonage lui-même.
  assert.strictEqual(guest.widthStart, host.widthStart);
  assert.strictEqual(guest.widthEnd, host.widthEnd);
  assert.strictEqual(guest.heightStart, host.heightStart);
  assert.strictEqual(guest.heightEnd, host.heightEnd);
  assert.strictEqual(guest.module, host.module);
});

test("zone assignment: a mission whose window is NOT contained gets no tier-2 zone (falls through)", () => {
  const ctx = loadCargoPacking();
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2],
      depthAxis: 1,
    },
  ];
  const boxes = [
    { box: { scu: 32, footprint: [8, 12], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 2, dropoffStop: 5 },
    // Invité candidat : commence AVANT que l'hôte ne soit présent -> pas sûr.
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 0, dropoffStop: 4 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  const guestZones = zones.get(2) || [];
  assert.strictEqual(guestZones.length, 0, "no safe host exists, so no zone should be reserved");
});

test("zone assignment: a third mission nested inside two other missions' windows still gets a tier-2 zone", () => {
  const ctx = loadCargoPacking();
  // Note : la containment de fenêtres temporelles est transitive (si la
  // fenêtre de la mission 3 est contenue dans celle de la mission 2, qui est
  // elle-même contenue dans celle de la mission 1, alors la mission 1 la
  // contient forcément aussi) — et le tier 2 copie EXACTEMENT l'empreinte
  // spatiale de son hôte, donc un troisième niveau ne produit pas une
  // empreinte différente d'un deuxième niveau. Ce test vérifie seulement
  // qu'empiler plusieurs invités sur le même hôte (ou une chaîne d'hôtes
  // équivalents) reste possible et ne casse rien — pas quel hôte précis
  // `.find` choisit en interne.
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2],
      depthAxis: 1,
    },
  ];
  const boxes = [
    { box: { scu: 32, footprint: [8, 12], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 0, dropoffStop: 20 },
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 5, dropoffStop: 15 },
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 3 } }, pickupStop: 8, dropoffStop: 12 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  assert.ok((zones.get(2) || []).length, "mission 2 must get a tier-2 zone");
  assert.ok((zones.get(3) || []).length, "mission 3 must also get a tier-2 zone despite mission 1's lane already being reused once");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: the first and third new tests FAIL (`guestZones` empty for missions 2/3 — today's code just `break`s when out of width). The second one currently passes for the right reason already (no code path grants a zone) — that's fine, it's a lock-in test.

- [ ] **Step 3: Add Tier 2 to `assignMissionZones`**

Inside `assignMissionZones`, add a flat list of all placed zones before the `missionsSorted.forEach`, and use it inside the `while` loop's "no open module" branch. Replace:

```js
    while (remaining > 0.0001) {
      const openModules = moduleState.filter((ms) => ms.hiEdge - ms.loEdge > 0);
      if (!openModules.length) break; // Plus de voie libre nulle part : le tier 2 (Task 4) ou le repli en recherche libre prendra le relais.
```

with:

```js
    while (remaining > 0.0001) {
      const openModules = moduleState.filter((ms) => ms.hiEdge - ms.loEdge > 0);
      if (!openModules.length) {
        // Tier 2 : plus de voie libre, cherche un hôte déjà placé (n'importe
        // quelle mission, tier 1 ou déjà empilée en tier 2) dont la fenêtre de
        // présence contient ENTIÈREMENT celle du contrat courant. Sûr
        // uniquement parce que l'hôte est garanti présent pendant tout le
        // séjour de l'invité — mais cette réservation ne garantit QUE la
        // sécurité temporelle, pas une capacité physique précise (le zonage
        // se fait avant tout placement réel de caisse, voir le principe de
        // planification statique). L'invité reprend donc EXACTEMENT
        // l'empreinte spatiale de l'hôte (même largeur, même hauteur) plutôt
        // qu'une sous-plage de hauteur découpée au-dessus : la non-collision
        // réelle est assurée plus tard, caisse par caisse, par
        // canPlace (occupation de grille) et hasValidSupport (règle de
        // taille + sécurité temporelle, voir Task 2) — une caisse de
        // l'invité ne peut occuper qu'une cellule libre, et ne peut reposer
        // que sur une caisse de l'hôte qui reste au moins aussi longtemps.
        // Si le besoin réel de l'invité ne tient finalement pas dans cette
        // empreinte partagée, il retombe sur la recherche ville-entière de
        // dernier recours (Task 6), exactement comme prévu par la conception.
        const host = allZones.find(
          (z) => z.minPickupStop <= minPickupStop && z.maxDropoffStop >= maxDropoffStop
        );
        if (!host) break; // Vraiment plus de place : le repli en recherche libre (Task 6) prendra le relais.

        const zone = {
          module: host.module,
          widthAxis: host.widthAxis,
          heightAxis: host.heightAxis,
          widthStart: host.widthStart,
          widthEnd: host.widthEnd,
          heightStart: host.heightStart,
          heightEnd: host.heightEnd,
          minPickupStop,
          maxDropoffStop,
        };
        zones.push(zone);
        allZones.push(zone);
        // On ne peut pas mesurer la capacité réellement libre dans
        // l'empreinte de l'hôte à ce stade (elle dépend du placement réel
        // des caisses, résolu par Task 5) : on considère le besoin de ce
        // contrat comme couvert par CETTE zone unique, quitte à ce que
        // Task 5/6 découvrent qu'il n'y a en réalité pas assez de place et
        // fassent remonter l'excédent vers la recherche de dernier recours.
        remaining = 0;
        continue;
      }
```

And add, right before `missionsSorted.forEach(`:

```js
  const allZones = []; // toutes les zones déjà attribuées (tier 1 et tier 2), dans l'ordre, pour servir d'hôtes potentiels au tier 2.
```

And inside the existing Tier 1 success path (where `zones.push({ module: ms.module, ... })` already happens), also push to `allZones` — change:

```js
      zones.push({
        module: ms.module,
        widthAxis: ms.widthAxis,
        heightAxis: ms.heightAxis,
        widthStart,
        widthEnd,
        heightStart: 0,
        heightEnd: ms.module.cellDims[ms.heightAxis],
        minPickupStop,
        maxDropoffStop,
      });
```

to:

```js
      const zone = {
        module: ms.module,
        widthAxis: ms.widthAxis,
        heightAxis: ms.heightAxis,
        widthStart,
        widthEnd,
        heightStart: 0,
        heightEnd: ms.module.cellDims[ms.heightAxis],
        minPickupStop,
        maxDropoffStop,
      };
      zones.push(zone);
      allZones.push(zone);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all three new tests pass. Real-data tests still fail/error — expected until Task 5.

- [ ] **Step 5: Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Ajoute le tier 2 du zonage : empilement croisé sécurisé entre contrats, même empreinte que l'hôte"
```

---

## Task 5: Wire the new 3D zone shape into box placement

**Files:**
- Modify: `js/cargo-packing.js` inside `simulateRoutePacking` (the zone-consuming block, previously reading `zone.laneStart`/`laneEnd`/`laneAxis`)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes: `Zone` shape from Tasks 3-4 (`widthAxis`, `heightAxis`, `widthStart/End`, `heightStart/End`).
- Produces: no new function; `simulateRoutePacking`'s external behavior (return shape) is unchanged, only its internal zone-restriction logic changes.

### Context for this task

`findBestPosition` already accepts a `restriction` argument that can be a single `{ axis, allowed }` object **or an array of them** (see the existing `restrict` helper inside `findBestPosition`) — this was built generically enough that no change is needed there. Only the *caller* inside `simulateRoutePacking`, which currently builds a single width restriction, needs to build **two** restrictions (width and height) from the new zone shape.

- [ ] **Step 1: Locate and replace the zone-restriction block**

Find this block inside `simulateRoutePacking` (the `if (!placed) { const zones = ... }` block that builds `restrictionForModule`):

```js
        if (!placed) {
          const zones = (missionId != null ? zonesByMission.get(missionId) : null) || [];
          const zoneModules = zones
            .filter((z) => !(z.module.hold.maxContainerSize && b.box.scu > z.module.hold.maxContainerSize))
            .map((z) => z.module);
          const zoneByModule = new Map();
          zones.forEach((z) => zoneByModule.set(z.module, z));
          // La zone restreint désormais l'axe de VOIE (largeur), pas la
          // profondeur (voir assignMissionZones) : toute la profondeur du
          // module reste disponible pour ce contrat.
          const restrictionForModule = (m) => {
            const zone = zoneByModule.get(m);
            if (!zone) return null;
            const allowed = new Set();
            for (let v = zone.laneStart; v < zone.laneEnd; v++) allowed.add(v);
            return { axis: zone.laneAxis, allowed };
          };
          // Profondeur idéale = rang de CETTE caisse parmi celles du MÊME
          // contrat, rapporté à TOUTE la profondeur du module (disponible en
          // entier dans sa voie — pas la fraction du trajet entier, voir
          // missionBoxRank plus haut).
          const rankFrac = missionBoxRank.get(b) ?? dropoffFrac;
          const idealDepthForModule = (m) => {
            const maxDepthIdx = m.cellDims[m.depthAxis] - 1;
            return maxDepthIdx > 0 ? rankFrac * maxDepthIdx : 0;
          };
          placed = placeInBestModule(zoneModules, b.box, b.dropoffStop, idealDepthForModule, restrictionForModule, missionId);
        }
```

Replace it with:

```js
        if (!placed) {
          const zones = (missionId != null ? zonesByMission.get(missionId) : null) || [];
          const eligibleZones = zones.filter(
            (z) => !(z.module.hold.maxContainerSize && b.box.scu > z.module.hold.maxContainerSize)
          );
          // Profondeur idéale = rang de CETTE caisse parmi celles du MÊME
          // contrat, rapporté à TOUTE la profondeur du module (disponible en
          // entier dans sa zone — pas la fraction du trajet entier, voir
          // missionBoxRank plus haut).
          const rankFrac = missionBoxRank.get(b) ?? dropoffFrac;
          const idealDepthForZone = (z) => {
            const maxDepthIdx = z.module.cellDims[z.module.depthAxis] - 1;
            return maxDepthIdx > 0 ? rankFrac * maxDepthIdx : 0;
          };
          // IMPORTANT : un contrat peut avoir PLUSIEURS zones DANS LE MÊME
          // module (une voie tier 1 partielle, puis un empilement tier 2
          // ailleurs dans ce même module une fois la voie épuisée). Fusionner
          // leurs plages largeur/hauteur dans une seule restriction (union
          // des largeurs, union des hauteurs, filtrées indépendamment par
          // findBestPosition) est FAUX : ça autoriserait une position qui
          // combine la largeur d'une zone avec la hauteur d'une AUTRE zone,
          // un rectangle qui n'a jamais été réservé (et qui peut appartenir à
          // un autre contrat). Chaque zone doit donc être essayée
          // séparément — jamais fusionnée avec une autre — et seule la
          // meilleure position parmi TOUTES les zones (tous modules confondus)
          // est retenue, via la même comparaison hiérarchique `isBetterPosition`
          // déjà utilisée partout ailleurs dans ce fichier.
          let best = null;
          eligibleZones.forEach((z) => {
            const restriction = [
              { axis: z.widthAxis, allowed: new Set(Array.from({ length: z.widthEnd - z.widthStart }, (_, i) => z.widthStart + i)) },
              { axis: z.heightAxis, allowed: new Set(Array.from({ length: z.heightEnd - z.heightStart }, (_, i) => z.heightStart + i)) },
            ];
            const candidate = findBestPosition(z.module.grid, z.module.cellDims, z.module.depthAxis, b.box, idealDepthForZone(z), restriction, missionId, z.module.activeBoxes, b.dropoffStop);
            if (candidate && (!best || isBetterPosition(candidate, best.position, z.module, best.module))) {
              best = { position: candidate, module: z.module };
            }
          });
          if (best) {
            markPlaced(best.module, b.box, best.position, missionId, b.dropoffStop);
            placed = { module: best.module, position: best.position };
          }
        }
```

Read the actual current signatures of `findBestPosition`, `isBetterPosition`, and `markPlaced` in `js/cargo-packing.js` before transcribing this step — the parameter names/order above follow the file as last read for this plan, but confirm them against the real file first (this file changes fast across tasks) and adjust the call sites to match exactly. The non-negotiable part of this step is the *shape* of the fix: one `findBestPosition` call per zone, never a merged multi-zone restriction, and the overall winner chosen via the same hierarchical comparator already used elsewhere — not by any additive scoring.

- [ ] **Step 2: Write a test proving multi-zone-per-module correctness**

Add to `scripts/cargo-packing-tests.cjs`, after the Task 4 zone-assignment tests:

```js
// --- Régression : plusieurs zones du même contrat dans le même module ----
test("placement: a mission with two zones in the same module never mixes their width/height ranges", () => {
  const ctx = loadCargoPacking();
  // Un seul module, large de 8 crans, 2 crans de haut. Mission A tient toute
  // la largeur (8 crans) pendant tout le trajet -> pas de voie tier-1 libre
  // pour quiconque. Mission B a deux besoins bien distincts et temporellement
  // disjoints (2 lots), forçant potentiellement deux zones dans CE module si
  // le zonage la fait s'empiler à deux endroits différents. On vérifie
  // simplement qu'aucun conflit non nécessaire n'apparaît et qu'aucune caisse
  // ne finit hors de tout rectangle réservé valide (0 conflit ici : les deux
  // lots de B tiennent chacun dans la fenêtre de A).
  const holds = [{ name: "test", dimensions: { x: 10, y: 15, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const missionA = { id: 1, name: "A" };
  const missionB = { id: 2, name: "B" };
  const entries = [
    { quantity: 32, commodity: "Host", mission: missionA, pickupStop: 0, dropoffStop: 14 },
    { quantity: 4, commodity: "GuestEarly", mission: missionB, pickupStop: 1, dropoffStop: 4 },
    { quantity: 4, commodity: "GuestLate", mission: missionB, pickupStop: 8, dropoffStop: 12 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 15);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, "both of B's lots fit safely within A's window; mixing zone axes must not cause a spurious conflict or an invalid placement");
});
```

- [ ] **Step 3: Run the tests to verify real-data tests pass again**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all tests pass, including the new multi-zone test, Hull B (0 conflicts), and Raft (`<= 9`, record the actual number — it is expected to improve now that height-stacking is available, but the test only asserts the not-worse bound).

- [ ] **Step 4: If Raft's conflict count improved, tighten the regression test**

If the printed Raft conflict count is now below 9, update the assertion in `scripts/cargo-packing-tests.cjs` from `r.conflicts.length <= 9` to the new actual number (with a comment noting the date/task this was measured), so future regressions are caught precisely rather than just "still under the old number."

- [ ] **Step 5: Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Branche le zonage 3D (tier 1 + tier 2) dans le placement des caisses, une zone à la fois"
```

---

## Task 6: Verify the ship-wide last-resort search already benefits from safe cross-mission stacking

**Files:**
- Test: `scripts/cargo-packing-tests.cjs` (no production code expected to change — see below)

**Interfaces:**
- Consumes: `placeInBestModule`, `findBestPosition` (unchanged signatures from Task 2).
- Produces: nothing new — this task is verification, not new functionality, unless Step 1's test reveals a real gap.

### Context for this task

Per the design spec (Section 5), a conflict must only be accepted after confirming the *entire ship* — every module, every zone, every safe cross-mission stacking option — has been searched. The ship-wide fallback path (the `byFreeSpace` block in `simulateRoutePacking`, used when a mission has no zone or its zone is full) already calls `findBestPosition` unrestricted across every module. Because Task 2 made `hasValidSupport` check temporal safety generically (not just inside zone tier 2), **any** call to `findBestPosition` — including this ship-wide fallback — already considers stacking safely on top of *any* other mission's crate, not just crates from a formally-reserved Tier 2 zone. This task exists to prove that with a real test, not just to assume it from reading the code.

- [ ] **Step 1: Write the test**

Add to `scripts/cargo-packing-tests.cjs`, after the Task 4 zone-assignment tests:

```js
// --- Recherche libre : profite aussi de l'empilement croisé sûr ----------
test("ship-wide fallback: stacks safely on another mission's crate rather than forcing a conflict", () => {
  const ctx = loadCargoPacking();
  // Un seul module, une seule voie en largeur (assez pour 1 caisse de 4 SCU
  // à la fois), 2 crans de hauteur. Mission A (contrat 1) tient toute la
  // largeur pendant tout le trajet (stop 0 à 14, aucune zone tier 1 pour un
  // deuxième contrat). Mission B (contrat 2) est entièrement contenue dans
  // la fenêtre de A : la recherche libre doit l'empiler sur A plutôt que de
  // forçer un conflit.
  const holds = [{ name: "test", dimensions: { x: 2.5, y: 15, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const missionA = { id: 1, name: "A" };
  const missionB = { id: 2, name: "B" };
  const entries = [
    { quantity: 4, commodity: "Host", mission: missionA, pickupStop: 0, dropoffStop: 14 },
    { quantity: 4, commodity: "Guest", mission: missionB, pickupStop: 3, dropoffStop: 8 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 15);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, "the guest should stack safely on the host instead of conflicting");
});
```

- [ ] **Step 2: Run the test**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: PASS, given Tasks 2-5 are complete. If it FAILs, that reveals a real gap: the ship-wide fallback's module ordering (`byFreeSpace`, sorted by `usedCells`) or `isCompatible` mission-preference filtering may be steering the search away from a module that already has the host's crate before trying to stack there. If so:
  - Print the actual conflict from `r.conflicts` to see which crate and why.
  - The likely fix is that `isCompatible` (which currently prefers modules with **zero** other missions' crates, or only the same mission's) should not *exclude* a module containing a different mission's crate from being tried at all — it should still be tried, just after fully-empty or same-mission modules. Check whether `byFreeSpace`'s sort already does this (it sorts, not filters, so it should) before concluding a code change is needed. Only touch `js/cargo-packing.js` if the test actually proves a gap — do not "fix" something the test doesn't demonstrate is broken.

- [ ] **Step 3: Commit**

```bash
git add scripts/cargo-packing-tests.cjs
git commit -m "Ajoute une vérification : la recherche libre profite aussi de l'empilement croisé sûr"
```

(If Step 2 required a production-code fix, include `js/cargo-packing.js` in this commit too and describe the actual gap found in the commit message instead of the placeholder message above.)

---

## Task 6bis: Fix `worstConflictDropoff`'s inverted polarity (found and confirmed while executing Task 6)

> **Why this task exists:** while verifying Task 6, an implementer (and, independently, a task reviewer who reproduced everything from scratch — code reading, a hand-built reproduction scenario, and direct calls to the function in isolation) confirmed a real, pre-existing bug in `worstConflictDropoff`: its two risk conditions are the exact opposite of the real runtime conflict-detection loop's own condition. This directly undermines this whole plan's Section 5 requirement ("never accept an avoidable conflict without a genuine ship-wide search") — a position that is actually risky can score as perfectly safe (`Infinity`), and vice versa, so the search can pick a real, avoidable conflict over an available safe stack. The user asked for this fixed within this plan, as its own task with its own test/review cycle, rather than deferred to a future session.

**Files:**
- Modify: `js/cargo-packing.js` (`worstConflictDropoff` only, lines ~231-242 as last read for this plan — confirm current line numbers)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `worstConflictDropoff(depthAxis, activeBoxes, pos, size, dropoffStop)` — **signature unchanged**, only its internal comparison logic changes. Every caller (`findBestPosition`, line ~376) keeps working as-is.

### Context for this task

`isBlocking(depthAxis, blockerPos, blockerSize, targetPos, targetSize)` returns true when `blockerPos` is closer to the module's access point (smaller depth coordinate) than `targetPos`, and their footprints overlap on the other two axes — i.e., `blocker` physically stands between the access point and `target`.

The REAL conflict rule, read directly from `simulateRoutePacking`'s runtime dropoff loop (confirmed against the actual file, not just this plan's earlier read of it — re-confirm current line numbers before editing):

```js
const blockers = boxes.filter(
  (other) =>
    other !== b &&
    other.active &&
    other.dropoffStop !== step &&
    other.placement.module === m &&
    isBlocking(m.depthAxis, other.placement.position, other.placement.size, b.placement.position, b.placement.size)
);
```

This only runs for `b` at `step === b.dropoffStop`, and only considers still-`active` boxes with `other.dropoffStop !== step` — since any box with an earlier dropoff would already have been removed by a prior step's iteration, every surviving `other` here necessarily has `other.dropoffStop > step` (i.e., **later** than `b`'s own dropoff). So: **a conflict is real exactly when a blocker (closer to access) leaves LATER than the box trying to leave.** Boxes leaving at the exact same step are never blockers (`!== step`) — they both depart at once, so ordering between them doesn't matter.

`worstConflictDropoff` is meant to score this same risk *before* a box is even placed, for two symmetric cases (an already-active `other` blocking our *candidate* position, and our candidate blocking an already-active `other`) — but both of its conditions currently use `<` where they need `>`, exactly inverted:

```js
function worstConflictDropoff(depthAxis, activeBoxes, pos, size, dropoffStop) {
  let worst = Infinity;
  for (const other of activeBoxes) {
    if (isBlocking(depthAxis, other.position, other.size, pos, size) && other.dropoffStop < dropoffStop) {
      worst = Math.min(worst, other.dropoffStop);
    }
    if (isBlocking(depthAxis, pos, size, other.position, other.size) && dropoffStop < other.dropoffStop) {
      worst = Math.min(worst, dropoffStop);
    }
  }
  return worst;
}
```

Worked through both branches against the real rule above:
- **Branch 1** (`other` blocks our candidate): real risk is `other` (the blocker) leaving **later** than our candidate — `other.dropoffStop > dropoffStop`, not `<`. When this is true, our candidate is the one that can't leave on time; the conflict "bites" at our candidate's own (earlier) `dropoffStop`, so the tracked value must be `dropoffStop` (ours), not `other.dropoffStop`.
- **Branch 2** (our candidate blocks `other`): real risk is our candidate leaving **later** than `other` — `dropoffStop > other.dropoffStop`, not `<`. When true, `other` is the one that can't leave on time; the conflict bites at `other`'s own (earlier) `dropoffStop`, so the tracked value must be `other.dropoffStop`, not `dropoffStop`.

So both the comparison direction AND which value gets recorded into `worst` need to swap, in both branches — a clean, symmetric fix, not a one-line tweak of just the operators.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/cargo-packing-tests.cjs`, after the Task 2 `hasValidSupport` tests:

```js
// --- worstConflictDropoff : polarité correcte (corrigée après Task 6) ----
test("worstConflictDropoff: a blocker that leaves LATER than the candidate is a real risk", () => {
  const ctx = loadCargoPacking();
  const activeBoxes = [{ position: [0, 0, 0], size: [1, 1, 1], dropoffStop: 20 }];
  // Notre caisse candidate est bloquée par `other` (plus proche de l'accès,
  // recoupement d'emprise) qui part APRÈS elle (20 > 5) : conflit réel.
  const severity = ctx.worstConflictDropoff(1, activeBoxes, [0, 1, 0], [1, 1, 1], 5);
  assert.notStrictEqual(severity, Infinity, "a blocker leaving later than our candidate must be scored as risky, not safe");
});

test("worstConflictDropoff: a blocker that already left BEFORE the candidate's dropoff is safe", () => {
  const ctx = loadCargoPacking();
  const activeBoxes = [{ position: [0, 0, 0], size: [1, 1, 1], dropoffStop: 3 }];
  // `other` part AVANT notre candidate (3 < 20) : il sera déjà parti, donc
  // aucun conflit réel au moment où notre candidate devra elle-même partir.
  const severity = ctx.worstConflictDropoff(1, activeBoxes, [0, 1, 0], [1, 1, 1], 20);
  assert.strictEqual(severity, Infinity, "a blocker that already departed before our candidate's own dropoff must be scored as safe");
});

test("worstConflictDropoff: our candidate blocking an other that leaves earlier is a real risk", () => {
  const ctx = loadCargoPacking();
  // `other` est ici la cible bloquée par NOTRE candidate (recoupement, notre
  // candidate plus proche de l'accès) ; other part avant nous (5 < 20) :
  // conflit réel (other ne pourra pas sortir à temps).
  const activeBoxes = [{ position: [0, 1, 0], size: [1, 1, 1], dropoffStop: 5 }];
  const severity = ctx.worstConflictDropoff(1, activeBoxes, [0, 0, 0], [1, 1, 1], 20);
  assert.notStrictEqual(severity, Infinity, "blocking an other that leaves earlier than us must be scored as risky, not safe");
});
```

(Coordinates: `depthAxis = 1`, so axis 1 is the access/depth axis — smaller value on axis 1 is closer to access. Both boxes occupy the same slice on axes 0/2 so their footprints overlap on the required "other two axes" for `isBlocking`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all three new tests FAIL against the current (inverted) code — the first and third currently return `Infinity` (wrongly "safe"), the second currently returns a finite number (wrongly "risky").

- [ ] **Step 3: Fix `worstConflictDropoff`**

Replace the function with:

```js
// Gravité d'un conflit potentiel pour une position donnée : la date de
// livraison la plus proche parmi les caisses avec lesquelles ça coincerait
// (dans un sens ou dans l'autre) — Infinity si aucun conflit. Utilisé par la
// fonction de score (voir scorePosition) pour transformer un blocage
// potentiel en pénalité : plus le conflit arrive tôt (livraison proche), plus
// il coûte cher, pour toujours préférer déplacer un blocage lointain plutôt
// qu'un blocage imminent quand aucune position n'est totalement sûre.
//
// Corrigé (Task 6bis) : un blocage n'est un risque QUE si le bloqueur (plus
// proche de l'accès) est encore présent au moment où la caisse qui doit
// sortir la première a besoin de partir — c'est-à-dire si le bloqueur part
// PLUS TARD que celle qu'il bloque (voir la boucle réelle de détection de
// conflit dans simulateRoutePacking : elle ne compte un blocage que si
// other.dropoffStop est postérieur au step de départ de la caisse bloquée).
// L'ancienne version comparait dans le sens inverse (`<` au lieu de `>`),
// ce qui pouvait faire scorer Infinity (sûr) une position réellement en
// conflit, et inversement — trouvé et confirmé lors de la Task 6 par
// exécution directe, pas seulement par lecture de code.
function worstConflictDropoff(depthAxis, activeBoxes, pos, size, dropoffStop) {
  let worst = Infinity;
  for (const other of activeBoxes) {
    if (isBlocking(depthAxis, other.position, other.size, pos, size) && other.dropoffStop > dropoffStop) {
      worst = Math.min(worst, dropoffStop);
    }
    if (isBlocking(depthAxis, pos, size, other.position, other.size) && dropoffStop > other.dropoffStop) {
      worst = Math.min(worst, other.dropoffStop);
    }
  }
  return worst;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all three new tests pass.

- [ ] **Step 5: Add the real-world regression scenario found during Task 6's review**

The Task 6 reviewer independently reconstructed a scenario that forces the ship-wide fallback path (not the zoned path) and reproduces a real, avoidable conflict caused by this bug: a full-width host mission present stop 0-20, and a second mission with TWO lots — one nested inside the host's window (stop 3-5), one entirely after the host has departed (stop 25-30) — whose AGGREGATE window (3-30) is NOT contained by the host's (0-20), so `assignMissionZones` gives it zero zones, forcing every one of its boxes through the ship-wide fallback. Add this as a committed regression test (the reviewer verified it reliably reproduces; you'll need to tune exact quantities/footprints so the host is processed first by `assignMissionZones`, per the reviewer's note that this required "tuning quantities so the host... is processed first"):

```js
// --- Régression : conflit évitable via la recherche de dernier recours ---
test("ship-wide fallback: does not force an avoidable conflict when a safe stack exists (Task 6bis regression)", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 2.5, y: 15, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const host = { id: 1, name: "Host" };
  const guest = { id: 2, name: "Guest" };
  const entries = [
    // Hôte : présent du stop 0 au stop 20, prend toute la largeur (le plus
    // gros besoin total en SCU pour être traité en premier par assignMissionZones).
    { quantity: 8, commodity: "Host", mission: host, pickupStop: 0, dropoffStop: 20 },
    // Invité : deux lots dont la fenêtre AGRÉGÉE (3 à 30) déborde de celle de
    // l'hôte (0 à 20) -> assignMissionZones ne lui donne AUCUNE zone,
    // forçant le passage par la recherche de dernier recours (byFreeSpace).
    { quantity: 4, commodity: "GuestEarly", mission: guest, pickupStop: 3, dropoffStop: 5 },
    { quantity: 4, commodity: "GuestLate", mission: guest, pickupStop: 25, dropoffStop: 30 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 31);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, "a safe stack on Host was available for GuestEarly; the fallback must not force an avoidable conflict");
});
```

If this exact fixture doesn't reproduce the zero-zone condition for you (`assignMissionZones` processing order can be sensitive to exact SCU/footprint values), adjust quantities until a direct call to `ctx.assignMissionZones(...)` confirms the guest mission gets zero zones, then confirm the test fails against the CURRENT (pre-fix) code with a real conflict, before applying Step 3's fix and re-confirming it passes.

- [ ] **Step 6: Re-run the full suite and confirm Hull B / Raft have not regressed**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all tests pass. Since this fix makes conflict-severity scoring MORE accurate (not just different), Hull B must stay at 0 and Raft's conflict count may improve further — if it does, tighten the Raft assertion to the new measured number (with a comment noting it was measured at Task 6bis), same convention as earlier tasks.

- [ ] **Step 7: Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Corrige la polarité inversée de worstConflictDropoff (pouvait accepter un conflit évitable)"
```

**Explicitly out of scope for this task:** the Task 6 investigation also noted that `idealDepthForModule` (used by the ship-wide fallback, as opposed to the zoned path's mission-relative `missionBoxRank`) computes ideal depth from a route-global `dropoffStop / stepCount` fraction rather than a mission-relative rank — this only mattered as a *secondary* tie-break because severity was incorrectly tied at `Infinity` for both candidates in the reported scenario. Once this task's fix makes severity correctly discriminate (a real conflict scores far below `Infinity`), that specific scenario no longer needs the depth tie-break to reach the right answer. Whether `idealDepthForModule`'s global-fraction basis is *also* worth changing for the ship-wide fallback (to mirror the zoned path's mission-relative ranking) is a separate, lower-priority design question — do not change it in this task; note it for a future follow-up if the human wants to pursue it.

---

## Task 7: Full verification and cleanup

**Files:**
- Test: `scripts/cargo-packing-tests.cjs` plus the existing Puppeteer scripts already used this session (not part of the repo — re-create them locally if needed, or ask the user for the current location of `test-route-conflict.cjs`, `test-route-aware-packing.cjs`, `test-spread-realistic.cjs`)
- Modify: `js/cargo-packing.js` (comment cleanup only, no logic changes)

**Interfaces:** none new.

- [ ] **Step 1: Run the full non-regression suite one more time**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all tests pass. Record the final Hull B and Raft conflict counts.

- [ ] **Step 2: Re-run the adversarial and realistic browser scenarios**

These live outside the repo (built ad hoc during the session that produced this plan). Recreate them if the local test server (`static-server.cjs`) and a Puppeteer-capable browser are available:
- The 60-mission adversarial stress test (all missions' intervals crossing) — confirm the conflict count has not regressed above whatever was last measured for the current code before this rewrite started.
- The realistic small-scenario tests (2-6 missions, no adversarial crossing) — confirm they still report 0 conflicts.

If browser automation isn't available in the environment (it was flaky during this session — Puppeteer/Edge launch failures unrelated to the code), state clearly to the user that only the Node-based `scripts/cargo-packing-tests.cjs` suite could be verified, and which browser-based checks are still outstanding.

- [ ] **Step 3: Clean up stale comments**

Search `js/cargo-packing.js` for comments that describe the *old* architecture and no longer match the code (e.g., any remaining reference to "laneAxis"/"laneStart" naming, or to the old strictly-smaller stacking rule). Fix any found in place — this is a documentation-only change, verify with `git diff` that no logic lines changed.

- [ ] **Step 4: Update the design spec status**

Add a short "Status: implemented, see commits ed53cc7..<final>" line to the top of `docs/superpowers/specs/2026-07-16-cargo-packing-rewrite-design.md`, and record the final measured Hull B / Raft conflict counts in its Section 6 (Verification), replacing the "expected to improve" wording with the actual numbers.

- [ ] **Step 5: Fix the outdated "known limitation" note in `CLAUDE.md`**

`CLAUDE.md`'s Architecture section currently says, about `assignMissionZones`:

```
- Known limitation, not a bug to "fix" reflexively: a single-hold ship with more active contracts than the hold has independent lateral positions cannot geometrically isolate every contract — some residual conflicts are a real physical constraint of the ship's geometry, not an algorithm gap. Verify against the ship's actual `cellDims` before assuming more code will remove them.
```

This predates the discovery that height (Z) also separates missions, not just width, and predates Tier 2 cross-mission stacking (Task 4) — a ship's real independent-isolation capacity is width-lanes × safe-stacking depth, not just width-lanes. Replace that bullet with:

```
- `assignMissionZones` reserves a mission its own width-lane (tier 1) first; when a module runs out of independent width-lanes, a mission can still get a zone by safely stacking on top of another mission's crates (tier 2) if that host's presence window (earliest pickup to latest dropoff) fully contains the candidate's — see `moduleAxes`, and the design rationale in `docs/superpowers/specs/2026-07-16-cargo-packing-rewrite-design.md`. A ship can only run out of ways to isolate contracts when even this cross-mission stacking is exhausted ship-wide — verify against the ship's actual `cellDims` and real mission data (via `scripts/cargo-packing-tests.cjs`) before assuming a residual conflict is a hard geometric limit rather than a further algorithm gap.
```

Also update the `SCU_BOX_SIZES`/stacking-rule bullet if it still describes the old "strictly smaller only" rule anywhere in the file — search for "smaller" in `CLAUDE.md` and correct any remaining mention to "equal or larger, never smaller" (matching Task 2's fix).

- [ ] **Step 6: Commit**

```bash
git add js/cargo-packing.js docs/superpowers/specs/2026-07-16-cargo-packing-rewrite-design.md CLAUDE.md
git commit -m "Nettoie les commentaires obsolètes et enregistre les résultats finaux de la réécriture"
```

**Do not push to production as part of this task** — report the final numbers to the user and let them decide when to push, per this project's established workflow this session.
