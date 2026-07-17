# Supabase Grid Foundation + Admin Grid Editor (brick 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the maintainer author a ship's cargo grid (move / add / remove / resize modules) and publish it to Supabase, where it becomes the grid every player uses **instead of FleetYards** for that ship.

**Architecture:** Two Supabase tables (`admins`, `ship_layouts`) guarded by RLS; the maintainer runs the SQL himself. `js/cloud.js` gains the Supabase reads/writes; `js/app.js` caches published grids in `state.approvedShipGrids` and resolves holds via a new `getShipHolds` (published → FleetYards); `js/cargo-viewer.js` is reused unchanged for rendering by feeding published positions through its existing `savedLayout` override. The admin editor edits a draft grid and publishes it explicitly.

**Tech Stack:** Vanilla JS (classic scripts + the single ES module `js/cargo-viewer.js`), Supabase JS v2 (already loaded), three.js, no build step. Verification: `node scripts/cargo-packing-tests.cjs` + headless Edge via `puppeteer-core`.

**Spec:** `docs/superpowers/specs/2026-07-17-admin-grid-editor-design.md`

## Global Constraints

- **1 SCU = 1.25 m cube.** `UNIT` in `js/cargo-viewer.js` is `1.25`.
- **`capacity` is DERIVED, never entered:** `capacity = (dimensions.x / 1.25) * (dimensions.y / 1.25) * (dimensions.z / 1.25)`. Verified across all 284 FleetYards holds, 284/284, no exception. The editor takes dimensions in **SCU cells** and computes both the metres and the capacity.
- **`maxContainerSize` is NOT derivable.** Only these real values exist: **1, 2, 4, 8, 16, 24, 32** → a dropdown of exactly those.
- **Display/data only.** Never modify `js/cargo-packing.js`. `node scripts/cargo-packing-tests.cjs` must stay **34/34** after every task.
- **Zero regression / graceful degradation.** If the Supabase tables do not exist yet, or the user is offline, or a ship has no published grid, behaviour must be **exactly as today**. Never let a failed Supabase call break the app or throw to the console unhandled.
- **RLS is the only real guard.** The anon key is public; hiding the editor is not security. Never rely on a client check for authority.
- **Never commit secrets.** The repo is PUBLIC. The SQL file ships with a `<TON_USER_ID>` placeholder; the real value is substituted only in the Supabase editor.
- **Grid module shape** (the `grid` jsonb, one object per module):
  `{ name, dimensions: {x,y,z}, capacity, maxContainerSize, position: {x,y,z} }` — `dimensions`/`position` in metres, same field names and units `js/fleetyards.js` produces, so `js/cargo-packing.js` works unchanged.
- **`name` is the module key** and must be unique within a grid.
- **Cache-busting:** bump every `?v=` occurrence in `index.html` (all 23) in each task that ships JS/CSS/HTML. Current value `20260717-r26` → `-r27` (T2), `-r28` (T3), `-r29` (T4), `-r30` (T5), `-r31` (T6). (T1 ships no web asset.)

## File Structure

| File | Responsibility |
|---|---|
| `docs/supabase/admin-grid-editor.sql` (new) | The schema + RLS the maintainer runs. Documentation, never executed by us. |
| `js/cloud.js` | All Supabase I/O for grids: fetch published grids, check admin, publish a grid. Keeps Supabase access in the one file that already owns it. |
| `js/app.js` | `state.approvedShipGrids` / `state.isAdmin`, the `getShipHolds` resolver, the non-admin lock, and the admin editor's draft + wiring. |
| `js/cargo-viewer.js` | Unchanged rendering; only gains a resolved-grid export for seeding the draft. |
| `index.html` | Admin editor controls. |
| `js/i18n.js` | FR + EN strings. |

## Verification Harness (all browser tasks)

Server: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/` → want `200`; else `python -m http.server 8080` from the repo root, backgrounded.

`puppeteer-core` is installed in the session scratchpad — run scripts from
`C:/Users/djour/AppData/Local/Temp/claude/C--Users-djour/3186ed14-d20c-422b-a76c-10acb67e1996/scratchpad`.
Edge: `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`. Launch headless with a FRESH `--user-data-dir` and a free `--remote-debugging-port`; connect via `puppeteer.connect({ browserURL })`; ALWAYS `page.on("dialog", (d) => d.accept())`; find the page with `pages.find(p => p.url().includes("localhost:8080"))`. Kill with `taskkill //F //IM msedge.exe`.

**A fresh profile has no FleetYards data** → the viewer renders nothing. After the first load, force it once and check it worked:
```js
const info = await page.evaluate(async () => {
  const h = await syncFleetyardsCargoHolds();
  return { ships: Object.keys(h).length, cat: (h["Caterpillar"] || []).length };
});
// expect roughly { ships: 97, cat: 14 }
```

**Supabase cannot be tested here** (no project access). Every browser check below must therefore work by **injecting state directly**, e.g.:
```js
await page.evaluate(() => {
  state.approvedShipGrids = { "Caterpillar": { grid: [...], orientation: 0, mirror: false } };
  state.isAdmin = true;
});
```
Never make a task's verification depend on a real Supabase call.

---

## Task 1: The SQL script (maintainer-run)

**Files:**
- Create: `docs/supabase/admin-grid-editor.sql`

**Interfaces:**
- Produces (consumed by Tasks 2 and 6): tables `admins(user_id uuid pk)` and `ship_layouts(ship_name text pk, grid jsonb, orientation smallint, mirror boolean, updated_at timestamptz)`; RLS allowing public `select` on `ship_layouts`, admin-only writes, and self-only `select` on `admins`.

- [ ] **Step 1: Write the script**

Create `docs/supabase/admin-grid-editor.sql`:

```sql
-- =========================================================================
-- Grilles de cargo publiées + admins (Brique 2a).
-- À exécuter tel quel dans l'éditeur SQL de Supabase.
--
-- AVANT D'EXÉCUTER : remplace <TON_USER_ID> (tout en bas) par ton uuid,
-- visible dans Supabase > Authentication > Users après t'être connecté une
-- fois via Discord sur l'app.
--
-- NE COMMITTE JAMAIS ce fichier avec ton vrai user_id : le dépôt est public.
-- =========================================================================

-- --- Tables ---------------------------------------------------------------

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.ship_layouts (
  ship_name   text primary key,
  grid        jsonb not null,
  orientation smallint not null default 0,
  mirror      boolean  not null default false,
  updated_at  timestamptz not null default now()
);

alter table public.admins       enable row level security;
alter table public.ship_layouts enable row level security;

-- --- Qui est admin ? ------------------------------------------------------
-- Fonction utilitaire : évite de répéter le sous-select dans chaque policy.
-- STABLE + security definer pour pouvoir lire admins sans que la policy de
-- admins ne se rappelle elle-même en boucle.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- --- RLS : admins ---------------------------------------------------------
-- Un joueur peut savoir s'il est admin (sa propre ligne), sans lire la liste.
drop policy if exists admins_select_self on public.admins;
create policy admins_select_self on public.admins
  for select using (user_id = auth.uid());

-- --- RLS : ship_layouts ---------------------------------------------------
-- Lecture PUBLIQUE (y compris anon non connecté) : l'app doit pouvoir lire
-- les grilles sans compte.
drop policy if exists ship_layouts_select_public on public.ship_layouts;
create policy ship_layouts_select_public on public.ship_layouts
  for select using (true);

-- Écriture réservée aux admins. C'est le seul vrai garde-fou : la clé anon
-- est publique et le client n'est jamais digne de confiance.
drop policy if exists ship_layouts_write_admin on public.ship_layouts;
create policy ship_layouts_write_admin on public.ship_layouts
  for all using (public.is_admin()) with check (public.is_admin());

-- --- Ton compte admin -----------------------------------------------------
-- Remplace <TON_USER_ID> puis exécute.
insert into public.admins (user_id)
values ('<TON_USER_ID>')
on conflict (user_id) do nothing;
```

- [ ] **Step 2: Verify no real secret is present**

```bash
cd "C:/Users/djour/Projects/sc-cargo-optimizer"
grep -n "TON_USER_ID" docs/supabase/admin-grid-editor.sql
```
Expected: the placeholder is present. Confirm by eye that the file contains **no uuid, no key, no webhook URL** — the repo is public.

- [ ] **Step 3: Commit**

```bash
git add docs/supabase/admin-grid-editor.sql
git commit -m "Add the Supabase SQL for published grids + admins (admin grid editor 1/6)"
```

---

## Task 2: Fetch published grids and admin flag into state

**Files:**
- Modify: `js/app.js` (`defaultState` ~line 36-43, `loadState` ~line 125-131, `runFullSync` ~line 3333)
- Modify: `js/cloud.js` (new fetch functions)
- Modify: `index.html` (cache-busting)

**Interfaces:**
- Consumes: `sb` (the Supabase client, `js/cloud.js` line ~33); tables from Task 1.
- Produces (used by Tasks 3-6):
  - `state.approvedShipGrids` — `{ [shipName]: { grid, orientation, mirror } }`, `{}` when none.
  - `state.isAdmin` — boolean.
  - `fetchApprovedShipGrids() -> Promise<object>` (`js/cloud.js`)
  - `fetchIsAdmin() -> Promise<boolean>` (`js/cloud.js`)

- [ ] **Step 1: Add the state fields**

In `js/app.js`, in `defaultState()`'s returned object, after `cargoViewerLayout: {},`:
```js
    cargoViewerLayout: {},
    // Grilles publiées (Supabase, table ship_layouts) : { [ship]: {grid, orientation, mirror} }.
    // Cache local relu à chaque synchro, comme fleetyardsCargoHolds.
    approvedShipGrids: {},
    dataSchemaVersion: DATA_SCHEMA_VERSION,
```

In `loadState()`'s returned object, after `cargoViewerLayout: parsed.cargoViewerLayout || {},`:
```js
      cargoViewerLayout: parsed.cargoViewerLayout || {},
      approvedShipGrids: parsed.approvedShipGrids || {},
      dataSchemaVersion: parsed.dataSchemaVersion || 0,
```

`state.isAdmin` is deliberately NOT persisted: it is re-checked from the server on each load, so a stale local value can never grant anything. Initialise it next to the other module-level lets in `js/app.js`, right after `let editingMissionId = null;`:
```js
// Rempli au chargement depuis Supabase (voir fetchIsAdmin) — jamais persisté :
// un cache local ne doit pas pouvoir accorder l'admin. Ne sert qu'à afficher
// l'éditeur ; l'autorité reste la RLS côté base.
let isAdminUser = false;
```

- [ ] **Step 2: Add the Supabase reads**

In `js/cloud.js`, at the end of the file, add:
```js
// =========================================================================
// Grilles de cargo publiées (table ship_layouts) et statut admin.
// Lecture publique : marche même sans compte. Toute erreur (tables pas
// encore créées, hors-ligne...) est avalée et rend une valeur neutre —
// l'app doit continuer exactement comme avant si Supabase n'est pas là.
// =========================================================================
async function fetchApprovedShipGrids() {
  if (!sb) return {};
  try {
    const { data, error } = await sb.from("ship_layouts").select("ship_name, grid, orientation, mirror");
    if (error) throw error;
    const byShip = {};
    (data || []).forEach((row) => {
      byShip[row.ship_name] = { grid: row.grid, orientation: row.orientation || 0, mirror: !!row.mirror };
    });
    return byShip;
  } catch (err) {
    console.warn("Grilles publiées indisponibles :", err.message);
    return {};
  }
}

// Le client ne fait que DEMANDER s'il est admin, pour afficher l'éditeur.
// L'autorité est la RLS : un non-admin qui forcerait true côté client se
// ferait refuser toute écriture par la base.
async function fetchIsAdmin() {
  if (!sb || !cloudUserId) return false;
  try {
    const { data, error } = await sb.from("admins").select("user_id").eq("user_id", cloudUserId).maybeSingle();
    if (error) throw error;
    return !!data;
  } catch (err) {
    return false;
  }
}
```

- [ ] **Step 3: Hook both into the existing sync**

In `js/app.js`, `runFullSync()`, replace its final two statements:
```js
    await syncFleetyardsCargoHolds();
    renderShipCapacity();
```
with:
```js
    await syncFleetyardsCargoHolds();

    // Grilles publiées + statut admin. Après FleetYards : une grille publiée
    // le remplace (voir getShipHolds), donc elle doit être lue en dernier.
    if (typeof fetchApprovedShipGrids === "function") {
      state.approvedShipGrids = await fetchApprovedShipGrids();
      saveState();
    }
    if (typeof fetchIsAdmin === "function") isAdminUser = await fetchIsAdmin();

    renderShipCapacity();
```

- [ ] **Step 4: Bump cache-busting**

```bash
cd "C:/Users/djour/Projects/sc-cargo-optimizer"
sed -i 's/20260717-r26/20260717-r27/g' index.html
grep -c "20260717-r27" index.html    # Expected: 23
```

- [ ] **Step 5: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --check js/cloud.js && echo "cloud.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: both `OK`, `34/34 passed`.

- [ ] **Step 6: Verify graceful degradation in the browser**

The `ship_layouts` table does not exist in Supabase yet, so this is a real test of the failure path. Load the page and confirm the app is fully usable and nothing throws:
```js
const r = await page.evaluate(async () => {
  const grids = await fetchApprovedShipGrids();
  const admin = await fetchIsAdmin();
  return { grids, admin, stateGrids: state.approvedShipGrids };
});
console.log(JSON.stringify(r));
```
Expected: `{"grids":{},"admin":false,"stateGrids":{}}` — empty objects, `false`, **no unhandled error**, and the page still renders normally. A `console.warn` about unavailable grids is expected and fine.

- [ ] **Step 7: Commit**

```bash
git add js/app.js js/cloud.js index.html
git commit -m "Fetch published grids + admin flag, degrading to today's behaviour (admin grid editor 2/6)"
```

---

## Task 3: Resolve holds from the published grid (the FleetYards detachment)

**Files:**
- Modify: `js/app.js` (new `getShipHolds`; the single `getShipCargoHolds` call site at ~line 2243; `renderCargoStepView`)
- Modify: `index.html` (cache-busting)

**Interfaces:**
- Consumes: `state.approvedShipGrids` (Task 2); `getShipCargoHolds(shipName)` (`js/fleetyards.js`, unchanged).
- Produces (used by Tasks 4-6): `getShipHolds(shipName) -> holds[] | null`; `getPublishedGridPositions(shipName) -> { [name]: {x,y,z} } | null`.

- [ ] **Step 1: Add the resolver**

In `js/app.js`, immediately before `function runCargoPacking()`, add:
```js
// Soutes du vaisseau : grille publiée (Supabase) d'abord, FleetYards ensuite.
// C'est ICI que se fait le détachement — un vaisseau publié n'utilise plus du
// tout les données FleetYards. On ne branche pas ça dans js/fleetyards.js :
// ce fichier ne parle que de FleetYards, y mêler Supabase brouillerait une
// frontière nette.
function getShipHolds(shipName) {
  const published = shipName && state.approvedShipGrids[shipName];
  if (published && Array.isArray(published.grid) && published.grid.length) {
    return published.grid.map((m) => ({
      name: m.name,
      dimensions: m.dimensions,
      capacity: m.capacity,
      maxContainerSize: m.maxContainerSize,
    }));
  }
  return typeof getShipCargoHolds === "function" ? getShipCargoHolds(shipName) : null;
}

// Positions exactes d'une grille publiée, sous la forme attendue par la
// surcharge du visualiseur ({ [nom de module]: {x,y,z} }). Une grille publiée
// porte une position pour CHAQUE module : la reconstruction automatique est
// alors entièrement remplacée, le visualiseur ne devine plus rien.
function getPublishedGridPositions(shipName) {
  const published = shipName && state.approvedShipGrids[shipName];
  if (!published || !Array.isArray(published.grid)) return null;
  const byName = {};
  published.grid.forEach((m) => {
    if (m.position) byName[m.name] = { x: m.position.x, y: m.position.y, z: m.position.z };
  });
  return byName;
}
```

- [ ] **Step 2: Switch the single call site**

In `js/app.js`, in `runCargoPacking`, replace:
```js
  const holds = typeof getShipCargoHolds === "function" ? getShipCargoHolds(ship.name) : null;
```
with:
```js
  const holds = getShipHolds(ship.name);
```

- [ ] **Step 3: Feed published positions to the viewer**

In `js/app.js`, `renderCargoStepView` currently reads (near the `renderCargoViewer3D` call, ~line 2216 — note it resolves the ship via `getCargoViewerShipName()`, NOT a local `ship` variable):
```js
  const shipName = getCargoViewerShipName();
  const orientation = shipName ? getCargoViewerOrientation(shipName) : 0;
  const mirror = shipName ? getCargoViewerMirror(shipName) : false;
  const savedLayout = shipName ? getCargoViewerLayout(shipName) : {};
```
Replace those four lines with:
```js
  const shipName = getCargoViewerShipName();
  // Priorité : grille publiée (positions exactes) > disposition perso
  // (surcharge partielle) > reconstruction auto. Une grille publiée fait
  // autorité et remplace le placement perso du joueur.
  const publishedGrid = shipName ? state.approvedShipGrids[shipName] : null;
  const publishedPositions = shipName ? getPublishedGridPositions(shipName) : null;
  const orientation = publishedGrid ? publishedGrid.orientation : shipName ? getCargoViewerOrientation(shipName) : 0;
  const mirror = publishedGrid ? publishedGrid.mirror : shipName ? getCargoViewerMirror(shipName) : false;
  const savedLayout = publishedPositions || (shipName ? getCargoViewerLayout(shipName) : {});
```
`publishedGrid` is also consumed by Task 4 — keep the name.

- [ ] **Step 4: Bump cache-busting**

```bash
sed -i 's/20260717-r27/20260717-r28/g' index.html
grep -c "20260717-r28" index.html    # Expected: 23
```

- [ ] **Step 5: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: `app.js OK`, `34/34 passed`.

- [ ] **Step 6: Verify the detachment by injecting a published grid**

Sync FleetYards (see harness), then inject a published grid that is deliberately DIFFERENT from FleetYards' and confirm it wins:
```js
const r = await page.evaluate(() => {
  state.approvedShipGrids = { "Caterpillar": { grid: [
    { name: "test_bay", dimensions: { x: 2.5, y: 2.5, z: 2.5 }, capacity: 8, maxContainerSize: 8,
      position: { x: 0, y: 0, z: 0 } },
  ], orientation: 0, mirror: false } };
  const holds = getShipHolds("Caterpillar");
  return {
    count: holds.length,
    name: holds[0].name,
    capacity: holds[0].capacity,
    positions: getPublishedGridPositions("Caterpillar"),
    fleetyardsStillHas: getShipCargoHolds("Caterpillar").length,
  };
});
console.log(JSON.stringify(r));
```
Expected exactly: `count` is `1` and `name` is `"test_bay"` (the published grid replaced FleetYards' 14 holds), `capacity` `8`, `positions` is `{"test_bay":{"x":0,"y":0,"z":0}}`, and `fleetyardsStillHas` is `14` — proving FleetYards data is untouched and merely bypassed.

Then clear it and confirm the fallback:
```js
const back = await page.evaluate(() => {
  state.approvedShipGrids = {};
  return getShipHolds("Caterpillar").length;
});
console.log("fallback to FleetYards:", back);
```
Expected: `14`.

- [ ] **Step 7: Commit**

```bash
git add js/app.js index.html
git commit -m "Resolve holds from the published grid, bypassing FleetYards (admin grid editor 3/6)"
```

---

## Task 4: Lock the edit controls for non-admins on published ships

**Files:**
- Modify: `js/app.js` (`renderCargoStepView`)
- Modify: `index.html` (a note element; cache-busting)
- Modify: `js/i18n.js` (FR + EN)

**Interfaces:**
- Consumes: `state.approvedShipGrids` (Task 2), `isAdminUser` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Add the note element**

In `index.html`, immediately after the `<p id="cargo-edit-hint" ...></p>` line, add:
```html
          <p id="cargo-published-note" class="hint" style="display:none;" data-i18n="publishedGridNote"></p>
```

- [ ] **Step 2: Add the FR string**

In `js/i18n.js`, in the FRENCH dictionary right after the `editLayoutHint` entry:
```js
    publishedGridNote:
      "Grille officielle : la disposition de ce vaisseau a été validée et s'applique à tout le monde.",
```

- [ ] **Step 3: Add the EN string**

In `js/i18n.js`, in the ENGLISH dictionary right after its `editLayoutHint` entry:
```js
    publishedGridNote:
      "Official grid: this ship's layout has been validated and applies to everyone.",
```

- [ ] **Step 4: Hide the edit controls when a published grid exists**

In `js/app.js`, `renderCargoStepView`, immediately after the `savedLayout` line from Task 3 (which is where `publishedGrid` is now in scope), add:
```js
  // Vaisseau avec grille publiée : elle fait autorité, on masque les
  // contrôles de placement perso pour un joueur normal (l'admin garde son
  // propre éditeur, voir enterAdminGridEdit). Le vrai garde-fou reste la RLS
  // côté base — masquer un bouton n'est pas une sécurité.
  const locked = !!publishedGrid && !isAdminUser;
  const editBtn = document.getElementById("cargo-viewer-edit-btn");
  const publishedNote = document.getElementById("cargo-published-note");
  if (editBtn) editBtn.style.display = locked ? "none" : "";
  if (publishedNote) publishedNote.style.display = publishedGrid ? "" : "none";
  document.getElementById("cargo-viewer-rotate-btn").style.display = locked ? "none" : "";
  document.getElementById("cargo-viewer-mirror-btn").style.display = locked ? "none" : "";
```

- [ ] **Step 5: Bump cache-busting**

```bash
sed -i 's/20260717-r28/20260717-r29/g' index.html
grep -c "20260717-r29" index.html    # Expected: 23
```

- [ ] **Step 6: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --check js/i18n.js && echo "i18n.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: both `OK`, `34/34 passed`.

- [ ] **Step 7: Verify the lock in the browser**

Sync FleetYards, seed a mission and pack the Ironclad (use the `packShip` recipe from the earlier plans: fill `#mission-name`, `#mission-giver`, `#mission-reward`, `.cargo-commodity-input`, `.cargo-quantity-input`, `.cargo-pickup-input`, `.cargo-dropoff-input` with values from `#locations-datalist`, submit `#mission-submit-btn`, choose the ship in `#ship-select`, click the OPTIMISER button on the optimize tab, then `#pack-cargo-btn` on the cargo tab). Then:
```js
const r = await page.evaluate(() => {
  state.approvedShipGrids = { "Ironclad": { grid: getShipCargoHolds("Ironclad").map((h) => ({
    name: h.name, dimensions: h.dimensions, capacity: h.capacity,
    maxContainerSize: h.maxContainerSize, position: { x: 0, y: 0, z: 0 },
  })), orientation: 0, mirror: false } };
  isAdminUser = false;
  renderCargoStepView();
  return {
    edit: document.querySelector("#cargo-viewer-edit-btn").style.display,
    rotate: document.querySelector("#cargo-viewer-rotate-btn").style.display,
    note: document.querySelector("#cargo-published-note").style.display,
  };
});
console.log("non-admin, published:", JSON.stringify(r));
```
Expected: `{"edit":"none","rotate":"none","note":""}` — controls hidden, note shown.

Then confirm an admin is NOT locked:
```js
const a = await page.evaluate(() => {
  isAdminUser = true;
  renderCargoStepView();
  return document.querySelector("#cargo-viewer-edit-btn").style.display;
});
console.log("admin edit btn:", JSON.stringify(a));
```
Expected: `""` (visible).

And that a ship with no published grid is untouched:
```js
const n = await page.evaluate(() => {
  state.approvedShipGrids = {};
  isAdminUser = false;
  renderCargoStepView();
  return {
    edit: document.querySelector("#cargo-viewer-edit-btn").style.display,
    note: document.querySelector("#cargo-published-note").style.display,
  };
});
console.log("no published grid:", JSON.stringify(n));
```
Expected: `{"edit":"","note":"none"}`.

- [ ] **Step 8: Commit**

```bash
git add js/app.js js/i18n.js index.html
git commit -m "Lock placement controls for non-admins on published ships (admin grid editor 4/6)"
```

---

## Task 5: The admin editor — open, select, resize, add, remove

**Files:**
- Modify: `js/cargo-viewer.js` (expose the resolved grid; expose the selected module)
- Modify: `js/app.js` (draft state + editor logic)
- Modify: `index.html` (editor panel)
- Modify: `js/i18n.js` (FR + EN)

**Interfaces:**
- Consumes: `getShipHolds` / `getPublishedGridPositions` (Task 3); `isAdminUser` (Task 2); `setCargoLayoutEditing(on)`, `renderCargoViewer3D(holds, placements, rotation, mirror, savedLayout)`, `UNIT` (existing).
- Produces (used by Task 6): `adminGridDraft` — an array of `{ name, dimensions:{x,y,z}, capacity, maxContainerSize, position:{x,y,z} }`; `renderAdminGridEditor()`.

- [ ] **Step 1: Expose the resolved grid from the viewer**

In `js/cargo-viewer.js`, after `window.setCargoViewerView = setCargoViewerView;`, add:
```js
// Positions RÉSOLUES du dernier rendu, une entrée par module affiché.
// La disposition perso est une surcharge PARTIELLE (seuls les modules
// déplacés y figurent) : pour amorcer un brouillon d'éditeur il faut les
// positions de TOUS les modules, y compris ceux placés par la
// reconstruction automatique. Rien d'autre ne les expose.
window.getResolvedCargoGrid = function getResolvedCargoGrid() {
  return lastResolvedLayout.map((l) => ({
    name: l.hold.name,
    dimensions: { x: l.hold.dimensions.x, y: l.hold.dimensions.y, z: l.hold.dimensions.z },
    capacity: l.hold.capacity,
    maxContainerSize: l.hold.maxContainerSize,
    position: { x: l.worldPos[0], y: l.worldPos[1], z: l.worldPos[2] },
  }));
};
```

Add the module-level store next to `let lastLabelMetrics = null;`:
```js
// Dernier `layout` résolu (modules + worldPos finaux) — voir
// getResolvedCargoGrid.
let lastResolvedLayout = [];
```

And in `renderCargoViewer3D`, immediately after the `maxDy`/`maxDz`/`totalWidth` bounds loop, add:
```js
  lastResolvedLayout = layout;
```

- [ ] **Step 2: Add the editor panel markup**

In `index.html`, immediately after the `<div class="cargo-viewer-controls">…</div>` closing tag (still inside `#cargo-viewer-panel`), add:
```html
          <div id="admin-grid-panel" style="display:none;">
            <p class="hint" data-i18n="adminGridHint"></p>
            <div class="admin-grid-row">
              <button type="button" id="admin-grid-add-btn" class="btn-secondary btn-view-sm" data-i18n="adminGridAddBtn"></button>
              <button type="button" id="admin-grid-remove-btn" class="btn-danger btn-view-sm" data-i18n="adminGridRemoveBtn"></button>
              <button type="button" id="admin-grid-publish-btn" class="btn-primary btn-view-sm" data-i18n="adminGridPublishBtn"></button>
              <button type="button" id="admin-grid-close-btn" class="btn-secondary btn-view-sm" data-i18n="adminGridCloseBtn"></button>
            </div>
            <div id="admin-grid-selected" style="display:none;">
              <p id="admin-grid-selected-name" class="hint"></p>
              <div class="admin-grid-row">
                <label for="admin-grid-cx" data-i18n="adminGridCellsX"></label>
                <input type="number" id="admin-grid-cx" min="1" step="1" />
                <label for="admin-grid-cy" data-i18n="adminGridCellsY"></label>
                <input type="number" id="admin-grid-cy" min="1" step="1" />
                <label for="admin-grid-cz" data-i18n="adminGridCellsZ"></label>
                <input type="number" id="admin-grid-cz" min="1" step="1" />
                <label for="admin-grid-mcs" data-i18n="adminGridMaxBox"></label>
                <select id="admin-grid-mcs"></select>
                <span id="admin-grid-capacity" class="hint"></span>
              </div>
            </div>
          </div>
```

And in the cargo tab, immediately after the `<button type="button" id="pack-cargo-btn" ...></button>` line, add the entry point:
```html
          <button type="button" id="admin-grid-edit-btn" class="btn-secondary" style="display:none;" data-i18n="adminGridEditBtn"></button>
```

- [ ] **Step 3: Add the FR strings**

In `js/i18n.js`, in the FRENCH dictionary right after `publishedGridNote`:
```js
    adminGridEditBtn: "Éditer la grille (admin)",
    adminGridHint:
      "Édite la grille de ce vaisseau : clique une grille pour la sélectionner, glisse-la pour la placer (change de vue pour régler la hauteur), et règle sa taille en cellules SCU. La capacité se calcule toute seule. Rien n'est publié tant que tu ne cliques pas Publier.",
    adminGridAddBtn: "Ajouter une grille",
    adminGridRemoveBtn: "Supprimer la grille",
    adminGridPublishBtn: "Publier la grille",
    adminGridCloseBtn: "Fermer sans publier",
    adminGridCellsX: "Largeur (cellules)",
    adminGridCellsY: "Profondeur (cellules)",
    adminGridCellsZ: "Hauteur (cellules)",
    adminGridMaxBox: "Caisse max (SCU)",
    adminGridCapacity: "Capacité : {scu} SCU",
    adminGridSelectFirst: "Sélectionne d'abord une grille.",
```

- [ ] **Step 4: Add the EN strings**

In `js/i18n.js`, in the ENGLISH dictionary right after its `publishedGridNote`:
```js
    adminGridEditBtn: "Edit grid (admin)",
    adminGridHint:
      "Edit this ship's grid: click a grid to select it, drag it to place it (switch view to set its height), and set its size in SCU cells. Capacity is computed for you. Nothing is published until you click Publish.",
    adminGridAddBtn: "Add a grid",
    adminGridRemoveBtn: "Delete grid",
    adminGridPublishBtn: "Publish grid",
    adminGridCloseBtn: "Close without publishing",
    adminGridCellsX: "Width (cells)",
    adminGridCellsY: "Depth (cells)",
    adminGridCellsZ: "Height (cells)",
    adminGridMaxBox: "Max box (SCU)",
    adminGridCapacity: "Capacity: {scu} SCU",
    adminGridSelectFirst: "Select a grid first.",
```

- [ ] **Step 5: Add the draft, capacity derivation, and rendering**

In `js/app.js`, immediately after `getPublishedGridPositions` (Task 3), add:
```js
// =========================================================================
// Éditeur de grille (admin) — voir
// docs/superpowers/specs/2026-07-17-admin-grid-editor-design.md
// On édite LE VAISSEAU, pas la cargaison : l'éditeur s'ouvre sans qu'aucun
// rangement n'existe (un vaisseau inconnu de FleetYards n'a rien à ranger),
// donc il force l'affichage du visualiseur et y rend son brouillon.
// =========================================================================
const ADMIN_GRID_MAX_BOX_SIZES = [1, 2, 4, 8, 16, 24, 32];

let adminGridDraft = null; // [{ name, dimensions, capacity, maxContainerSize, position }]
let adminGridShipName = null;
let adminGridSelected = null; // le nom du module sélectionné

// La capacité n'est JAMAIS saisie : c'est le volume en cellules SCU.
// Vérifié sur les 284 soutes FleetYards, 284/284 sans exception.
function capacityFromDimensions(dims) {
  return Math.round((dims.x / UNIT_M) * (dims.y / UNIT_M) * (dims.z / UNIT_M));
}
```

`UNIT` lives in the ES module and is not visible to `js/app.js`, so declare the constant locally next to `DEFAULT_DISTANCE` at the top of `js/app.js`:
```js
const UNIT_M = 1.25; // 1 cellule SCU = 1,25 m (doit rester égal à UNIT dans js/cargo-viewer.js)
```

Then add the editor body, after `capacityFromDimensions`:
```js
function renderAdminGridEditor() {
  const panel = document.getElementById("cargo-viewer-panel");
  const nav = document.getElementById("cargo-step-nav");
  const adminPanel = document.getElementById("admin-grid-panel");
  if (!adminGridDraft) {
    adminPanel.style.display = "none";
    return;
  }
  panel.style.display = "";
  nav.style.display = "none";
  adminPanel.style.display = "";
  document.getElementById("cargo-published-note").style.display = "none";

  const holds = adminGridDraft.map((m) => ({
    name: m.name,
    dimensions: m.dimensions,
    capacity: m.capacity,
    maxContainerSize: m.maxContainerSize,
  }));
  const positions = {};
  adminGridDraft.forEach((m) => (positions[m.name] = { x: m.position.x, y: m.position.y, z: m.position.z }));
  // Aucune caisse : on place des grilles, pas de la cargaison.
  if (typeof renderCargoViewer3D === "function") renderCargoViewer3D(holds, [], 0, false, positions);

  renderAdminGridSelection();
}

function renderAdminGridSelection() {
  const box = document.getElementById("admin-grid-selected");
  const mod = adminGridDraft && adminGridDraft.find((m) => m.name === adminGridSelected);
  if (!mod) {
    box.style.display = "none";
    return;
  }
  box.style.display = "";
  document.getElementById("admin-grid-selected-name").textContent = mod.name;
  document.getElementById("admin-grid-cx").value = Math.round(mod.dimensions.x / UNIT_M);
  document.getElementById("admin-grid-cy").value = Math.round(mod.dimensions.y / UNIT_M);
  document.getElementById("admin-grid-cz").value = Math.round(mod.dimensions.z / UNIT_M);
  const sel = document.getElementById("admin-grid-mcs");
  sel.value = String(mod.maxContainerSize);
  document.getElementById("admin-grid-capacity").textContent = t("adminGridCapacity", { scu: mod.capacity });
}

function applyAdminGridSize() {
  const mod = adminGridDraft && adminGridDraft.find((m) => m.name === adminGridSelected);
  if (!mod) return;
  const cx = Math.max(1, Number(document.getElementById("admin-grid-cx").value) || 1);
  const cy = Math.max(1, Number(document.getElementById("admin-grid-cy").value) || 1);
  const cz = Math.max(1, Number(document.getElementById("admin-grid-cz").value) || 1);
  mod.dimensions = { x: cx * UNIT_M, y: cy * UNIT_M, z: cz * UNIT_M };
  mod.capacity = capacityFromDimensions(mod.dimensions);
  mod.maxContainerSize = Number(document.getElementById("admin-grid-mcs").value) || 1;
  renderAdminGridEditor();
}

function enterAdminGridEdit() {
  const ship = getSelectedShip();
  if (!ship) return;
  adminGridShipName = ship.name;
  adminGridSelected = null;

  // Amorçage : grille publiée > soutes FleetYards résolues > vide.
  const published = state.approvedShipGrids[ship.name];
  if (published && Array.isArray(published.grid) && published.grid.length) {
    adminGridDraft = JSON.parse(JSON.stringify(published.grid));
  } else {
    const holds = getShipHolds(ship.name) || [];
    // Rendu d'abord pour obtenir les positions résolues de la reconstruction
    // automatique (la disposition perso est partielle et ne les contient pas).
    if (holds.length && typeof renderCargoViewer3D === "function") {
      document.getElementById("cargo-viewer-panel").style.display = "";
      renderCargoViewer3D(holds, [], 0, false, getCargoViewerLayout(ship.name));
      adminGridDraft = typeof getResolvedCargoGrid === "function" ? getResolvedCargoGrid() : [];
    } else {
      adminGridDraft = [];
    }
  }

  document.getElementById("admin-grid-edit-btn").style.display = "none";
  if (typeof setCargoLayoutEditing === "function") setCargoLayoutEditing(true);
  setCargoLayoutEditUI(true);
  renderAdminGridEditor();
}

function exitAdminGridEdit() {
  adminGridDraft = null;
  adminGridShipName = null;
  adminGridSelected = null;
  document.getElementById("admin-grid-panel").style.display = "none";
  if (typeof setCargoLayoutEditing === "function") setCargoLayoutEditing(false);
  setCargoLayoutEditUI(false);
  renderCargoStepView();
  renderAdminGridEntry();
}

// Le bouton d'entrée n'apparaît que pour un admin, avec un vaisseau choisi.
function renderAdminGridEntry() {
  const btn = document.getElementById("admin-grid-edit-btn");
  if (!btn) return;
  btn.style.display = isAdminUser && getSelectedShip() && !adminGridDraft ? "" : "none";
}

function addAdminGridModule() {
  if (!adminGridDraft) return;
  let i = 1;
  let name = `grid_${i}`;
  while (adminGridDraft.some((m) => m.name === name)) name = `grid_${++i}`;
  const dims = { x: UNIT_M, y: UNIT_M, z: UNIT_M };
  adminGridDraft.push({
    name,
    dimensions: dims,
    capacity: capacityFromDimensions(dims),
    maxContainerSize: 1,
    position: { x: 0, y: 0, z: 0 },
  });
  adminGridSelected = name;
  renderAdminGridEditor();
}

function removeAdminGridModule() {
  if (!adminGridDraft || !adminGridSelected) {
    alert(t("adminGridSelectFirst"));
    return;
  }
  adminGridDraft = adminGridDraft.filter((m) => m.name !== adminGridSelected);
  adminGridSelected = null;
  renderAdminGridEditor();
}
```

- [ ] **Step 6: Let a drag update the draft, and a click select**

The viewer already calls `window.persistCargoModulePosition(key, x, y, z)` on drop. In `js/app.js`, change that function so a drop lands in the draft while the admin editor is open:
```js
window.persistCargoModulePosition = function persistCargoModulePosition(moduleKey, x, y, z) {
  // En édition admin, un glisser modifie le BROUILLON (rien n'est publié tant
  // que Publier n'est pas cliqué), pas la disposition perso du joueur.
  if (adminGridDraft) {
    const mod = adminGridDraft.find((m) => m.name === moduleKey);
    if (mod) {
      mod.position = { x, y, z };
      adminGridSelected = moduleKey;
      renderAdminGridSelection();
    }
    return;
  }
  const shipName = getCargoViewerShipName();
  if (!shipName || !moduleKey) return;
  if (!state.cargoViewerLayout[shipName]) state.cargoViewerLayout[shipName] = {};
  state.cargoViewerLayout[shipName][moduleKey] = { x, y, z };
  saveState();
};
```

Selection on click: the viewer sets `dragTarget` on pointer-down even when no movement follows. In `js/cargo-viewer.js`, at the end of `onLayoutPointerDown` (after `controls.enabled = false;`), add:
```js
  // Prévient l'app du module visé, pour que l'éditeur admin puisse le
  // sélectionner même sans glisser (un simple clic).
  if (typeof window.onCargoModulePicked === "function") {
    window.onCargoModulePicked(dragTarget.userData.moduleKey);
  }
```
And in `js/app.js`, next to `persistCargoModulePosition`:
```js
window.onCargoModulePicked = function onCargoModulePicked(moduleKey) {
  if (!adminGridDraft) return;
  adminGridSelected = moduleKey;
  renderAdminGridSelection();
};
```

- [ ] **Step 7: Wire the controls**

In `js/app.js`, inside the `DOMContentLoaded` handler next to the other cargo-viewer listeners, add:
```js
  const mcsSelect = document.getElementById("admin-grid-mcs");
  ADMIN_GRID_MAX_BOX_SIZES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s} SCU`;
    mcsSelect.appendChild(opt);
  });
  document.getElementById("admin-grid-edit-btn").addEventListener("click", enterAdminGridEdit);
  document.getElementById("admin-grid-close-btn").addEventListener("click", exitAdminGridEdit);
  document.getElementById("admin-grid-add-btn").addEventListener("click", addAdminGridModule);
  document.getElementById("admin-grid-remove-btn").addEventListener("click", removeAdminGridModule);
  ["admin-grid-cx", "admin-grid-cy", "admin-grid-cz", "admin-grid-mcs"].forEach((id) => {
    document.getElementById(id).addEventListener("change", applyAdminGridSize);
  });
```

And in the existing `ship-select` change handler, add `renderAdminGridEntry();` as its last statement so the entry button follows the selected ship.

- [ ] **Step 8: Bump cache-busting**

```bash
sed -i 's/20260717-r29/20260717-r30/g' index.html
grep -c "20260717-r30" index.html    # Expected: 23
```

- [ ] **Step 9: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --check js/i18n.js && echo "i18n.js OK"
node --input-type=module --check < js/cargo-viewer.js && echo "cargo-viewer.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: three `OK`, `34/34 passed`.

- [ ] **Step 10: Verify the editor in the browser**

Sync FleetYards. Then, with **no mission and no packing at all** (this is the point — you edit the ship, not the cargo):
```js
const r = await page.evaluate(() => {
  isAdminUser = true;
  const sel = document.querySelector("#ship-select");
  sel.value = Array.from(sel.options).find((o) => o.textContent.startsWith("Caterpillar (")).value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  renderAdminGridEntry();
  return document.querySelector("#admin-grid-edit-btn").style.display;
});
console.log("admin entry btn (expect ''):", JSON.stringify(r));

const opened = await page.evaluate(() => {
  enterAdminGridEdit();
  return {
    draftLen: adminGridDraft.length,
    panel: document.querySelector("#admin-grid-panel").style.display,
    viewerVisible: document.querySelector("#cargo-viewer-panel").style.display,
    everyHasPosition: adminGridDraft.every((m) => m.position && typeof m.position.x === "number"),
  };
});
console.log("opened:", JSON.stringify(opened));
```
Expected: entry button `""`; `draftLen` `14` (the Caterpillar's holds, seeded from FleetYards), `panel` `""`, `viewerVisible` `""` (forced open with no packing result), `everyHasPosition` `true`.

Then exercise the operations:
```js
const ops = await page.evaluate(() => {
  const before = adminGridDraft.length;
  addAdminGridModule();
  const added = adminGridDraft.length;
  const newName = adminGridSelected;
  // resize the new module to 6 x 20 x 6 cells
  document.querySelector("#admin-grid-cx").value = "6";
  document.querySelector("#admin-grid-cy").value = "20";
  document.querySelector("#admin-grid-cz").value = "6";
  applyAdminGridSize();
  const m = adminGridDraft.find((x) => x.name === newName);
  const resized = { dims: m.dimensions, capacity: m.capacity, shown: document.querySelector("#admin-grid-capacity").textContent };
  removeAdminGridModule();
  return { before, added, removed: adminGridDraft.length, resized };
});
console.log("ops:", JSON.stringify(ops));
```
Expected: `before` `14`, `added` `15`, `removed` `14`; `resized.dims` is `{"x":7.5,"y":25,"z":7.5}` (6/20/6 cells × 1.25) and `resized.capacity` is **720** — the derived capacity (6×20×6), with `resized.shown` displaying it.

- [ ] **Step 11: Commit**

```bash
git add js/app.js js/cargo-viewer.js js/i18n.js index.html
git commit -m "Admin grid editor: open, select, resize in SCU cells, add, remove (admin grid editor 5/6)"
```

---

## Task 6: Publish the grid

**Files:**
- Modify: `js/cloud.js` (the upsert)
- Modify: `js/app.js` (publish handler)
- Modify: `index.html` (cache-busting)
- Modify: `js/i18n.js` (FR + EN)

**Interfaces:**
- Consumes: `adminGridDraft`, `adminGridShipName` (Task 5); `state.approvedShipGrids` (Task 2).
- Produces: `publishShipGrid(shipName, grid, orientation, mirror) -> Promise<boolean>` (`js/cloud.js`).

- [ ] **Step 1: Add the upsert**

In `js/cloud.js`, after `fetchIsAdmin`, add:
```js
// Publie la grille d'un vaisseau. La RLS refuse cet upsert à quiconque n'est
// pas dans la table admins — c'est elle qui fait autorité, pas l'interface.
async function publishShipGrid(shipName, grid, orientation, mirror) {
  if (!sb) return false;
  try {
    const { error } = await sb.from("ship_layouts").upsert(
      { ship_name: shipName, grid, orientation: orientation || 0, mirror: !!mirror, updated_at: new Date().toISOString() },
      { onConflict: "ship_name" }
    );
    if (error) throw error;
    return true;
  } catch (err) {
    alert(t("adminGridPublishFailed", { msg: err.message }));
    return false;
  }
}
```

- [ ] **Step 2: Add the publish handler**

In `js/app.js`, after `removeAdminGridModule`, add:
```js
async function publishAdminGrid() {
  if (!adminGridDraft || !adminGridShipName) return;
  if (!adminGridDraft.length) {
    alert(t("adminGridEmpty"));
    return;
  }
  if (!confirm(t("adminGridPublishConfirm", { ship: adminGridShipName }))) return;
  const ok = await publishShipGrid(adminGridShipName, adminGridDraft, 0, false);
  if (!ok) return;
  // Reflète tout de suite le résultat sans attendre la prochaine synchro.
  state.approvedShipGrids[adminGridShipName] = { grid: adminGridDraft, orientation: 0, mirror: false };
  saveState();
  alert(t("adminGridPublished", { ship: adminGridShipName }));
  exitAdminGridEdit();
}
```

Wire it in the `DOMContentLoaded` handler next to the other admin listeners:
```js
  document.getElementById("admin-grid-publish-btn").addEventListener("click", publishAdminGrid);
```

- [ ] **Step 3: Add the FR strings**

In `js/i18n.js`, FRENCH dictionary, after `adminGridSelectFirst`:
```js
    adminGridEmpty: "La grille est vide — ajoute au moins une grille avant de publier.",
    adminGridPublishConfirm:
      "Publier cette grille pour « {ship} » ? Elle remplacera la grille actuelle pour TOUS les joueurs.",
    adminGridPublished: "Grille publiée pour « {ship} ».",
    adminGridPublishFailed: "Échec de la publication : {msg}",
```

- [ ] **Step 4: Add the EN strings**

In `js/i18n.js`, ENGLISH dictionary, after its `adminGridSelectFirst`:
```js
    adminGridEmpty: "The grid is empty — add at least one grid before publishing.",
    adminGridPublishConfirm:
      "Publish this grid for \"{ship}\"? It will replace the current grid for EVERY player.",
    adminGridPublished: "Grid published for \"{ship}\".",
    adminGridPublishFailed: "Publishing failed: {msg}",
```

- [ ] **Step 5: Bump cache-busting**

```bash
sed -i 's/20260717-r30/20260717-r31/g' index.html
grep -c "20260717-r31" index.html    # Expected: 23
```

- [ ] **Step 6: Verify syntax + regression suite**

```bash
node --check js/app.js && echo "app.js OK"
node --check js/cloud.js && echo "cloud.js OK"
node --check js/i18n.js && echo "i18n.js OK"
node scripts/cargo-packing-tests.cjs 2>&1 | tail -2
```
Expected: three `OK`, `34/34 passed`.

- [ ] **Step 7: Verify publishing without a real Supabase**

The table does not exist yet, so verify the **payload** and the **failure path**, by stubbing `publishShipGrid`:
```js
const r = await page.evaluate(async () => {
  isAdminUser = true;
  const sel = document.querySelector("#ship-select");
  sel.value = Array.from(sel.options).find((o) => o.textContent.startsWith("Caterpillar (")).value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  enterAdminGridEdit();

  let captured = null;
  window.publishShipGrid = async (ship, grid, orientation, mirror) => {
    captured = { ship, count: grid.length, orientation, mirror, first: grid[0] };
    return true;
  };
  window.confirm = () => true;
  window.alert = () => {};
  await publishAdminGrid();
  return { captured, cached: !!state.approvedShipGrids["Caterpillar"], draftCleared: adminGridDraft === null };
});
console.log(JSON.stringify(r, null, 2));
```
Expected: `captured.ship` is `"Caterpillar"`, `captured.count` is `14`, `captured.first` carries `name`/`dimensions`/`capacity`/`maxContainerSize`/`position`; `cached` is `true` (published grid reflected immediately); `draftCleared` is `true` (editor closed).

Then confirm the real function fails safely against the missing table:
```js
const fail = await page.evaluate(async () => {
  let msg = null;
  window.alert = (m) => (msg = m);
  const ok = await publishShipGrid("ZZTest", [], 0, false);
  return { ok, alerted: !!msg };
});
console.log("real publish against missing table:", JSON.stringify(fail));
```
Expected: `ok` is `false` and `alerted` is `true` — it fails loudly to the maintainer, not silently, and does not throw.

- [ ] **Step 8: Commit**

```bash
git add js/app.js js/cloud.js js/i18n.js index.html
git commit -m "Publish a grid to Supabase from the admin editor (admin grid editor 6/6)"
```

---

## Self-Review Notes

**Spec coverage:** §1 tables + RLS → Task 1. §2 grid shape, derived capacity, maxContainerSize enum → Tasks 5 (`capacityFromDimensions`, dropdown) and 1 (storage). §3 fetch + `getShipHolds` + detachment + published positions + orientation/mirror → Tasks 2-3. §4 non-admin lock → Task 4. §5 editor (entry outside the viewer panel, seeding, move/select/resize/add/remove, explicit publish, unique names) → Tasks 5-6. §7 tests → each task's browser check + the packing suite gate. §8 SQL with placeholder → Task 1.

**Deliberate deviation:** the spec's §5 says the draft seeds from "published > FleetYards resolved > empty". Task 5 implements exactly that, but note it must RENDER once to read `getResolvedCargoGrid()` — the personal layout is only a partial override and does not contain positions for undragged modules. That is why `enterAdminGridEdit` renders before seeding.

**Known limitation, by design:** every browser verification injects state instead of talking to Supabase. The Supabase half (RLS, real admin rights, the actual upsert) cannot be tested without project access and is validated by the maintainer's first real run. Tasks 2 and 6 therefore explicitly test the *failure* paths (missing tables) that the maintainer will hit before running the SQL.

**Naming consistency:** `UNIT_M` (app.js) must equal `UNIT` (cargo-viewer.js) = 1.25; they are separate because the viewer is an ES module and its constants are not visible to the classic scripts. `isAdminUser` is the app-side flag (not `state.isAdmin` — deliberately not persisted). The draft module key is `name`, matching the viewer's `moduleKey`.
