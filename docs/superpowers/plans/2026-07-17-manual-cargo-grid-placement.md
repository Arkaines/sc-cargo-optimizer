# Manual Cargo-Grid Placement (drag & drop) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player drag each cargo grid to its real position in the 3D viewer, saved per ship, applied on top of the automatic reconstruction.

**Architecture:** A per-ship sparse override map `state.cargoViewerLayout[shipName] = { moduleKey: {x,z} }` lives in `js/app.js`, persisted by `saveState()` and cloud-synced. `js/cargo-viewer.js` applies that map on top of its computed module positions, and in an opt-in edit mode lets the player drag modules (raycast against invisible pick boxes, snap to 1.25 m) and reports each drop back to `js/app.js` to persist. Display-only: no packing logic changes.

**Tech Stack:** Vanilla JS (classic scripts + the one ES module `js/cargo-viewer.js`), Three.js (`OrbitControls`, `Raycaster`, `Plane`), Supabase (`js/cloud.js`), no build step. Verification: `node scripts/cargo-packing-tests.cjs` + headless Edge driven by `puppeteer-core`.

## Global Constraints

- **1 SCU = 1.25 m cube.** Snap step is `UNIT` (= `1.25`, already defined in `js/cargo-viewer.js`). Snap with `Math.round(v / UNIT) * UNIT`.
- **Display-only.** Never modify `js/cargo-packing.js` or any packing result. `node scripts/cargo-packing-tests.cjs` must stay **34/34** after every task.
- **Opt-in, zero regression.** A ship absent from `state.cargoViewerLayout` renders exactly as today. The override is **partial**: only dragged modules are stored; undragged ones keep their auto position.
- **Name collision.** `renderCargoViewer3D` already declares a local `const layout = displayHolds.map(...)` (the array of displayed module entries). The new 5th parameter MUST be named **`savedLayout`**, never `layout`.
- **Override runs AFTER normalization.** Apply the override after the `minX`/`minZ` block and before the `maxDy`/`maxDz`/`totalWidth` loop, so a persisted position is exactly the drawn position (no drift). Persisted coords are clamped to `>= 0` on drop, keeping every module positive so the existing `sceneBounds`/label math (which assumes origin 0) stays valid.
- **Persist the module ORIGIN (corner)**, i.e. the same `worldPos[0]`/`worldPos[2]` the renderer uses — not the pick box's center.
- **Module key** is computed only in `js/cargo-viewer.js` (`moduleKey`); `js/app.js` treats keys as opaque strings.
- **Viewer ↔ app boundary.** The viewer never touches `state`: it calls `window.persistCargoModulePosition(key, x, z)` (defined in app). The app calls `window.setCargoLayoutEditing(bool)` and passes the resolved map into `renderCargoViewer3D`.
- **i18n FR + EN** for every new user-facing string (`js/i18n.js`), wired with `data-i18n` / `data-i18n-title` like existing buttons.
- **Cache-busting:** bump every `?v=` occurrence in `index.html` (all 23) in each task that ships. Current value: `20260717-r17` → use `-r18` (Task 1), `-r19` (Task 2), `-r20` (Task 3), `-r21` (Task 4).

## File Structure

| File | Responsibility in this feature |
|---|---|
| `js/app.js` | Owns `state.cargoViewerLayout` (default/load/persist/reset), resolves the map per ship, wires the edit-mode buttons. |
| `js/cloud.js` | Adds the viewer-arrangement keys to `CLOUD_SYNCED_KEYS`. |
| `js/cargo-viewer.js` | `moduleKey`, applies the override, edit-mode flag + camera lock + crate hiding, pick boxes, drag handlers. |
| `index.html` | Edit/Done/Reset buttons + hint element; cache-busting. |
| `js/i18n.js` | FR/EN strings for the new controls. |

## Verification Harness (used by every task)

The project has no JS unit-test runner for UI/3D code; the established practice is the Node packing suite plus headless-browser checks. Each task below ends with both.

Start the static server if needed:
```bash
cd "C:/Users/djour/Projects/sc-cargo-optimizer"
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/   # want 200; else:
python -m http.server 8080 > /dev/null 2>&1 &
```

Launch headless Edge (fresh profile, pick an unused port):
```bash
"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --remote-debugging-port=9410 \
  --user-data-dir="$TMP/edge-grid-plan" --no-first-run "http://localhost:8080/" > /dev/null 2>&1 &
sleep 2
curl -s http://127.0.0.1:9410/json/version | head -2   # confirms it is up
```

Connect with `puppeteer-core` (installed in the session scratchpad; `require("puppeteer-core")`). Every script MUST:
- `page.on("dialog", (d) => d.accept())` — an unhandled alert silently hangs the run.
- find the page via `pages.find((p) => p.url().includes("localhost:8080"))`.
- prefer `page.evaluate(() => el.click())` over simulated mouse clicks.
- `taskkill //F //IM msedge.exe` at the end.

Reusable snippet — seed a mission, pick a ship, optimize, pack (needed before the viewer shows anything):
```js
async function packShip(page, shipPrefix) {
  await page.evaluate(() => document.querySelector('[data-tab="new-mission-tab"]').click());
  await new Promise((r) => setTimeout(r, 200));
  const labels = await page.evaluate(() => {
    const o = Array.from(document.querySelectorAll("#locations-datalist option")).map((x) => x.value);
    return { lorville: o.find((v) => v.startsWith("Lorville")), area18: o.find((v) => v.startsWith("Area 18")) };
  });
  await page.type("#mission-name", "PlanTest");
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
  await new Promise((r) => setTimeout(r, 1300));
}
```

---

## Task 1: State field, persistence, cloud sync, app-side helpers

**Files:**
- Modify: `js/app.js` (`defaultState` ~line 21-43, `loadState` ~line 110-132, new helpers after `mirrorCargoViewerOrientation` ~line 1051)
- Modify: `js/cloud.js` (`CLOUD_SYNCED_KEYS`, ~lines 19-27)
- Modify: `index.html` (cache-busting)

**Interfaces:**
- Consumes: `getSelectedShip()`, `saveState()`, `renderCargoStepView()` (all existing in `js/app.js`).
- Produces (used by Tasks 2-4):
  - `getCargoViewerLayout(shipName) -> { [moduleKey]: {x, z} }` (`{}` when unset)
  - `window.persistCargoModulePosition(moduleKey: string, x: number, z: number) -> void`
  - `window.resetCargoViewerLayout() -> void`

- [ ] **Step 1: Add the field to `defaultState()`**

In `js/app.js`, in the object returned by `defaultState()`, insert `cargoViewerLayout: {},` after `cargoViewerMirror: {},`:

```js
    shipAccessFaces: {},
    cargoViewerOrientation: {},
    cargoViewerMirror: {},
    cargoViewerLayout: {},
    dataSchemaVersion: DATA_SCHEMA_VERSION,
```

- [ ] **Step 2: Read the field in `loadState()`**

In `js/app.js`, in the object returned by `loadState()`, insert after `cargoViewerMirror`:

```js
      cargoViewerOrientation: parsed.cargoViewerOrientation || {},
      cargoViewerMirror: parsed.cargoViewerMirror || {},
      cargoViewerLayout: parsed.cargoViewerLayout || {},
      dataSchemaVersion: parsed.dataSchemaVersion || 0,
```

- [ ] **Step 3: Add the viewer-arrangement keys to cloud sync**

Replace `CLOUD_SYNCED_KEYS` in `js/cloud.js` with:

```js
const CLOUD_SYNCED_KEYS = [
  "missions",
  "customLocations",
  "distances",
  "nextMissionId",
  "selectedShip",
  "customShipCapacity",
  "reputationOverrides",
  "cargoViewerOrientation",
  "cargoViewerMirror",
  "cargoViewerLayout",
];
```

- [ ] **Step 4: Add the app-side helpers**

In `js/app.js`, directly after the closing brace of `mirrorCargoViewerOrientation()`, add:

```js
// Disposition manuelle des grilles de cargo, par vaisseau (voir
// docs/superpowers/specs/2026-07-17-manual-cargo-grid-placement-design.md).
// FleetYards ne donne pas les positions réelles des soutes : le joueur peut
// glisser chaque grille à sa vraie place (mode édition, js/cargo-viewer.js).
// Surcharge PARTIELLE : seuls les modules déplacés sont mémorisés, les autres
// gardent la reconstruction auto. La clé de module est opaque ici — c'est le
// visualiseur qui la produit (moduleKey), app.js ne fait que la stocker.
function getCargoViewerLayout(shipName) {
  return (shipName && state.cargoViewerLayout[shipName]) || {};
}

// Appelée par js/cargo-viewer.js au relâchement d'un glisser. x/z sont
// l'origine (coin) du module, déjà aimantée sur 1,25 m et bornée à >= 0
// côté visualiseur.
window.persistCargoModulePosition = function persistCargoModulePosition(moduleKey, x, z) {
  const ship = getSelectedShip();
  if (!ship || !moduleKey) return;
  if (!state.cargoViewerLayout[ship.name]) state.cargoViewerLayout[ship.name] = {};
  state.cargoViewerLayout[ship.name][moduleKey] = { x, z };
  saveState();
};

// Bouton « Réinitialiser la disposition » : ce vaisseau repart à 100 % auto.
window.resetCargoViewerLayout = function resetCargoViewerLayout() {
  const ship = getSelectedShip();
  if (!ship) return;
  delete state.cargoViewerLayout[ship.name];
  saveState();
  renderCargoStepView();
};
```

- [ ] **Step 5: Bump cache-busting**

```bash
cd "C:/Users/djour/Projects/sc-cargo-optimizer"
sed -i 's/20260717-r17/20260717-r18/g' index.html
grep -c "20260717-r18" index.html    # Expected: 23
```

- [ ] **Step 6: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --check js/cloud.js && echo "cloud.js OK"
grep -c "cargoViewerLayout" js/cloud.js          # Expected: 1
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: `app.js OK`, `cloud.js OK`, `1`, and `34/34 passed`.

- [ ] **Step 7: Verify persistence round-trip in the browser**

Using the harness above, run this script:
```js
await page.goto("http://localhost:8080/", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const sel = document.querySelector("#ship-select");
  sel.value = Array.from(sel.options).find((o) => o.textContent.startsWith("Ironclad (")).value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => window.persistCargoModulePosition("test_module", 3.75, 6.25));
await page.reload({ waitUntil: "networkidle0" });
const saved = await page.evaluate(
  () => JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1")).cargoViewerLayout);
console.log(JSON.stringify(saved));
```
Expected output exactly: `{"Ironclad":{"test_module":{"x":3.75,"z":6.25}}}`

Then clear the test entry so it does not leak into later tasks:
```js
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1"));
  delete s.cargoViewerLayout;
  localStorage.setItem("sc-cargo-optimizer-v1", JSON.stringify(s));
});
```

- [ ] **Step 8: Commit**

```bash
git add js/app.js js/cloud.js index.html
git commit -m "Add cargoViewerLayout state, persistence and cloud sync (manual grid placement 1/4)"
```

---

## Task 2: Apply the saved layout in the 3D viewer

**Files:**
- Modify: `js/cargo-viewer.js` (add `moduleKey` after `trailingIndex`; `renderCargoViewer3D` signature + override block)
- Modify: `js/app.js` (`renderCargoStepView`, the `renderCargoViewer3D(...)` call)
- Modify: `index.html` (cache-busting)

**Interfaces:**
- Consumes: `getCargoViewerLayout(shipName)` (Task 1).
- Produces (used by Task 4): `moduleKey(hold, displayHolds) -> string`; `renderCargoViewer3D(holds, placements, rotation, mirror, savedLayout)`.

- [ ] **Step 1: Add the `moduleKey` helper**

In `js/cargo-viewer.js`, immediately after the `trailingIndex(name)` function, add:

```js
// Clé stable d'un module pour la disposition manuelle (voir
// state.cargoViewerLayout dans js/app.js). Le nom du hardpoint suffit ; on ne
// suffixe "#<i>" que si ce nom apparaît plusieurs fois parmi les modules
// AFFICHÉS (cas théorique — les noms FleetYards observés sont distincts, y
// compris module_01..04), pour que deux homonymes ne partagent pas la même
// position mémorisée.
function moduleKey(hold, displayHolds) {
  const name = hold.name || "";
  const sameName = displayHolds.filter((h) => (h.name || "") === name);
  if (sameName.length <= 1) return name;
  return `${name}#${sameName.indexOf(hold)}`;
}
```

- [ ] **Step 2: Add the `savedLayout` parameter**

In `js/cargo-viewer.js`, change the signature line. From:
```js
window.renderCargoViewer3D = function renderCargoViewer3D(holds, placements, rotation, mirror) {
```
To:
```js
window.renderCargoViewer3D = function renderCargoViewer3D(holds, placements, rotation, mirror, savedLayout) {
```
Also extend the doc comment directly above it by adding this line before `window.renderCargoViewer3D`:
```js
// savedLayout : map { [moduleKey]: {x, z} } des grilles que le joueur a
// placées à la main pour ce vaisseau (state.cargoViewerLayout, js/app.js),
// ou {}. Nommé savedLayout et pas layout : `layout` est déjà le tableau
// local des modules affichés, plus bas dans cette fonction.
```

- [ ] **Step 3: Apply the override after normalization**

In `js/cargo-viewer.js`, find this existing block:

```js
  const minX = Math.min(0, ...layout.map((l) => l.worldPos[0]));
  const minZ = Math.min(0, ...layout.map((l) => l.worldPos[2]));
  layout.forEach((l) => {
    l.worldPos[0] -= minX;
    l.worldPos[2] -= minZ;
  });
```

Insert immediately **after** it (and before the `let maxDy = 0;` bounds loop):

```js
  // Surcharge manuelle du joueur (state.cargoViewerLayout, voir js/app.js) :
  // écrase x/z des grilles qu'il a glissées, par-dessus la reconstruction
  // auto. Partielle : un module absent de la map garde sa position auto.
  // Y (worldPos[1]) inchangé — v1 au sol.
  // APRÈS la normalisation ci-dessus, volontairement : la normalisation est
  // une translation de tous les modules ; appliquer la surcharge avant
  // re-décalerait au rendu suivant une position tout juste enregistrée (ce
  // qu'on mémorise ne serait pas ce qu'on récupère). Ici la valeur mémorisée
  // est exactement la valeur dessinée — aller-retour stable. Les positions
  // enregistrées sont bornées à >= 0 au glisser (voir onPointerUp), donc tout
  // reste en coordonnées positives et le calcul des bornes/étiquettes qui
  // suit (sceneBounds suppose une origine à 0) reste valide.
  const overrides = savedLayout || {};
  layout.forEach((l) => {
    const custom = overrides[moduleKey(l.hold, displayHolds)];
    if (custom) {
      l.worldPos[0] = custom.x;
      l.worldPos[2] = custom.z;
    }
  });
```

- [ ] **Step 4: Pass the map from `js/app.js`**

In `js/app.js`, `renderCargoStepView`, replace:
```js
  const mirror = ship ? getCargoViewerMirror(ship.name) : false;
  if (typeof renderCargoViewer3D === "function") renderCargoViewer3D(holds, present, orientation, mirror);
```
with:
```js
  const mirror = ship ? getCargoViewerMirror(ship.name) : false;
  const savedLayout = ship ? getCargoViewerLayout(ship.name) : {};
  if (typeof renderCargoViewer3D === "function")
    renderCargoViewer3D(holds, present, orientation, mirror, savedLayout);
```

- [ ] **Step 5: Bump cache-busting**

```bash
sed -i 's/20260717-r18/20260717-r19/g' index.html
grep -c "20260717-r19" index.html    # Expected: 23
```

- [ ] **Step 6: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --input-type=module --check < js/cargo-viewer.js && echo "cargo-viewer.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: both `OK`, and `34/34 passed`.

- [ ] **Step 7: Verify a stored layout actually moves a module**

Add a temporary debug hook so the test can read module positions. In `js/cargo-viewer.js`, just after `window.setCargoViewerView = setCargoViewerView;`, add:
```js
window.__debugModulePositions = () =>
  contentGroup.children
    .filter((o) => o.userData && o.userData.debugKey)
    .map((o) => ({ key: o.userData.debugKey, x: o.position.x, z: o.position.z }));
```
and, inside the `layout.forEach(({ hold, dx, dy, dz, worldPos }) => {` draw loop, right after `contentGroup.add(wireframe);`, add:
```js
    wireframe.userData.debugKey = moduleKey(hold, displayHolds);
```

Then run (with the `packShip` helper from the harness):
```js
await packShip(page, "Ironclad (");
const before = await page.evaluate(() => window.__debugModulePositions());
const key = before[0].key;
await page.evaluate((k) => {
  window.persistCargoModulePosition(k, 25, 30);
}, key);
await page.evaluate(() => document.querySelector("#pack-cargo-btn").click());
await new Promise((r) => setTimeout(r, 1300));
const after = await page.evaluate(() => window.__debugModulePositions());
console.log("key:", key);
console.log("after:", JSON.stringify(after.find((m) => m.key === key)));
```
Expected: the entry for `key` reports `{"key":"<key>","x":25,"z":30}` — exactly the persisted values (proving the after-normalization override round-trips without drift). Other modules keep their auto positions.

- [ ] **Step 8: Remove the debug hook**

Delete the `window.__debugModulePositions` block and the `wireframe.userData.debugKey` line added in Step 7. Re-run `node --input-type=module --check < js/cargo-viewer.js`. Clear the test layout from `localStorage` as in Task 1 Step 7.

- [ ] **Step 9: Commit**

```bash
git add js/cargo-viewer.js js/app.js index.html
git commit -m "Apply saved cargo-grid layout as an override in the 3D viewer (manual grid placement 2/4)"
```

---

## Task 3: Edit mode — buttons, i18n, camera lock, hide crates

**Files:**
- Modify: `index.html` (`.cargo-viewer-controls` ~lines 232-241, plus a hint element; cache-busting)
- Modify: `js/i18n.js` (FR block near `rotateOrientationBtn`; EN block near its counterpart)
- Modify: `js/cargo-viewer.js` (edit flag, `window.setCargoLayoutEditing`, skip crates, skip camera reframe)
- Modify: `js/app.js` (enter/exit handlers + button listeners)

**Interfaces:**
- Consumes: `window.resetCargoViewerLayout()` (Task 1); `setCargoViewerView(view)` (existing, `js/cargo-viewer.js`).
- Produces (used by Task 4): module-level `editingLayout` boolean in `js/cargo-viewer.js`; `window.setCargoLayoutEditing(on: boolean) -> void`.

- [ ] **Step 1: Add the buttons and hint to `index.html`**

In `index.html`, inside `<div class="cargo-viewer-controls">`, after the existing mirror button line, add:
```html
            <button type="button" id="cargo-viewer-edit-btn" class="btn-secondary btn-view-sm" data-i18n="editLayoutBtn" data-i18n-title="editLayoutHint"></button>
            <button type="button" id="cargo-viewer-edit-done-btn" class="btn-primary btn-view-sm" style="display:none;" data-i18n="editLayoutDoneBtn"></button>
            <button type="button" id="cargo-viewer-reset-layout-btn" class="btn-danger btn-view-sm" style="display:none;" data-i18n="resetLayoutBtn"></button>
```
Then, immediately after `<div id="cargo-viewer-3d"></div>`, add the hint:
```html
          <p id="cargo-edit-hint" class="hint" style="display:none;" data-i18n="editLayoutHint"></p>
```

- [ ] **Step 2: Add the FR strings**

In `js/i18n.js`, in the FR dictionary right after the `mirrorOrientationHint` entry, add:
```js
    editLayoutBtn: "Éditer la disposition",
    editLayoutDoneBtn: "Terminer",
    resetLayoutBtn: "Réinitialiser la disposition",
    editLayoutHint:
      "Glisse chaque grille à sa vraie place sur le vaisseau (aimantage sur 1 SCU = 1,25 m). La vue est bloquée de dessus et les caisses sont masquées pendant l'édition.",
```

- [ ] **Step 3: Add the EN strings**

In `js/i18n.js`, in the EN dictionary right after its `mirrorOrientationHint` entry, add:
```js
    editLayoutBtn: "Edit layout",
    editLayoutDoneBtn: "Done",
    resetLayoutBtn: "Reset layout",
    editLayoutHint:
      "Drag each grid to its real place on the ship (snaps to 1 SCU = 1.25 m). The view is locked top-down and crates are hidden while editing.",
```

- [ ] **Step 4: Add the edit flag and toggle to `js/cargo-viewer.js`**

Add the flag next to the other module-level state (after `let currentMirror = false;`):
```js
// Mode « éditer la disposition » (voir js/app.js:enterCargoLayoutEdit) : le
// joueur glisse les grilles à leur vraie place. Pendant ce mode on masque les
// caisses, on bloque la rotation caméra (vue de dessus) et on ne recadre
// jamais la caméra, pour que la vue reste stable d'un glisser à l'autre.
let editingLayout = false;
```

Then add the toggle, immediately after `window.setCargoViewerView = setCargoViewerView;`:
```js
window.setCargoLayoutEditing = function setCargoLayoutEditing(on) {
  editingLayout = !!on;
  if (!controls) return;
  controls.enableRotate = !editingLayout;
  if (editingLayout) setCargoViewerView("top");
};
```

- [ ] **Step 5: Hide crates while editing**

In `js/cargo-viewer.js`, inside the `layout.forEach(({ hold, dx, dy, dz, worldPos }) => {` draw loop, wrap the crate rendering. Change:
```js
    placements
      .filter((p) => p.module === hold)
      .forEach((p) => {
```
to:
```js
    // Caisses masquées en mode édition : on place des modules, elles ne font
    // qu'encombrer la vue de dessus.
    if (!editingLayout)
      placements
        .filter((p) => p.module === hold)
        .forEach((p) => {
```
(Keep the body unchanged; re-indent the closing `});` of that `forEach` to match.)

- [ ] **Step 6: Never reframe the camera while editing**

In `js/cargo-viewer.js`, change:
```js
  const frameKey = `${totalWidth.toFixed(2)}|${maxDy.toFixed(2)}|${maxDz.toFixed(2)}`;
  if (frameKey !== lastFrameKey) {
```
to:
```js
  const frameKey = `${totalWidth.toFixed(2)}|${maxDy.toFixed(2)}|${maxDz.toFixed(2)}`;
  // En édition, les bornes bougent à chaque glisser : recadrer ferait sauter
  // la vue de dessus que le joueur vient de poser.
  if (!editingLayout && frameKey !== lastFrameKey) {
```

- [ ] **Step 7: Add the enter/exit handlers to `js/app.js`**

In `js/app.js`, after `window.resetCargoViewerLayout` (Task 1), add:
```js
// Bascule l'interface du visualiseur entre usage normal et mode édition de
// la disposition : en édition, seuls « Terminer » et « Réinitialiser » ont
// du sens (les vues/rotation/miroir sont masquées, la vue est bloquée de
// dessus par setCargoLayoutEditing).
function setCargoLayoutEditUI(editing) {
  document.getElementById("cargo-viewer-edit-btn").style.display = editing ? "none" : "";
  document.getElementById("cargo-viewer-edit-done-btn").style.display = editing ? "" : "none";
  document.getElementById("cargo-viewer-reset-layout-btn").style.display = editing ? "" : "none";
  document.getElementById("cargo-edit-hint").style.display = editing ? "" : "none";
  document.getElementById("cargo-viewer-rotate-btn").style.display = editing ? "none" : "";
  document.getElementById("cargo-viewer-mirror-btn").style.display = editing ? "none" : "";
  document.querySelectorAll(".cargo-viewer-controls .btn-view-sm[data-view]").forEach((b) => {
    b.style.display = editing ? "none" : "";
  });
}

function enterCargoLayoutEdit() {
  if (typeof setCargoLayoutEditing !== "function") return;
  setCargoLayoutEditing(true);
  setCargoLayoutEditUI(true);
  renderCargoStepView();
}

function exitCargoLayoutEdit() {
  if (typeof setCargoLayoutEditing !== "function") return;
  setCargoLayoutEditing(false);
  setCargoLayoutEditUI(false);
  renderCargoStepView();
}
```

- [ ] **Step 8: Wire the buttons**

In `js/app.js`, next to the existing rotate/mirror listeners inside the `DOMContentLoaded` handler, add:
```js
  document.getElementById("cargo-viewer-edit-btn").addEventListener("click", enterCargoLayoutEdit);
  document.getElementById("cargo-viewer-edit-done-btn").addEventListener("click", exitCargoLayoutEdit);
  document.getElementById("cargo-viewer-reset-layout-btn").addEventListener("click", resetCargoViewerLayout);
```

- [ ] **Step 9: Bump cache-busting**

```bash
sed -i 's/20260717-r19/20260717-r20/g' index.html
grep -c "20260717-r20" index.html    # Expected: 23
```

- [ ] **Step 10: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --check js/i18n.js && echo "i18n.js OK"
node --input-type=module --check < js/cargo-viewer.js && echo "cargo-viewer.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: three `OK` lines and `34/34 passed`.

- [ ] **Step 11: Verify edit mode in the browser**

```js
await packShip(page, "Ironclad (");
await page.evaluate(() => document.querySelector("#cargo-viewer-edit-btn").click());
await new Promise((r) => setTimeout(r, 500));
const inEdit = await page.evaluate(() => ({
  editBtn: document.querySelector("#cargo-viewer-edit-btn").style.display,
  doneBtn: document.querySelector("#cargo-viewer-edit-done-btn").style.display,
  resetBtn: document.querySelector("#cargo-viewer-reset-layout-btn").style.display,
  hint: document.querySelector("#cargo-edit-hint").style.display,
  frontView: document.querySelector('[data-view="front"]').style.display,
}));
console.log("in edit:", JSON.stringify(inEdit));
await page.screenshot({ path: "<scratch>/edit-mode.png" });
await page.evaluate(() => document.querySelector("#cargo-viewer-edit-done-btn").click());
await new Promise((r) => setTimeout(r, 500));
const outEdit = await page.evaluate(() => ({
  editBtn: document.querySelector("#cargo-viewer-edit-btn").style.display,
  doneBtn: document.querySelector("#cargo-viewer-edit-done-btn").style.display,
}));
console.log("out edit:", JSON.stringify(outEdit));
```
Expected: `in edit` → `editBtn:"none"`, `doneBtn:""`, `resetBtn:""`, `hint:""`, `frontView:"none"`; `out edit` → `editBtn:""`, `doneBtn:"none"`. The screenshot must show a top-down view with **no coloured crates**.

- [ ] **Step 12: Commit**

```bash
git add index.html js/i18n.js js/cargo-viewer.js js/app.js
git commit -m "Add cargo-grid layout edit mode: buttons, camera lock, hide crates (manual grid placement 3/4)"
```

---

## Task 4: Drag — pick boxes, pointer handlers, snap, persist

**Files:**
- Modify: `js/cargo-viewer.js` (pick-box array, pick boxes in the draw loop, drag handlers, listener binding in `setCargoLayoutEditing`)
- Modify: `index.html` (cache-busting)

**Interfaces:**
- Consumes: `moduleKey` (Task 2), `editingLayout` + `setCargoLayoutEditing` (Task 3), `window.persistCargoModulePosition` (Task 1), `UNIT` (existing constant `1.25`).
- Produces: the finished feature. No new exports.

- [ ] **Step 1: Add the pick-box registry**

In `js/cargo-viewer.js`, next to `let editingLayout = false;`, add:
```js
// Boîtes de collision invisibles (une par module) : les caissons sont des
// fils de fer (LineSegments), très mauvaises cibles au raycasting. Recréées
// à chaque rendu en mode édition, libérées par clearContent().
let pickMeshes = [];
```
And in `clearContent()`, add `pickMeshes = [];` next to the existing `labelMeshes = ...` reset.

- [ ] **Step 2: Create a pick box per module while editing**

In `js/cargo-viewer.js`, inside the draw loop, right after `contentGroup.add(wireframe);`, add:
```js
    if (editingLayout) {
      // Cube invisible aux dimensions du module, centré (le caisson, lui, est
      // positionné sur son coin/origine) — c'est la cible du raycaster.
      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(dx, dy, dz),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      pick.position.set(worldPos[0] + dx / 2, worldPos[1] + dy / 2, worldPos[2] + dz / 2);
      pick.userData.moduleKey = moduleKey(hold, displayHolds);
      pick.userData.wireframe = wireframe;
      pick.userData.dims = { dx, dy, dz };
      contentGroup.add(pick);
      pickMeshes.push(pick);
    }
```

- [ ] **Step 3: Add the drag state and handlers**

In `js/cargo-viewer.js`, immediately before `window.setCargoLayoutEditing`, add:
```js
// --- Glisser-déposer d'une grille (mode édition) -------------------------
// Le curseur est projeté sur le plan du sol (Y=0) ; le module suit, aimanté
// sur 1 SCU (UNIT = 1,25 m) et borné à >= 0 pour que tous les modules restent
// en coordonnées positives (voir la surcharge dans renderCargoViewer3D).
const dragGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragRaycaster = new THREE.Raycaster();
const dragPointerNdc = new THREE.Vector2();
const dragHitPoint = new THREE.Vector3();
let dragTarget = null;
let dragGrabOffsetX = 0;
let dragGrabOffsetZ = 0;

function snapToUnit(v) {
  return Math.max(0, Math.round(v / UNIT) * UNIT);
}

function updateDragPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  dragPointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  dragPointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  dragRaycaster.setFromCamera(dragPointerNdc, camera);
}

function onLayoutPointerDown(event) {
  if (!editingLayout) return;
  updateDragPointer(event);
  const hits = dragRaycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return;
  dragTarget = hits[0].object;
  if (!dragRaycaster.ray.intersectPlane(dragGroundPlane, dragHitPoint)) {
    dragTarget = null;
    return;
  }
  // Décalage entre le point saisi et l'origine du module, pour que la grille
  // ne saute pas sous le curseur au premier mouvement.
  const { dx, dz } = dragTarget.userData.dims;
  dragGrabOffsetX = dragHitPoint.x - (dragTarget.position.x - dx / 2);
  dragGrabOffsetZ = dragHitPoint.z - (dragTarget.position.z - dz / 2);
  controls.enabled = false; // le geste ne doit pas bouger la caméra
}

function onLayoutPointerMove(event) {
  if (!editingLayout || !dragTarget) return;
  updateDragPointer(event);
  if (!dragRaycaster.ray.intersectPlane(dragGroundPlane, dragHitPoint)) return;
  const { dx, dz } = dragTarget.userData.dims;
  const originX = snapToUnit(dragHitPoint.x - dragGrabOffsetX);
  const originZ = snapToUnit(dragHitPoint.z - dragGrabOffsetZ);
  dragTarget.position.x = originX + dx / 2;
  dragTarget.position.z = originZ + dz / 2;
  dragTarget.userData.wireframe.position.x = originX;
  dragTarget.userData.wireframe.position.z = originZ;
}

function onLayoutPointerUp() {
  if (!editingLayout || !dragTarget) return;
  const { dx, dz } = dragTarget.userData.dims;
  // On mémorise l'ORIGINE (coin) du module — les mêmes coordonnées que
  // worldPos[0]/worldPos[2] au rendu — pas le centre de la boîte de collision.
  const originX = dragTarget.position.x - dx / 2;
  const originZ = dragTarget.position.z - dz / 2;
  if (typeof window.persistCargoModulePosition === "function") {
    window.persistCargoModulePosition(dragTarget.userData.moduleKey, originX, originZ);
  }
  dragTarget = null;
  controls.enabled = true;
}
```

- [ ] **Step 4: Bind/unbind the listeners in `setCargoLayoutEditing`**

Replace the `window.setCargoLayoutEditing` body from Task 3 with:
```js
window.setCargoLayoutEditing = function setCargoLayoutEditing(on) {
  editingLayout = !!on;
  if (!controls || !renderer) return;
  controls.enableRotate = !editingLayout;
  const el = renderer.domElement;
  if (editingLayout) {
    el.addEventListener("pointerdown", onLayoutPointerDown);
    el.addEventListener("pointermove", onLayoutPointerMove);
    window.addEventListener("pointerup", onLayoutPointerUp);
    setCargoViewerView("top");
  } else {
    el.removeEventListener("pointerdown", onLayoutPointerDown);
    el.removeEventListener("pointermove", onLayoutPointerMove);
    window.removeEventListener("pointerup", onLayoutPointerUp);
    dragTarget = null;
    controls.enabled = true;
  }
};
```

- [ ] **Step 5: Bump cache-busting**

```bash
sed -i 's/20260717-r20/20260717-r21/g' index.html
grep -c "20260717-r21" index.html    # Expected: 23
```

- [ ] **Step 6: Verify syntax + regression suite**

```bash
node --input-type=module --check < js/cargo-viewer.js && echo "cargo-viewer.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: `cargo-viewer.js OK` and `34/34 passed`.

- [ ] **Step 7: Verify a real drag persists, snaps, and survives reload**

```js
await packShip(page, "Ironclad (");
await page.evaluate(() => document.querySelector("#cargo-viewer-edit-btn").click());
await new Promise((r) => setTimeout(r, 600));

// Drag from the middle of the canvas to a point ~120px right / 80px down.
const box = await page.evaluate(() => {
  const r = document.querySelector("#cargo-viewer-3d canvas").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.w / 2 + 120, box.y + box.h / 2 + 80, { steps: 12 });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));

const stored = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1"));
  return s.cargoViewerLayout;
});
console.log("stored:", JSON.stringify(stored));
```
Expected: `stored` contains an `"Ironclad"` entry with exactly one module key whose `x` and `z` are **non-negative multiples of 1.25** (e.g. `{"x":18.75,"z":11.25}`). If the drag started on empty space (no module under the canvas centre), no entry is written — retry aiming at a visible module using the coordinates from the Task 3 screenshot.

Then confirm it survives a reload and re-render:
```js
await page.reload({ waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 600));
const afterReload = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1")).cargoViewerLayout);
console.log("after reload:", JSON.stringify(afterReload));
```
Expected: identical to `stored` (same key, same coordinates).

- [ ] **Step 8: Verify reset reverts to auto**

```js
await packShip(page, "Ironclad (");
await page.evaluate(() => document.querySelector("#cargo-viewer-edit-btn").click());
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelector("#cargo-viewer-reset-layout-btn").click());
await new Promise((r) => setTimeout(r, 400));
const cleared = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("sc-cargo-optimizer-v1"));
  return s.cargoViewerLayout && s.cargoViewerLayout["Ironclad"];
});
console.log("cleared:", JSON.stringify(cleared));
```
Expected: `undefined` — the ship's entry is gone and the grids are back to their automatic positions.

- [ ] **Step 9: Verify the camera does not jump between drags**

Confirm the top-down framing is stable across two consecutive drags (the whole point of skipping the camera reframe in edit mode): take a screenshot after the first drag and after a second drag; the camera framing must be identical (only the dragged module moves). Then `taskkill //F //IM msedge.exe`.

- [ ] **Step 10: Commit**

```bash
git add js/cargo-viewer.js index.html
git commit -m "Add drag & drop for cargo grids in edit mode (manual grid placement 4/4)"
```

---

## Self-Review Notes

**Spec coverage:** §1 data model + persistence + cloud sync → Task 1. §2 buttons/i18n/edit mode/camera lock/hidden crates/reset → Task 3. §3 render override (+ the after-normalization correction) → Task 2. §4 raycasting/pick boxes/snap/viewer↔app boundary → Tasks 3-4. §5 out-of-scope (no vertical stacking, no per-module rotation, no resize) — respected: nothing in any task edits `worldPos[1]` or module dimensions. §7 tests → the packing suite gate plus the headless checks in each task.

**Known deviation from the spec (deliberate, spec updated):** the override runs **after** the `minX`/`minZ` normalization, not before, and persisted coordinates are clamped to `>= 0`. Applying it before would re-shift a freshly saved position on the next render (what you save is not what you get back). The spec's §3 was corrected to match.

**Naming trap to watch:** `renderCargoViewer3D` already has a local `const layout`; the new parameter is `savedLayout`. Do not rename the local.
