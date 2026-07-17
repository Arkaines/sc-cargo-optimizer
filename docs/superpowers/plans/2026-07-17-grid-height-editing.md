# Grid Height Editing (v2 of manual cargo-grid placement) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player set the HEIGHT of each cargo grid, not just its floor position, by dragging in the plane of whichever preset view is active.

**Architecture:** Extends the shipped v1 (ground-only) manual placement. `cargoViewerLayout[ship][moduleKey]` gains an optional `y`; absent `y` keeps the automatic height (so existing saved entries behave exactly as today). The drag plane is chosen from the camera's dominant axis and passes through the module's current position, so top view drags X/Z while front/side views drag height plus one horizontal axis.

**Tech Stack:** Vanilla JS, `js/cargo-viewer.js` (the project's only ES module, imports three.js), `js/app.js` (classic script). Verification: `node scripts/cargo-packing-tests.cjs` + headless Edge driven by `puppeteer-core`.

**Spec:** `docs/superpowers/specs/2026-07-17-manual-cargo-grid-placement-design.md`, section 5.

## Global Constraints

- **1 SCU = 1.25 m.** Every moved axis (including Y) snaps with `Math.round(v / UNIT) * UNIT` and clamps to `>= 0` — reuse the existing `snapToUnit` helper in `js/cargo-viewer.js`, which already does both.
- **Display-only.** Never modify `js/cargo-packing.js`. `node scripts/cargo-packing-tests.cjs` must stay **34/34** after every task.
- **Backward compatible, zero regression.** A saved entry WITHOUT a `y` key must not override `worldPos[1]` — the module keeps its automatic height, exactly as v1 behaves today. Never write `y: undefined`; either the key is present with a number or it is absent.
- **Persist the module ORIGIN (corner)** — the same `worldPos[0]/[1]/[2]` the renderer uses, never the pick box's centre (the pick box is centred at origin + half-dims).
- **Viewer ↔ app boundary.** The viewer never touches `state`; it calls `window.persistCargoModulePosition(...)`, defined in `js/app.js`. `js/app.js` treats module keys as opaque.
- **Ship scoping.** All viewer-arrangement reads/writes go through `getCargoViewerShipName()` (the ship the displayed scene was packed for), never `getSelectedShip()` — switching the dropdown does not re-pack.
- **Cache-busting:** bump every `?v=` occurrence in `index.html` (all 23) in each task that ships. Current value `20260717-r24` → `-r25` (Task 1), `-r26` (Task 2).

## Verification Harness (both tasks)

Server: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/` should be `200`; else `python -m http.server 8080` from the repo root, backgrounded.

`puppeteer-core` is installed in the session scratchpad — run scripts from
`C:/Users/djour/AppData/Local/Temp/claude/C--Users-djour/3186ed14-d20c-422b-a76c-10acb67e1996/scratchpad`.
Edge: `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`. Launch headless with a FRESH `--user-data-dir` and a free `--remote-debugging-port`, connect via `puppeteer.connect({ browserURL })`, always `page.on("dialog", (d) => d.accept())`, find the page with `pages.find(p => p.url().includes("localhost:8080"))`. Kill with `taskkill //F //IM msedge.exe`.

**A fresh browser profile has no FleetYards hold data**, so the viewer renders nothing. Force it once after the first page load:
```js
await page.evaluate(async () => { await syncFleetyardsCargoHolds(); });
```
Expect `{ships: 97}`-ish; the Caterpillar must report 14 holds / 576 SCU.

Then seed a mission and pack (the viewer only appears once a packing result exists):
```js
async function packShip(page, shipPrefix) {
  await page.evaluate(() => document.querySelector('[data-tab="new-mission-tab"]').click());
  await new Promise((r) => setTimeout(r, 200));
  const labels = await page.evaluate(() => {
    const o = Array.from(document.querySelectorAll("#locations-datalist option")).map((x) => x.value);
    return { lorville: o.find((v) => v.startsWith("Lorville")), area18: o.find((v) => v.startsWith("Area 18")) };
  });
  await page.type("#mission-name", "HeightTest");
  await page.type("#mission-giver", "Covalex");
  await page.type("#mission-reward", "5000");
  await page.type(".cargo-commodity-input", "Titane");
  await page.type(".cargo-quantity-input", "8");
  await page.type(".cargo-pickup-input", labels.lorville);
  await page.type(".cargo-dropoff-input", labels.area18);
  await page.evaluate(() => document.querySelector("#mission-submit-btn").click());
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate((p) => {
    const sel = document.querySelector("#ship-select");
    sel.value = Array.from(sel.options).find((o) => o.textContent.startsWith(p)).value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, shipPrefix);
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => document.querySelector('[data-tab="optimize-tab"]').click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) =>
      x.textContent.trim().toUpperCase().includes("OPTIMISER"));
    if (b) b.click();
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => document.querySelector('[data-tab="cargo-tab"]').click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => document.querySelector("#pack-cargo-btn")?.click());
  await new Promise((r) => setTimeout(r, 1400));
}
```

---

## Task 1: Persist and apply an optional height (`y`)

**Files:**
- Modify: `js/cargo-viewer.js` (the override block; `onLayoutPointerUp`)

**Interfaces:**
- Consumes: `window.persistCargoModulePosition(moduleKey, x, z)` (`js/app.js`) — this task widens its call to 4 arguments.
- Produces (used by Task 2): layout entries of shape `{x, y, z}`; the override honouring `y`.

- [ ] **Step 1: Honour `y` in the override**

In `js/cargo-viewer.js`, find the override block (it currently reads):
```js
  const overrides = savedLayout || {};
  layout.forEach((l) => {
    const custom = overrides[moduleKey(l.hold, holds)];
    if (custom) {
      l.worldPos[0] = custom.x;
      l.worldPos[2] = custom.z;
    }
  });
```
Replace the inner assignment so height is applied only when the entry actually carries one:
```js
  const overrides = savedLayout || {};
  layout.forEach((l) => {
    const custom = overrides[moduleKey(l.hold, holds)];
    if (custom) {
      l.worldPos[0] = custom.x;
      l.worldPos[2] = custom.z;
      // Rétrocompatibilité : une entrée enregistrée par la v1 n'a pas de `y`.
      // Dans ce cas on laisse la hauteur calculée automatiquement (modules
      // empilés par la reconstruction), comportement v1 strictement
      // inchangé — pas de migration à faire.
      if (typeof custom.y === "number") l.worldPos[1] = custom.y;
    }
  });
```

- [ ] **Step 2: Persist the height on drop**

In `js/cargo-viewer.js`, `onLayoutPointerUp` currently reads:
```js
  const { dx, dz } = dragTarget.userData.dims;
  const originX = snapToUnit(dragTarget.position.x - dx / 2);
  const originZ = snapToUnit(dragTarget.position.z - dz / 2);
  if (typeof window.persistCargoModulePosition === "function") {
    window.persistCargoModulePosition(dragTarget.userData.moduleKey, originX, originZ);
  }
```
Change it to also read and pass the height (the pick box is centred, so subtract half the height to get the origin):
```js
  const { dx, dy, dz } = dragTarget.userData.dims;
  const originX = snapToUnit(dragTarget.position.x - dx / 2);
  const originY = snapToUnit(dragTarget.position.y - dy / 2);
  const originZ = snapToUnit(dragTarget.position.z - dz / 2);
  if (typeof window.persistCargoModulePosition === "function") {
    window.persistCargoModulePosition(dragTarget.userData.moduleKey, originX, originY, originZ);
  }
```

- [ ] **Step 3: Widen the app-side persist helper**

In `js/app.js`, `window.persistCargoModulePosition` currently takes `(moduleKey, x, z)` and writes `{ x, z }`. Change the signature to `(moduleKey, x, y, z)` and write all three axes:
```js
window.persistCargoModulePosition = function persistCargoModulePosition(moduleKey, x, y, z) {
  const shipName = getCargoViewerShipName();
  if (!shipName || !moduleKey) return;
  if (!state.cargoViewerLayout[shipName]) state.cargoViewerLayout[shipName] = {};
  state.cargoViewerLayout[shipName][moduleKey] = { x, y, z };
  saveState();
};
```
Keep the surrounding comment; update it to say the three axes are stored, each already snapped to 1.25 m and clamped to `>= 0` by the viewer.

- [ ] **Step 4: Bump cache-busting**

```bash
cd "C:/Users/djour/Projects/sc-cargo-optimizer"
sed -i 's/20260717-r24/20260717-r25/g' index.html
grep -c "20260717-r25" index.html    # Expected: 23
```

- [ ] **Step 5: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --input-type=module --check < js/cargo-viewer.js && echo "cargo-viewer.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: both `OK`, and `34/34 passed`.

- [ ] **Step 6: Verify an injected height actually raises a module, and that v1 entries still work**

Using the harness (sync FleetYards, then `packShip(page, "Ironclad (")`), run:
```js
// A v2 entry WITH y must move the module to that height.
const key = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1"));
  return Object.keys(s.fleetyardsCargoHolds["Ironclad"]).length ? s.fleetyardsCargoHolds["Ironclad"][0].name : null;
});
await page.evaluate((k) => window.persistCargoModulePosition(k, 5, 12.5, 7.5), key);
const withY = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1")).cargoViewerLayout["Ironclad"]);
console.log("entry with y:", JSON.stringify(withY));

// A v1-shaped entry (no y) must NOT pin the height.
await page.evaluate((k) => {
  const s = JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1"));
  s.cargoViewerLayout["Ironclad"] = { [k]: { x: 5, z: 7.5 } }; // no y, as v1 wrote
  localStorage.setItem("sc-cargo-optimizer-v1", JSON.stringify(s));
}, key);
await page.reload({ waitUntil: "networkidle0" });
```
Expected: the first log shows `{"<key>":{"x":5,"y":12.5,"z":7.5}}` — all three axes stored. The second part must not throw and the page must re-render normally (the module keeps its automatic height). Confirm no console errors.

- [ ] **Step 7: Commit**

```bash
git add js/cargo-viewer.js js/app.js index.html
git commit -m "Store and apply an optional grid height (height editing 1/2)"
```

---

## Task 2: Drag in the plane of the current view

**Files:**
- Modify: `js/cargo-viewer.js` (drag plane selection, pointer handlers)
- Modify: `js/app.js` (`setCargoLayoutEditUI` — stop hiding the preset view buttons)
- Modify: `js/i18n.js` (FR + EN `editLayoutHint`)

**Interfaces:**
- Consumes: `snapToUnit`, `editingLayout`, `pickMeshes`, `UNIT` (`js/cargo-viewer.js`); the `{x,y,z}` persist path from Task 1.
- Produces: the finished feature. No new exports.

- [ ] **Step 1: Replace the fixed ground plane with a view-following plane**

In `js/cargo-viewer.js`, the drag currently uses a hard-coded horizontal plane:
```js
const dragGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
```
Delete that constant and add, in its place:
```js
// Le glisser se fait dans le plan qu'on REGARDE : vu de dessus on déplace au
// sol (X/Z), vu de face ou de côté on déplace en hauteur (Y) + un axe
// horizontal. Sans ça, la hauteur serait inéditable — vue de dessus, un
// changement de hauteur est invisible. La rotation libre étant désactivée en
// édition, la caméra est toujours sur l'une des 6 vues préréglées, donc
// l'axe dominant est franc et le plan jamais ambigu.
const dragPlane = new THREE.Plane();
// Axes déplacés selon la normale du plan : "y" -> X/Z, "z" -> X/Y, "x" -> Z/Y.
let dragAxes = { normal: "y", a: "x", b: "z" };

function pickDragAxes() {
  const dir = new THREE.Vector3().subVectors(controls.target, camera.position);
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ay >= ax && ay >= az) return { normal: "y", a: "x", b: "z" }; // dessus/dessous
  if (az >= ax) return { normal: "z", a: "x", b: "y" }; // avant/arrière
  return { normal: "x", a: "z", b: "y" }; // gauche/droite
}
```

- [ ] **Step 2: Build the plane through the module on pointer-down**

In `onLayoutPointerDown`, the body currently intersects `dragGroundPlane` and computes X/Z grab offsets. Replace the part after the `dragTarget = hits[0].object;` assignment with:
```js
  dragAxes = pickDragAxes();
  // Plan passant par la position COURANTE du module (pas par l'origine du
  // monde) : un module déjà surélevé par la reconstruction auto est loin du
  // plan Y=0, et le rayon y croiserait bien à côté — décalage de préhension
  // faussé, la grille sauterait au premier mouvement.
  const n = dragAxes.normal;
  const normalVec = new THREE.Vector3(n === "x" ? 1 : 0, n === "y" ? 1 : 0, n === "z" ? 1 : 0);
  dragPlane.setFromNormalAndCoplanarPoint(normalVec, dragTarget.position);
  if (!dragRaycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
    dragTarget = null;
    return;
  }
  const dims = dragTarget.userData.dims;
  const halfOf = { x: dims.dx / 2, y: dims.dy / 2, z: dims.dz / 2 };
  // Décalage entre le point saisi et l'origine du module, sur les 2 axes
  // mobiles seulement — pour que la grille ne saute pas sous le curseur.
  dragGrabOffsetA = dragHitPoint[dragAxes.a] - (dragTarget.position[dragAxes.a] - halfOf[dragAxes.a]);
  dragGrabOffsetB = dragHitPoint[dragAxes.b] - (dragTarget.position[dragAxes.b] - halfOf[dragAxes.b]);
  controls.enabled = false; // le geste ne doit pas bouger la caméra
```
Rename the two module-level offset variables accordingly: replace
```js
let dragGrabOffsetX = 0;
let dragGrabOffsetZ = 0;
```
with
```js
let dragGrabOffsetA = 0;
let dragGrabOffsetB = 0;
```

- [ ] **Step 3: Move along the two in-plane axes on pointer-move**

Replace `onLayoutPointerMove`'s body (after its `if (!editingLayout || !dragTarget) return;` and `updateDragPointer(event);`) with:
```js
  if (!dragRaycaster.ray.intersectPlane(dragPlane, dragHitPoint)) return;
  const dims = dragTarget.userData.dims;
  const halfOf = { x: dims.dx / 2, y: dims.dy / 2, z: dims.dz / 2 };
  const originA = snapToUnit(dragHitPoint[dragAxes.a] - dragGrabOffsetA);
  const originB = snapToUnit(dragHitPoint[dragAxes.b] - dragGrabOffsetB);
  const currentA = dragTarget.position[dragAxes.a] - halfOf[dragAxes.a];
  const currentB = dragTarget.position[dragAxes.b] - halfOf[dragAxes.b];
  if (originA !== currentA || originB !== currentB) dragMoved = true;
  dragTarget.position[dragAxes.a] = originA + halfOf[dragAxes.a];
  dragTarget.position[dragAxes.b] = originB + halfOf[dragAxes.b];
  dragTarget.userData.wireframe.position[dragAxes.a] = originA;
  dragTarget.userData.wireframe.position[dragAxes.b] = originB;
```
(`onLayoutPointerUp` is left exactly as Task 1 leaves it: it reads all three axes back off `dragTarget.position` and persists them, so it needs no change here.)

- [ ] **Step 4: Show the preset view buttons in edit mode**

In `js/app.js`, `setCargoLayoutEditUI` currently hides them:
```js
  document.querySelectorAll(".cargo-viewer-controls .btn-view-sm[data-view]").forEach((b) => {
    b.style.display = editing ? "none" : "";
  });
```
The view buttons are now how the player chooses the drag plane, so they must stay visible. Delete that block entirely. (Leave the rotate/mirror lines that hide those two buttons — orientation is still set outside edit mode.)

- [ ] **Step 5: Update the hint, FR**

In `js/i18n.js`, replace the French `editLayoutHint` value with:
```js
    editLayoutHint:
      "Glisse chaque grille à sa vraie place (aimantage sur 1 SCU = 1,25 m). Tu déplaces dans le plan que tu regardes : en vue de dessus au sol, en vue avant ou de côté tu règles la hauteur. Change de vue avec les boutons ci-dessous.",
```

- [ ] **Step 6: Update the hint, EN**

In `js/i18n.js`, replace the English `editLayoutHint` value with:
```js
    editLayoutHint:
      "Drag each grid to its real place (snaps to 1 SCU = 1.25 m). You move within the plane you are looking at: top view moves it along the floor, front or side view sets its height. Switch views with the buttons below.",
```

- [ ] **Step 7: Bump cache-busting**

```bash
sed -i 's/20260717-r25/20260717-r26/g' index.html
grep -c "20260717-r26" index.html    # Expected: 23
```

- [ ] **Step 8: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --check js/i18n.js && echo "i18n.js OK"
node --input-type=module --check < js/cargo-viewer.js && echo "cargo-viewer.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: three `OK` lines and `34/34 passed`.

- [ ] **Step 9: Verify height editing works in a front view**

Using the harness (sync FleetYards, `packShip(page, "Ironclad (")`), then:
```js
await page.evaluate(() => document.querySelector("#cargo-viewer-edit-btn").click());
await new Promise((r) => setTimeout(r, 500));
// The preset view buttons must be visible in edit mode now.
console.log("front btn display:", await page.evaluate(
  () => document.querySelector('[data-view="front"]').style.display));
await page.evaluate(() => document.querySelector('[data-view="front"]').click());
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: "<scratch>/height-front-view.png" });
```
LOOK at the screenshot to find a module, then drag it VERTICALLY (same X, clearly different screen Y) with `page.mouse.down()`, `move(..., {steps: 12})`, `up()`. Then:
```js
const stored = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1")).cargoViewerLayout["Ironclad"]);
console.log("after vertical drag:", JSON.stringify(stored));
```
Expected: exactly one entry whose **`y` is a non-negative multiple of 1.25 and differs from the module's pre-drag height**, proving height was edited. Report the actual before/after `y`.

- [ ] **Step 10: Verify the top view still edits the floor, not the height**

Click `[data-view="top"]`, drag a module horizontally, and confirm the stored entry's `x`/`z` changed while `y` stayed the same as it was. Report the actual values.

- [ ] **Step 11: Commit**

```bash
git add js/cargo-viewer.js js/app.js js/i18n.js index.html
git commit -m "Drag in the plane of the current view, enabling height editing (height editing 2/2)"
```

---

## Self-Review Notes

**Spec coverage:** §5's drag-plane table → Task 2 Steps 1-3. §5's `{x,y,z}` model + backward-compatible absent `y` → Task 1 Steps 1-3. §5's "plane through the module's current position, not the origin" → Task 2 Step 2. Preset views available in edit mode → Task 2 Step 4. Snap+clamp on every moved axis → reuses `snapToUnit`, unchanged.

**Naming trap:** the module-level grab-offset variables are renamed `dragGrabOffsetX/Z` → `dragGrabOffsetA/B` because they no longer map to fixed world axes. Every reference must be updated or the file will not run.

**Deliberate non-change:** `onLayoutPointerUp` already reads all three axes after Task 1, so Task 2 does not touch it. `dragMoved` keeps gating the persist (a click with no movement must still write nothing).
