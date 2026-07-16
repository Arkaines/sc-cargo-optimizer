# Ship Cargo Access Faces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player check, per ship, which faces of its cargo grid(s) are physically accessible (arrière/avant/gauche/droite/dessus/dessous), and make the packing algorithm treat a crate as blocked only when **every** configured face is obstructed — instead of today's hardcoded single-axis assumption.

**Architecture:** Generalize the existing single-axis blocking test (`isBlocking`, keyed on one hardcoded axis+direction) into a multi-face test that iterates the player's configured faces per module (each face maps to an axis+direction via the module's own already-computed depth/width/height axes). Thread this through the two places that actually decide "is this crate physically retrievable" (`worstConflictDropoff`, and the real conflict-detection loop in `simulateRoutePacking`) — leave crate *placement* heuristics (`depthAxisIndex`'s use for delivery-order spreading, `isBetterPosition`, zone reservation) untouched, since that's a different concern. Add a small player-facing settings UI (6 checkboxes) and two missing camera-view buttons in the existing 3D viewer.

**Tech Stack:** Vanilla JS (`"use strict"`, classic script, no build step), Node `vm` + `assert` for `js/cargo-packing.js` tests (`scripts/cargo-packing-tests.cjs`), Three.js (`js/cargo-viewer.js`, ES module, unaffected except for two new camera presets).

## Global Constraints

- `simulateRoutePacking`'s existing three-argument call shape must keep working unchanged (its 4th argument, `accessFaces`, is optional) — every current call site and every existing test in `scripts/cargo-packing-tests.cjs` must still pass with zero changes.
- Default behavior (no `accessFaces` argument, or a ship absent from `state.shipAccessFaces`) must be **byte-for-byte identical** to today's single-axis heuristic (`{ back: true }` only) — this is the single most important regression to avoid.
- Do not touch `depthAxisIndex`'s use for delivery-order depth targeting (`missionBoxRank`/`idealDepthForZone`/`idealDepthForModule`), `isBetterPosition`, `assignMissionZones`, or `moduleAxes` — those solve a different problem (where to place a crate) than this plan (whether a placed crate is physically retrievable).
- Position comparison stays strictly hierarchical (`isBetterPosition`) — this plan does not add any scoring, only a boolean blocking test.
- Real-data regression fixtures (`scripts/fixtures/hull-b-real.json`, `raft-real.json`) must still report Hull B = 0 conflicts, Raft ≤ 4 conflicts when `accessFaces` is omitted.
- Every JS/CSS file change requires bumping the `?v=YYYYMMDD-rNN` cache-busting query string across all ~23 occurrences in `index.html` (current: `r13`) — do this once, in the final task, after all other files are done.
- FR and EN translations must be added together for every new i18n key — never one without the other.

---

## Task 1: Generalize the blocking-detection primitives (pure functions, no wiring yet)

**Files:**
- Modify: `js/cargo-packing.js:207-222` (`isBlocking`)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `isBlockingOnAxis(axis, direction, blockerPos, blockerSize, targetPos, targetSize)` — `direction` is `"near"` (blocker closer to coordinate 0) or `"far"` (blocker closer to the far end). Returns `bool`.
  - `isBlocking(depthAxis, blockerPos, blockerSize, targetPos, targetSize)` — **unchanged signature and behavior**, now implemented as a thin wrapper (`isBlockingOnAxis(depthAxis, "near", ...)`).
  - `DEFAULT_ACCESS_FACES` — `{ back: true }`, the constant used everywhere a ship has no configured faces.
  - `moduleFaceAxes(module)` — takes an object with `depthAxis`/`widthAxis`/`heightAxis` fields, returns `{ back, front, bottom, top, left, right }`, each value `{ axis, direction }`.
  - `accessibleFaceAxes(accessFaces, module)` — `accessFaces` is `{ back, front, left, right, top, bottom }` (each optional `bool`) or falsy (uses `DEFAULT_ACCESS_FACES`). Returns an **array** of `{ axis, direction }` for every face that's `true`.
  - `isBlockedFromEveryAccessibleFace(faceAxesList, blockerPos, blockerSize, targetPos, targetSize)` — `bool`, true only if `isBlockingOnAxis` is true for **every** entry in `faceAxesList`.

### Context for this task

Today, `isBlocking(depthAxis, blockerPos, blockerSize, targetPos, targetSize)` hardcodes a single access point: the smaller coordinate on one axis. The generalization: a "face" is an `(axis, direction)` pair — `direction: "near"` means the accessible side is the coordinate-0 end of that axis (this is what today's code always assumes); `direction: "far"` means the accessible side is the opposite end. A crate blocks another crate **via a specific face** using the exact same footprint-overlap test as today, just checked against whichever end that face represents. A crate is only *really* physically blocked if it's blocked via **every** face the player has marked accessible for that ship — if even one configured face offers a clear path, the crate is retrievable.

This task only adds the generalized primitives and reimplements `isBlocking` on top of them (proving byte-identical behavior for the default single-face case) — it does **not** yet wire anything into `worstConflictDropoff` or `simulateRoutePacking` (that's Task 2). `moduleFaceAxes`/`accessibleFaceAxes` take a plain object with `depthAxis`/`widthAxis`/`heightAxis` fields — real module objects don't have `widthAxis`/`heightAxis` yet (only `depthAxis`); Task 2 adds those.

- [ ] **Step 1: Write the failing tests**

Add to `scripts/cargo-packing-tests.cjs`, after the existing `hasValidSupport` tests (search for `"hasValidSupport: allows a crate resting on a support that leaves at the same time or later"` and insert after that test's closing `});`):

```js
// --- Faces d'accès : primitives généralisées (pas encore câblées) ---------
test("isBlockingOnAxis: near direction matches the old isBlocking exactly", () => {
  const ctx = loadCargoPacking();
  const blockerPos = [0, 0, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [0, 1, 0];
  const targetSize = [1, 1, 1];
  // depthAxis = 1 : le bloqueur (coordonnée 0) est plus proche de l'accès
  // "near" que la cible (coordonnée 1) sur cet axe, emprises qui se
  // recoupent sur les deux autres axes -> bloqué.
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), true);
  assert.strictEqual(ctx.isBlocking(1, blockerPos, blockerSize, targetPos, targetSize), true);
});

test("isBlockingOnAxis: far direction is the mirror image of near", () => {
  const ctx = loadCargoPacking();
  // Même paire de caisses, mais avec la face "loin" comme accès : maintenant
  // c'est la caisse à la coordonnée 1 (target) qui est proche de la face
  // "far" (extrémité oubliée), donc target ne bloque pas via "far" ici ---
  // on teste directement le sens : un bloqueur à coordonnée 1, cible à
  // coordonnée 0, doit être considéré comme bloquant via "far" (le bloqueur
  // est plus proche de l'extrémité opposée).
  const blockerPos = [0, 1, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [0, 0, 0];
  const targetSize = [1, 1, 1];
  assert.strictEqual(ctx.isBlockingOnAxis(1, "far", blockerPos, blockerSize, targetPos, targetSize), true);
  // Et ce même bloqueur ne bloque PAS via "near" (il est plus loin de la
  // coordonnée 0 que la cible).
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), false);
});

test("isBlockingOnAxis: no overlap on the other axes means never blocking", () => {
  const ctx = loadCargoPacking();
  const blockerPos = [0, 0, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [5, 1, 0]; // décalé sur l'axe 0 : aucun recoupement
  const targetSize = [1, 1, 1];
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), false);
});

test("moduleFaceAxes: maps all six labels to the module's real axes", () => {
  const ctx = loadCargoPacking();
  const module = { depthAxis: 1, widthAxis: 0, heightAxis: 2 };
  const faces = ctx.moduleFaceAxes(module);
  assert.deepStrictEqual(faces.back, { axis: 1, direction: "near" });
  assert.deepStrictEqual(faces.front, { axis: 1, direction: "far" });
  assert.deepStrictEqual(faces.bottom, { axis: 2, direction: "near" });
  assert.deepStrictEqual(faces.top, { axis: 2, direction: "far" });
  assert.deepStrictEqual(faces.left, { axis: 0, direction: "near" });
  assert.deepStrictEqual(faces.right, { axis: 0, direction: "far" });
});

test("accessibleFaceAxes: defaults to back-only when accessFaces is falsy", () => {
  const ctx = loadCargoPacking();
  const module = { depthAxis: 1, widthAxis: 0, heightAxis: 2 };
  const list = ctx.accessibleFaceAxes(null, module);
  assert.deepStrictEqual(list, [{ axis: 1, direction: "near" }]);
});

test("accessibleFaceAxes: returns one entry per checked face", () => {
  const ctx = loadCargoPacking();
  const module = { depthAxis: 1, widthAxis: 0, heightAxis: 2 };
  const list = ctx.accessibleFaceAxes({ back: true, bottom: true }, module);
  assert.strictEqual(list.length, 2);
  assert.ok(list.some((f) => f.axis === 1 && f.direction === "near"));
  assert.ok(list.some((f) => f.axis === 2 && f.direction === "near"));
});

test("isBlockedFromEveryAccessibleFace: blocked on one face but clear on another is NOT blocked", () => {
  const ctx = loadCargoPacking();
  // Bloqueur à [0,0,0], cible à [0,1,0] : même coordonnée sur les axes 0 et 2
  // (recoupement complet sur ces deux axes), seul l'axe 1 (profondeur) les
  // sépare. Le bloqueur est donc bloquant sur l'axe 1 via "near" (coord 0 <
  // coord 1), mais PAS sur l'axe 2 via "near" (coord 0 >= coord 0 de la
  // cible) puisque les deux partagent la même coordonnée sur cet axe.
  const blockerPos = [0, 0, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [0, 1, 0];
  const targetSize = [1, 1, 1];
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), true);
  assert.strictEqual(ctx.isBlockingOnAxis(2, "near", blockerPos, blockerSize, targetPos, targetSize), false);
  // Une seule face (profondeur) configurée -> bloqué. Les deux faces
  // (profondeur + hauteur) configurées -> PAS bloqué (la face hauteur est
  // dégagée, donc au moins une face offre un chemin libre).
  assert.strictEqual(
    ctx.isBlockedFromEveryAccessibleFace([{ axis: 1, direction: "near" }], blockerPos, blockerSize, targetPos, targetSize),
    true
  );
  assert.strictEqual(
    ctx.isBlockedFromEveryAccessibleFace(
      [
        { axis: 1, direction: "near" },
        { axis: 2, direction: "near" },
      ],
      blockerPos,
      blockerSize,
      targetPos,
      targetSize
    ),
    false
  );
});

test("isBlockedFromEveryAccessibleFace: blocked on every configured face IS blocked", () => {
  const ctx = loadCargoPacking();
  // Bloqueur qui recouvre entièrement la cible sur les 3 axes en position :
  // bloqué depuis n'importe quelle face testée (near sur les 3 axes ici).
  const blockerPos = [0, 0, 0];
  const blockerSize = [2, 2, 2];
  const targetPos = [1, 1, 1];
  const targetSize = [1, 1, 1];
  const faceAxesAll = [
    { axis: 0, direction: "near" },
    { axis: 1, direction: "near" },
    { axis: 2, direction: "near" },
  ];
  assert.strictEqual(ctx.isBlockedFromEveryAccessibleFace(faceAxesAll, blockerPos, blockerSize, targetPos, targetSize), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: FAIL — `ctx.isBlockingOnAxis`, `ctx.moduleFaceAxes`, `ctx.accessibleFaceAxes`, `ctx.isBlockedFromEveryAccessibleFace` are all `undefined` (not yet defined), so every new test throws a `TypeError`.

- [ ] **Step 3: Implement the generalized primitives**

In `js/cargo-packing.js`, replace the current `isBlocking` function (lines 207-222) with:

```js
// Une caisse bloque l'accès à une autre le long d'un AXE et d'une DIRECTION
// donnés si elle est plus proche de CETTE face précise ET que son emprise
// recoupe celle de l'autre sur les deux axes restants — il faudrait alors la
// déplacer temporairement pour atteindre celle qu'on veut sortir PAR CETTE
// FACE. direction "near" = accès par la coordonnée 0 de l'axe (arrière,
// dessous, gauche) ; "far" = accès par l'extrémité opposée (avant, dessus,
// droite) — voir docs/superpowers/specs/2026-07-17-ship-access-faces-design.md.
function isBlockingOnAxis(axis, direction, blockerPos, blockerSize, targetPos, targetSize) {
  if (direction === "near") {
    if (blockerPos[axis] >= targetPos[axis]) return false;
  } else {
    if (blockerPos[axis] + blockerSize[axis] <= targetPos[axis] + targetSize[axis]) return false;
  }
  for (let otherAxis = 0; otherAxis < 3; otherAxis++) {
    if (otherAxis === axis) continue;
    const aStart = blockerPos[otherAxis];
    const aEnd = aStart + blockerSize[otherAxis];
    const bStart = targetPos[otherAxis];
    const bEnd = bStart + targetSize[otherAxis];
    if (aEnd <= bStart || bEnd <= aStart) return false;
  }
  return true;
}

// Conservée pour compatibilité et lisibilité : le modèle historique à un
// seul axe est désormais un cas particulier (la face "arrière") de
// isBlockingOnAxis — comportement strictement identique à avant.
function isBlocking(depthAxis, blockerPos, blockerSize, targetPos, targetSize) {
  return isBlockingOnAxis(depthAxis, "near", blockerPos, blockerSize, targetPos, targetSize);
}

// Faces accessibles par défaut si le joueur n'a rien configuré pour ce
// vaisseau (voir state.shipAccessFaces dans js/app.js) : reproduit
// exactement l'ancien modèle à un seul axe (accès par l'arrière uniquement).
const DEFAULT_ACCESS_FACES = { back: true };

// Traduit les 6 étiquettes de faces (point de vue du joueur : arrière/avant/
// gauche/droite/dessus/dessous) vers les axes réels de CE module précis
// (depthAxis/widthAxis/heightAxis — calculés une fois par module, voir
// simulateRoutePacking et moduleAxes). Renvoie toujours les 6, quel que soit
// ce que le joueur a coché — le filtrage se fait dans accessibleFaceAxes.
function moduleFaceAxes(module) {
  return {
    back: { axis: module.depthAxis, direction: "near" },
    front: { axis: module.depthAxis, direction: "far" },
    bottom: { axis: module.heightAxis, direction: "near" },
    top: { axis: module.heightAxis, direction: "far" },
    left: { axis: module.widthAxis, direction: "near" },
    right: { axis: module.widthAxis, direction: "far" },
  };
}

// Liste des {axis, direction} correspondant aux faces cochées par le joueur
// pour ce vaisseau (ou DEFAULT_ACCESS_FACES si rien n'est configuré) — une
// entrée par face cochée, calculée UNE FOIS par module (pas par caisse), puis
// réutilisée pour toutes les caisses de ce module (voir simulateRoutePacking).
function accessibleFaceAxes(accessFaces, module) {
  const faces = accessFaces || DEFAULT_ACCESS_FACES;
  const mapping = moduleFaceAxes(module);
  return Object.keys(mapping)
    .filter((face) => faces[face])
    .map((face) => mapping[face]);
}

// Une caisse n'est réellement bloquée que si TOUTES les faces accessibles
// configurées sont obstruées — s'il en existe ne serait-ce qu'une seule
// dégagée, le joueur peut passer par là pour l'atteindre. Avec une seule face
// configurée (le cas par défaut), ce test est strictement équivalent à
// isBlocking.
function isBlockedFromEveryAccessibleFace(faceAxesList, blockerPos, blockerSize, targetPos, targetSize) {
  return faceAxesList.every(({ axis, direction }) =>
    isBlockingOnAxis(axis, direction, blockerPos, blockerSize, targetPos, targetSize)
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all new tests pass, and all pre-existing tests still pass unchanged (isBlocking's callers haven't changed yet, so nothing else should move).

- [ ] **Step 5: Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Ajoute les primitives généralisées de blocage multi-faces (pas encore câblées)"
```

---

## Task 2: Wire `accessFaces` through `worstConflictDropoff`, `findBestPosition`, and `simulateRoutePacking`

**Files:**
- Modify: `js/cargo-packing.js` (`worstConflictDropoff`, `findBestPosition`, `placeInBestModule`'s call site, `simulateRoutePacking`'s module construction and its two `findBestPosition` call sites and its runtime conflict loop)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes: `isBlockedFromEveryAccessibleFace`, `moduleFaceAxes`, `accessibleFaceAxes`, `DEFAULT_ACCESS_FACES` (Task 1).
- Produces:
  - `worstConflictDropoff(faceAxesList, activeBoxes, pos, size, dropoffStop)` — **signature changes**: first parameter is now a `faceAxesList` array (Task 1's shape), not a raw `depthAxis` number.
  - `findBestPosition(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, idealDepth, restriction, missionId, faceAxes)` — **one new optional trailing parameter**, `faceAxes` (an array; if omitted, defaults internally to `[{ axis: depthAxis, direction: "near" }]`, i.e. today's exact behavior).
  - `simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces)` — **one new optional trailing parameter**, `accessFaces` (the `{ back, front, left, right, top, bottom }` shape from Task 1; every existing 3-argument call keeps working identically).
  - Every module object built inside `simulateRoutePacking` gains `widthAxis`, `heightAxis` (from the existing `moduleAxes` function), and `faceAxes` (precomputed once per module via `accessibleFaceAxes`).

### Context for this task

This is the task that actually changes behavior. Two call sites currently call the OLD `isBlocking(depthAxis, ...)` directly: the real conflict-detection loop inside `simulateRoutePacking`, and (indirectly, via `depthAxis`) `worstConflictDropoff`. Both need to use the module's precomputed `faceAxes` list and the new `isBlockedFromEveryAccessibleFace` instead. Read the exact current code before editing — line numbers below are from the last read of the file during this plan's writing and may have shifted slightly if Task 1 added lines above them; search for the quoted snippets, don't trust raw line numbers blindly.

- [ ] **Step 1: Write the failing integration test**

Add to `scripts/cargo-packing-tests.cjs`, right after the Task 1 tests you just added:

```js
// --- Faces d'accès : effet de bord réel sur simulateRoutePacking ---------
test("simulateRoutePacking: a second accessible face avoids a conflict the default single face would produce", () => {
  const ctx = loadCargoPacking();
  // Module d'un seul cran de large/profond, 2 crans de haut (depthAxis=1,
  // le plus long ici serait l'axe 1 si dims=[1,2,1]... on choisit des
  // dimensions où l'axe de profondeur ET l'axe de hauteur sont bien
  // distincts et non ambigus : x=1, y=2 (profondeur, le plus long), z=2
  // (hauteur). Une seule position latérale possible (x=0), donc les deux
  // caisses ne peuvent QUE s'empiler sur l'axe de profondeur (y) ou se
  // superposer sur l'axe vertical (z) pour tenir toutes les deux.
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  // Deux missions, fenêtres disjointes qui se croisent (la seule façon de
  // forcer un vrai choix de placement) : A part tôt, B part tard, toutes
  // deux récupérées au même moment pour forcer une décision de placement.
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 0, dropoffStop: 5 },
  ];
  const stepCount = 6;

  // Comportement par défaut (une seule face, "arrière" = profondeur near) :
  // reproductible tel quel, sert de témoin — on ne fait PAS d'assertion
  // stricte dessus ici (ce n'est pas le but du test), seulement sur l'écart
  // entre les deux runs.
  const defaultRun = ctx.simulateRoutePacking(entries, holds, stepCount);

  // Avec la face "dessous" (axe vertical, near) AUSSI accessible en plus de
  // "arrière" : plus d'options de placement pour éviter un blocage.
  const withBottomRun = ctx.simulateRoutePacking(entries, holds, stepCount, { back: true, bottom: true });

  assert.strictEqual(withBottomRun.unplaced.length, 0);
  assert.ok(
    withBottomRun.conflicts.length <= defaultRun.conflicts.length,
    `expected configuring a second accessible face to never produce MORE conflicts than the default (default: ${defaultRun.conflicts.length}, with bottom: ${withBottomRun.conflicts.length})`
  );
});

test("simulateRoutePacking: omitting accessFaces behaves identically to the pre-existing 3-argument call", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 3 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 2 },
  ];
  const withoutArg = ctx.simulateRoutePacking(entries, holds, 4);
  const withDefaultArg = ctx.simulateRoutePacking(entries, holds, 4, undefined);
  assert.deepStrictEqual(withoutArg.conflicts, withDefaultArg.conflicts);
  assert.deepStrictEqual(withoutArg.unplaced, withDefaultArg.unplaced);
  assert.strictEqual(withoutArg.placements.length, withDefaultArg.placements.length);
});
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: the first new test FAILS because `simulateRoutePacking` doesn't accept (or use) a 4th argument yet, so `withBottomRun` behaves identically to `defaultRun` and can't demonstrate any improvement — inspect the actual printed conflict counts if the assertion doesn't fail outright (it's a `<=` check, so it may pass vacuously; if so, note this in your report and proceed — the real proof this task works comes from Step 4's confirmation that the counts genuinely differ, not just this test). The second test should already PASS (nothing to change there, it's a lock-in test for after this task's changes).

- [ ] **Step 3: Wire `accessFaces` through the four call sites**

Read the current `worstConflictDropoff` in `js/cargo-packing.js` (should still read exactly as documented in Task 1's Global Constraints / the codebase's existing state) and replace it with:

```js
// Gravité d'un conflit potentiel pour une position donnée : la date de
// livraison la plus proche parmi les caisses avec lesquelles ça coincerait
// (dans un sens ou dans l'autre) — Infinity si aucun conflit. faceAxesList
// est la liste des faces accessibles CONFIGURÉES POUR CE MODULE (voir
// accessibleFaceAxes) — une caisse n'est un risque que si BLOQUÉE PAR TOUTES
// les faces de cette liste (voir isBlockedFromEveryAccessibleFace) ; avec une
// seule face (le cas par défaut), ce comportement est strictement identique
// à l'ancien calcul à un seul axe.
function worstConflictDropoff(faceAxesList, activeBoxes, pos, size, dropoffStop) {
  let worst = Infinity;
  for (const other of activeBoxes) {
    if (
      isBlockedFromEveryAccessibleFace(faceAxesList, other.position, other.size, pos, size) &&
      other.dropoffStop > dropoffStop
    ) {
      worst = Math.min(worst, dropoffStop);
    }
    if (
      isBlockedFromEveryAccessibleFace(faceAxesList, pos, size, other.position, other.size) &&
      dropoffStop > other.dropoffStop
    ) {
      worst = Math.min(worst, other.dropoffStop);
    }
  }
  return worst;
}
```

In `findBestPosition`, add `faceAxes` as a new final parameter, and use it (with a backward-compatible default) in place of the raw `depthAxis` passed to `worstConflictDropoff`. Change the signature line from:

```js
function findBestPosition(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, idealDepth, restriction, missionId) {
```

to:

```js
function findBestPosition(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, idealDepth, restriction, missionId, faceAxes) {
  // Repli sur l'ancien modèle à un seul axe si l'appelant ne précise rien
  // (compatibilité stricte — aucun appel existant ne doit changer de
  // comportement sans fournir explicitement faceAxes).
  const effectiveFaceAxes = faceAxes || [{ axis: depthAxis, direction: "near" }];
```

(Insert that `effectiveFaceAxes` line as the new first line of the function body, before `const orientations = boxOrientations(box);`.) Then change the `severity` line inside the candidate object from:

```js
            severity: worstConflictDropoff(depthAxis, activeBoxes, pos, size, dropoffStop),
```

to:

```js
            severity: worstConflictDropoff(effectiveFaceAxes, activeBoxes, pos, size, dropoffStop),
```

In `placeInBestModule`, update its `findBestPosition` call from:

```js
    const result = findBestPosition(m.grid, m.cellDims, box, m.depthAxis, dropoffStop, m.activeBoxes, m.layerUsage, idealDepth, restriction, missionId);
```

to:

```js
    const result = findBestPosition(m.grid, m.cellDims, box, m.depthAxis, dropoffStop, m.activeBoxes, m.layerUsage, idealDepth, restriction, missionId, m.faceAxes);
```

In `simulateRoutePacking`, change the function signature and module construction from:

```js
function simulateRoutePacking(cargoEntries, holds, stepCount) {
  const modules = holds.map((h) => {
    const cellDims = cellsFromDimensions(h.dimensions);
    return {
      hold: h,
      cellDims,
      grid: createOccupancyGrid(cellDims),
      depthAxis: depthAxisIndex(cellDims),
      usedCells: 0,
      activeBoxes: [],
      layerUsage: new Map(),
    };
  });
```

to:

```js
function simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces) {
  const modules = holds.map((h) => {
    const cellDims = cellsFromDimensions(h.dimensions);
    const depthAxis = depthAxisIndex(cellDims);
    const { widthAxis, heightAxis } = moduleAxes(cellDims, depthAxis);
    const module = {
      hold: h,
      cellDims,
      grid: createOccupancyGrid(cellDims),
      depthAxis,
      widthAxis,
      heightAxis,
      usedCells: 0,
      activeBoxes: [],
      layerUsage: new Map(),
    };
    module.faceAxes = accessibleFaceAxes(accessFaces, module);
    return module;
  });
```

Still in `simulateRoutePacking`, find the runtime conflict-detection loop's `blockers` filter (inside the dropoff-processing block) — it currently reads:

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

Change the last condition from `isBlocking(m.depthAxis, ...)` to:

```js
            isBlockedFromEveryAccessibleFace(m.faceAxes, other.placement.position, other.placement.size, b.placement.position, b.placement.size)
```

Finally, find the zoned-placement `findBestPosition` call (inside the `eligibleZones.forEach` block) — it currently ends with `missionId` as the last argument:

```js
            const candidate = findBestPosition(
              m.grid,
              m.cellDims,
              b.box,
              m.depthAxis,
              b.dropoffStop,
              m.activeBoxes,
              m.layerUsage,
              idealDepthForZone(z),
              restriction,
              missionId
            );
```

Add `m.faceAxes` as one more trailing argument:

```js
            const candidate = findBestPosition(
              m.grid,
              m.cellDims,
              b.box,
              m.depthAxis,
              b.dropoffStop,
              m.activeBoxes,
              m.layerUsage,
              idealDepthForZone(z),
              restriction,
              missionId,
              m.faceAxes
            );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all tests pass, including both new Task 2 tests. For the first test, print/inspect (temporarily, e.g. via a one-off `console.log` you remove before committing) `defaultRun.conflicts.length` vs `withBottomRun.conflicts.length` to confirm the second is genuinely **lower**, not just equal — the assertion only checks `<=`, so manually confirm the improvement is real before trusting this task worked, the same way earlier tasks in this codebase's history verified fixtures by direct execution rather than assuming. If the two counts come out equal, that means this specific fixture doesn't exercise the new code path — adjust the module dimensions/entries until it does (the goal is a case where the single default face genuinely can't avoid a conflict but a second face can), and confirm again.

- [ ] **Step 5: Re-run the real-data fixtures to confirm zero regression**

Run: `node scripts/cargo-packing-tests.cjs` (same command — the Hull B/Raft tests are already part of the suite). Confirm Hull B is still exactly 0 conflicts and Raft is still exactly 4 (the existing `<= 4` assertion) — since neither fixture passes an `accessFaces` argument, both must be completely unaffected by this task.

- [ ] **Step 6: Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Câble accessFaces dans worstConflictDropoff, findBestPosition et simulateRoutePacking"
```

---

## Task 3: Player-facing settings — state, UI checkboxes, and wiring

**Files:**
- Modify: `js/app.js` (`defaultState`, `loadState`, new `renderShipAccessFaces` function, ship-select change handler, new checkbox change handlers, `runCargoPacking`)
- Modify: `index.html` (6 new checkboxes near the ship selector)
- Modify: `js/i18n.js` (new FR/EN keys for the 6 face labels + a title/hint)
- Modify: `css/style.css` (layout for the new checkbox group)

**Interfaces:**
- Consumes: `simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces)` (Task 2).
- Produces: `state.shipAccessFaces` (persisted, synced like the rest of `state`), `getShipAccessFaces(shipName)` helper, `renderShipAccessFaces()` (re-renders the 6 checkboxes' checked state for the currently selected ship).

### Context for this task

`state.reputationOverrides` is the existing pattern for a per-key player override dict (`js/app.js:24`, migrated in `loadState` at `js/app.js:109`). `state.selectedShip`/`state.customShipCapacity` live in the SAME sidebar block as the ship `<select>` (`index.html:57-67`) — the new 6 checkboxes belong in that same block, right after the existing capacity hint, since this is also a per-ship setting the player configures once per ship. The ship-select's existing `change` handler (`js/app.js:3023-3028`) already calls `renderShipCapacity()` after updating state — add a call to a new `renderShipAccessFaces()` there too, so the checkboxes reflect the newly-selected ship's saved configuration.

`runCargoPacking()` (`js/app.js:2190+`) is the only place that calls `simulateRoutePacking` — its current call (`js/app.js:2228`) is `const result = simulateRoutePacking(entries, holds, lastRouteResult.steps.length);`; this task adds the 4th argument there.

- [ ] **Step 1: Add `shipAccessFaces` to state (default + migration)**

In `js/app.js`, `defaultState()` currently ends with:

```js
    fleetyardsCargoHolds: {},
    fleetyardsSyncedAt: null,
  };
}
```

Change to:

```js
    fleetyardsCargoHolds: {},
    fleetyardsSyncedAt: null,
    shipAccessFaces: {},
  };
}
```

In `loadState()`, the migration block currently ends with:

```js
      fleetyardsCargoHolds: parsed.fleetyardsCargoHolds || {},
      fleetyardsSyncedAt: parsed.fleetyardsSyncedAt || null,
    };
```

Change to:

```js
      fleetyardsCargoHolds: parsed.fleetyardsCargoHolds || {},
      fleetyardsSyncedAt: parsed.fleetyardsSyncedAt || null,
      shipAccessFaces: parsed.shipAccessFaces || {},
    };
```

- [ ] **Step 2: Add the checkbox markup**

In `index.html`, the ship sidebar block currently reads (lines 57-67):

```html
  <div class="side-block">
    <h2 data-i18n="myShipTitle"></h2>
    <label for="ship-select" data-i18n="shipUsedLabel"></label>
    <select id="ship-select">
      <option value="" data-i18n="noneOption"></option>
    </select>
    <p id="ship-capacity" class="hint" style="margin-top:0.5rem;"></p>
    <label for="custom-ship-capacity" data-i18n="customCapacityLabel" style="margin-top:0.75rem;"></label>
    <input type="number" id="custom-ship-capacity" min="0" step="1" data-i18n-placeholder="customCapacityPlaceholder" />
    <p class="hint" data-i18n="customCapacityHint"></p>
  </div>
```

Add the new fieldset right after the `customCapacityHint` paragraph, still inside the same `.side-block`:

```html
  <div class="side-block">
    <h2 data-i18n="myShipTitle"></h2>
    <label for="ship-select" data-i18n="shipUsedLabel"></label>
    <select id="ship-select">
      <option value="" data-i18n="noneOption"></option>
    </select>
    <p id="ship-capacity" class="hint" style="margin-top:0.5rem;"></p>
    <label for="custom-ship-capacity" data-i18n="customCapacityLabel" style="margin-top:0.75rem;"></label>
    <input type="number" id="custom-ship-capacity" min="0" step="1" data-i18n-placeholder="customCapacityPlaceholder" />
    <p class="hint" data-i18n="customCapacityHint"></p>
    <fieldset id="ship-access-faces" class="access-faces-fieldset" style="margin-top:0.75rem;">
      <legend data-i18n="accessFacesTitle"></legend>
      <label><input type="checkbox" id="access-face-back" /> <span data-i18n="accessFaceBack"></span></label>
      <label><input type="checkbox" id="access-face-front" /> <span data-i18n="accessFaceFront"></span></label>
      <label><input type="checkbox" id="access-face-left" /> <span data-i18n="accessFaceLeft"></span></label>
      <label><input type="checkbox" id="access-face-right" /> <span data-i18n="accessFaceRight"></span></label>
      <label><input type="checkbox" id="access-face-top" /> <span data-i18n="accessFaceTop"></span></label>
      <label><input type="checkbox" id="access-face-bottom" /> <span data-i18n="accessFaceBottom"></span></label>
    </fieldset>
    <p class="hint" data-i18n="accessFacesHint"></p>
  </div>
```

- [ ] **Step 3: Add i18n keys (FR and EN, together)**

In `js/i18n.js`, the FR block has `customCapacityHint` around line 29. Add right after it:

```js
    accessFacesTitle: "Faces accessibles de la soute",
    accessFaceBack: "Arrière",
    accessFaceFront: "Avant",
    accessFaceLeft: "Gauche",
    accessFaceRight: "Droite",
    accessFaceTop: "Dessus",
    accessFaceBottom: "Dessous",
    accessFacesHint: "Coche les côtés par lesquels tu peux réellement récupérer les caisses sur ce vaisseau — au moins un doit rester coché. Ça permet à l'optimisation de ne pas signaler de faux conflits quand une caisse reste atteignable par un autre côté.",
```

The EN block has `customCapacityHint` around line 261. Add right after it:

```js
    accessFacesTitle: "Accessible cargo grid faces",
    accessFaceBack: "Back",
    accessFaceFront: "Front",
    accessFaceLeft: "Left",
    accessFaceRight: "Right",
    accessFaceTop: "Top",
    accessFaceBottom: "Bottom",
    accessFacesHint: "Check the sides you can actually reach cargo crates from on this ship — at least one must stay checked. This lets the optimizer avoid flagging false conflicts when a crate is still reachable from another side.",
```

- [ ] **Step 4: Add the render + wiring functions in `js/app.js`**

Add a new function near `renderShipCapacity` (`js/app.js:990-997`), right after it:

Note: `DEFAULT_ACCESS_FACES` (`{ back: true }`) is already defined in `js/cargo-packing.js` (Task 1) — since every script in `index.html` shares one global scope and `cargo-packing.js` loads before `app.js` (see `CLAUDE.md`'s documented script order), it's directly available here. Reuse it instead of hardcoding `{ back: true }` again, so the default can never drift out of sync between the two files.

```js
const ACCESS_FACE_KEYS = ["back", "front", "left", "right", "top", "bottom"];

function getShipAccessFaces(shipName) {
  return (shipName && state.shipAccessFaces[shipName]) || null;
}

function renderShipAccessFaces() {
  const ship = getSelectedShip();
  const faces = (ship && getShipAccessFaces(ship.name)) || DEFAULT_ACCESS_FACES;
  ACCESS_FACE_KEYS.forEach((face) => {
    const el = document.getElementById(`access-face-${face}`);
    el.checked = !!faces[face];
    el.disabled = !ship;
  });
}
```

- [ ] **Step 5: Wire the checkbox change handlers and hook into ship selection**

In `js/app.js`, the ship-select change handler (`js/app.js:3023-3028`) currently reads:

```js
  document.getElementById("ship-select").addEventListener("change", (e) => {
    state.selectedShip = e.target.value;
    saveState();
    renderShipCapacity();
    renderMissionsTable();
  });
```

Change to:

```js
  document.getElementById("ship-select").addEventListener("change", (e) => {
    state.selectedShip = e.target.value;
    saveState();
    renderShipCapacity();
    renderShipAccessFaces();
    renderMissionsTable();
  });
```

Right after the `custom-ship-capacity` change handler (`js/app.js:3030-3035`), add:

```js
  ACCESS_FACE_KEYS.forEach((face) => {
    document.getElementById(`access-face-${face}`).addEventListener("change", (e) => {
      const ship = getSelectedShip();
      if (!ship) return;
      const current = { ...(getShipAccessFaces(ship.name) || DEFAULT_ACCESS_FACES) };
      current[face] = e.target.checked;
      // Au moins une face doit rester cochée, sinon toute caisse deviendrait
      // définitivement irrécupérable sur ce vaisseau (voir
      // isBlockedFromEveryAccessibleFace : une liste vide bloque tout par
      // construction) — on annule le décochage de la dernière case restante.
      if (!ACCESS_FACE_KEYS.some((f) => current[f])) {
        e.target.checked = true;
        return;
      }
      state.shipAccessFaces[ship.name] = current;
      saveState();
      if (cargoPackState) runCargoPacking();
    });
  });
```

- [ ] **Step 6: Pass `accessFaces` into `simulateRoutePacking`**

In `js/app.js`, `runCargoPacking()` currently calls (around line 2228):

```js
  const result = simulateRoutePacking(entries, holds, lastRouteResult.steps.length);
```

Change to:

```js
  const result = simulateRoutePacking(entries, holds, lastRouteResult.steps.length, getShipAccessFaces(ship.name));
```

- [ ] **Step 7: Call `renderShipAccessFaces()` on initial load**

`js/app.js`'s `renderAll()` function (the full initial-render sequence, called once on startup) currently reads:

```js
function renderAll() {
  refreshAllLocationSelects();
  renderShipOptions();
  renderShipCapacity();
  renderMissionsTable();
  renderHistoryTable();
  renderCompaniesTab();
  renderDistanceEditor();
  renderUexStatus();
  renderBrokenElevatorsList();
  document.getElementById("route-result").innerHTML = "";
}
```

Add `renderShipAccessFaces();` immediately after `renderShipCapacity();`:

```js
function renderAll() {
  refreshAllLocationSelects();
  renderShipOptions();
  renderShipCapacity();
  renderShipAccessFaces();
  renderMissionsTable();
  renderHistoryTable();
  renderCompaniesTab();
  renderDistanceEditor();
  renderUexStatus();
  renderBrokenElevatorsList();
  document.getElementById("route-result").innerHTML = "";
}
```

This ensures the checkboxes reflect the previously-saved ship's configuration on page load, not just after a `change` event.

- [ ] **Step 8: Add minimal CSS for the fieldset**

In `css/style.css`, add (anywhere near other `.side-block`-scoped rules, e.g. after any existing `.hint` rule):

```css
.access-faces-fieldset {
  border: 1px solid var(--panel-border);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.25rem 0.75rem;
}

.access-faces-fieldset legend {
  padding: 0 0.35rem;
  font-size: 0.85rem;
  opacity: 0.85;
}

.access-faces-fieldset label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-weight: normal;
}
```

- [ ] **Step 9: Manual verification (no automated test harness for `js/app.js`)**

There's no test runner for `js/app.js` in this repo (only `js/cargo-packing.js` has one, via `scripts/cargo-packing-tests.cjs`). Verify by opening `index.html` in a browser (or serving the directory): select a ship, confirm the 6 checkboxes appear and default to "Arrière" checked when nothing was previously configured, toggle a couple, confirm the setting persists across a page reload (localStorage), and confirm unchecking the last remaining checked box snaps back to checked (doesn't allow zero faces). If browser automation is unavailable in your environment (this has been flaky in this project before — Puppeteer/Edge launch failures unrelated to the code), state clearly which of these manual checks you could and couldn't perform.

- [ ] **Step 10: Commit**

```bash
git add js/app.js index.html js/i18n.js css/style.css
git commit -m "Ajoute les cases à cocher des faces d'accès du cargo par vaisseau"
```

---

## Task 4: Add top/bottom camera view buttons to the 3D cargo viewer

**Files:**
- Modify: `js/cargo-viewer.js:357-378` (`setCargoViewerView`, the `.btn-view-sm` wiring)
- Modify: `index.html:226-229` (the 4 existing view buttons)
- Modify: `js/i18n.js` (2 new FR/EN keys)

**Interfaces:**
- Consumes: nothing new from earlier tasks (independent of Tasks 1-3, can be done in any order relative to them).
- Produces: nothing consumed by later tasks.

### Context for this task

`js/cargo-viewer.js` already has 4 camera presets (front/rear/left/right, lines 357-373) and 4 matching buttons (`index.html:226-229`). This task adds the missing top/bottom pair, using the same `data-view` + `.btn-view-sm` wiring already in place (`js/cargo-viewer.js:376-378`, unchanged — it already iterates `document.querySelectorAll(".btn-view-sm")` generically, so no JS wiring change is needed beyond `setCargoViewerView` itself). Recall `cargo-viewer.js` swaps Y and Z for Three.js's Y-up convention (documented in `CLAUDE.md`) — the real vertical axis (Z in `js/cargo-packing.js`) is Y in this file's Three.js scene, so "top"/"bottom" move the camera along `midY`, exactly mirroring how "left"/"right" already move it along `midX`.

- [ ] **Step 1: Add the two new camera branches**

In `js/cargo-viewer.js`, `setCargoViewerView` currently ends with:

```js
  if (view === "front") camera.position.set(midX, midY, midZ + distance);
  else if (view === "rear") camera.position.set(midX, midY, midZ - distance);
  else if (view === "left") camera.position.set(midX + distance, midY, midZ);
  else if (view === "right") camera.position.set(midX - distance, midY, midZ);
  controls.update();
}
```

Change to:

```js
  if (view === "front") camera.position.set(midX, midY, midZ + distance);
  else if (view === "rear") camera.position.set(midX, midY, midZ - distance);
  else if (view === "left") camera.position.set(midX + distance, midY, midZ);
  else if (view === "right") camera.position.set(midX - distance, midY, midZ);
  else if (view === "top") camera.position.set(midX, midY + distance, midZ);
  else if (view === "bottom") camera.position.set(midX, midY - distance, midZ);
  controls.update();
}
```

- [ ] **Step 2: Add the two new buttons**

In `index.html`, the view button row currently reads:

```html
          <button type="button" class="btn-secondary btn-view-sm" data-view="front" data-i18n="viewFrontBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="rear" data-i18n="viewRearBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="left" data-i18n="viewLeftBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="right" data-i18n="viewRightBtn"></button>
```

Add two more:

```html
          <button type="button" class="btn-secondary btn-view-sm" data-view="front" data-i18n="viewFrontBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="rear" data-i18n="viewRearBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="left" data-i18n="viewLeftBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="right" data-i18n="viewRightBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="top" data-i18n="viewTopBtn"></button>
          <button type="button" class="btn-secondary btn-view-sm" data-view="bottom" data-i18n="viewBottomBtn"></button>
```

- [ ] **Step 3: Add i18n keys (FR and EN, together)**

In `js/i18n.js`, the FR block has `viewRightBtn` around line 183. Add right after it:

```js
    viewTopBtn: "Vue du dessus",
    viewBottomBtn: "Vue du dessous",
```

The EN block has `viewRightBtn` around line 415. Add right after it:

```js
    viewTopBtn: "Top view",
    viewBottomBtn: "Bottom view",
```

- [ ] **Step 4: Manual verification**

Open `index.html` in a browser (or serving the directory), select a ship with cargo already packed (or run a packing pass), open the 3D viewer, and click the two new buttons — confirm the camera moves to a clear top-down and bottom-up view respectively, framing the same scene bounds as the other 4 presets. If browser verification isn't possible in your environment, state so clearly and note this as an outstanding manual check.

- [ ] **Step 5: Commit**

```bash
git add js/cargo-viewer.js index.html js/i18n.js
git commit -m "Ajoute les vues caméra dessus/dessous au visualiseur 3D du cargo"
```

---

## Task 5: Final verification, cache-busting, and docs

**Files:**
- Test: `scripts/cargo-packing-tests.cjs`
- Modify: `index.html` (cache-busting version bump, all ~23 occurrences)
- Modify: `docs/superpowers/specs/2026-07-17-ship-access-faces-design.md` (status line)

**Interfaces:** none new.

- [ ] **Step 1: Run the full non-regression suite**

Run: `node scripts/cargo-packing-tests.cjs`
Expected: all tests pass (pre-existing + every test added in Tasks 1-2), Hull B still 0 conflicts, Raft still ≤ 4 conflicts (both unaffected since neither fixture passes `accessFaces`).

- [ ] **Step 2: Real-data verification with the Raft's actual described access (back + bottom)**

This is the concrete proof the feature works on real data, per the design spec's Section 4. Using the same fixture loader already in `scripts/cargo-packing-tests.cjs` (`loadFixture("raft-real.json")`), write a small one-off script (not necessarily a committed test — a scratch script in your working directory is fine) that calls `simulateRoutePacking(entries, holds, stepCount, { back: true, bottom: true })` and compares its `conflicts.length` against the default (no 4th argument) run. Report both numbers. If the "back + bottom" run has fewer conflicts than the default run on this real fixture, that's the concrete demonstration the user asked for; if it's identical, investigate why (e.g., check whether any of the Raft's real conflicts are actually resolvable via the vertical axis at all, given the ship's real `cellDims`) and report your finding honestly either way — do not force a result.

- [ ] **Step 3: Bump cache-busting**

Run (from the repo root):

```bash
grep -o 'v=20260716-r[0-9]*' index.html | sort -u
```

Confirm the current version (should be `r13` per this plan's Global Constraints — if it's different, someone else has bumped it since this plan was written; use whatever the actual current value is as your "before" version). Then bump every occurrence by one:

```bash
sed -i 's/?v=20260716-r13/?v=20260716-r14/g' index.html
grep -c '?v=20260716-r14' index.html
```

Expected output of the last command: `23` (or however many occurrences actually exist — confirm the count matches what existed before the bump, so no occurrence was missed or double-bumped).

- [ ] **Step 4: Update the design spec status**

Add a short "Status: implemented, see commits <first>..<last>" line to the top of `docs/superpowers/specs/2026-07-17-ship-access-faces-design.md`, and record the actual measured Raft "back + bottom" vs default conflict counts from Step 2 in a new short "Vérification" note at the end of Section 4.

- [ ] **Step 5: Commit**

```bash
git add index.html docs/superpowers/specs/2026-07-17-ship-access-faces-design.md
git commit -m "Bump du cache-busting et enregistre les résultats finaux des faces d'accès"
```

**Do not push to production as part of this task** — report the final numbers to the user and let them decide when to push, per this project's established workflow.
