# Cockpit HUD Graphic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the site's entire visual identity (navy/coral/cyan, Oswald/IBM Plex Sans) with a "Cockpit HUD" aesthetic (near-black base, single coral accent, cut-corner panels, Rajdhani/Titillium Web) across both dark and light themes, on **every** tab and component (including Réputation's sliders/lock buttons and the Entreprises cards — not just the patterns shown in the brainstorming mockups, which were illustrative samples, not full coverage), with zero change to application logic or behavior.

**Architecture:** The codebase already routes nearly every *color* through CSS custom properties defined in two `:root` blocks in `css/style.css` (dark default, `:root[data-theme="light"]` override) — a grep confirms zero hardcoded hex colors outside those two blocks. Retokening those two blocks (Task 1) cascades the new palette across the whole site in one step. *Shape* (border-radius) is not tokenized at all — a full audit found **23 separate `border-radius` declarations** across the stylesheet, only 5 of which are the "primary panels" the design spec calls out for the cut-corner treatment. Task 3 catalogs and resolves all 23 explicitly (flatten to sharp, apply the cut-corner, or document as a deliberate circular/pill exception) so nothing is silently missed.

**Tech Stack:** Vanilla CSS custom properties, Google Fonts (Rajdhani, Titillium Web), CSS `clip-path` for the corner-cut motif, native `accent-color` for the reputation range slider. No build step, no new JS dependencies.

**Test cycle note:** This is a visual-only change with no new business logic, so "tests" here means two things every task must do, not literal unit tests: (1) run `node scripts/cargo-packing-tests.cjs` and confirm all 34 still pass (proof no logic was touched), and (2) take a real screenshot in a real browser (this project's established verification method all session — headless Edge via `msedge.exe --headless=new --disable-gpu --screenshot=...` for static pages, or Puppeteer connected to a running headless Edge instance via `--remote-debugging-port` for interactive flows) and visually confirm the specific expected outcome named in that task's step.

## Global Constraints

- Branch: `redesign/cockpit-hud` (already created off `master`). **Never push to `origin` or merge to `master`** — all commits stay local on this branch until the user explicitly asks otherwise.
- Cache-busting: after every task that touches a versioned file (`css/style.css`, `index.html`, `js/cargo-viewer.js`), bump the `?v=YYYYMMDD-rNN` query string on all ~23 occurrences in `index.html` — check the live file for the current `rNN` before bumping, it has changed many times this session, do not assume a fixed number.
- Do not regress layout/behavior fixes already made this session: equal-width action buttons (`min-width:100px` on `.actions-cell button`), single-line "Faces accessibles" fieldset, the independent (non-height-capped) `.cargo-step-nav` card, the two-column New Mission field split (45fr/45fr/10fr), the front/rear/left/right 3D viewer axis convention (do NOT touch — a prior session investigation confirmed the current convention is correct and reverted an incorrect "fix"). This plan only changes *color, type, shape* — never layout structure, IDs, or JS logic.
- Both themes (dark default, light via the existing toggle) must be visually verified for every task that touches color.
- No new npm/CDN dependencies except the two Google Fonts (Rajdhani, Titillium Web) replacing the two currently loaded (Oswald, IBM Plex Sans) — same loading mechanism (`<link>` in `index.html`), not a net-new dependency class.
- **Full coverage, not sample coverage:** every tab (Nouvelle mission, Missions enregistrées, Optimisation de la route, Optimisation du cargo, Historique, Réputation) and every distinct component type (forms, tables, buttons, panels, the reputation slider/tick/lock-button system, company cards, the OCR import panel/dropzone/preview) must be visually verified before this plan is considered done — not just the handful of components shown during brainstorming.

---

### Task 1: Design tokens, fonts, and shadow retinting

**Files:**
- Modify: `css/style.css:1-33` (palette comment + both `:root` token blocks)
- Modify: `css/style.css` (7 occurrences of `rgba(0, 0, 0, ...)` box-shadows — find via `grep -n "rgba(0, 0, 0" css/style.css`)
- Modify: `index.html` (Google Fonts `<link>` tag, currently `Oswald:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600`)

**Interfaces:**
- Produces: the token names other tasks read (`--bg`, `--panel`, `--panel-border`, `--input-border` [new token — the code currently reuses `--panel-border` for input borders too; this task adds `--input-border` as a distinct value], `--text`, `--muted`, `--accent`, `--on-accent`, `--success` [new name, replaces `--accent-2`], `--warning`, `--danger`, `--heading-font`, `--body-font` [new named token; the existing code only sets a bare `font-family` on `:root` for body text]).

- [ ] **Step 1: Replace the dark-theme token block**

Read `css/style.css:1-19` first. Replace the entire `:root { ... }` block (keep `color-scheme: dark;` and `line-height: 1.5;`) with:

```css
/* Palette "Cockpit HUD" : quasi-noir #0c0f16, panneaux #141821, accent
   unique corail #ff7a52 (rouge/danger et vert/succès restent des teintes
   séparées, jamais confondues avec l'accent). Voir
   docs/superpowers/specs/2026-07-17-cockpit-hud-redesign-design.md pour
   les ratios de contraste vérifiés. */
:root {
  color-scheme: dark;
  --bg: #0c0f16;
  --panel: #141821;
  --panel-border: #2a2f38;
  --text: #dbe4ea;
  --muted: #8a95a0;
  --accent: #ff7a52;
  --success: #6bcf7a;
  --danger: #ff5568;
  --warning: #e0a030;
  --input-bg: #0c0f16;
  --input-border: #3a4048;
  --btn-secondary-bg: #232833;
  --on-accent: #160800;
  --heading-font: "Rajdhani", "Segoe UI", system-ui, sans-serif;
  --body-font: "Titillium Web", "Segoe UI", system-ui, sans-serif;
  font-family: var(--body-font);
  line-height: 1.5; /* le défaut navigateur (~1.2) tassait le texte des libellés/indices sur tout le site */
}
```

- [ ] **Step 2: Replace the light-theme token block**

Re-read the file to find `:root[data-theme="light"]` (position shifted after Step 1). Replace its contents with:

```css
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #eef1f4;
  --panel: #ffffff;
  --panel-border: #c7cfd6;
  --text: #141821;
  --muted: #5c6470;
  --accent: #a83f22;
  --success: #167a2e;
  --danger: #b32036;
  --warning: #8a5a0a;
  --input-bg: #f7f9fb;
  --input-border: #a9b4bd;
  --btn-secondary-bg: #cdd6e0;
  --on-accent: #ffffff;
}
```

- [ ] **Step 3: Fix references to renamed/removed tokens**

```bash
grep -n "var(--accent-cyan)\|var(--accent-2)" css/style.css
```

Replace every `var(--accent-cyan)` with `var(--accent)`. Replace every `var(--accent-2)` with `var(--success)`.

- [ ] **Step 4: Retint the black box-shadows**

```bash
grep -n "rgba(0, 0, 0" css/style.css
```

Replace every `rgba(0, 0, 0, X)` with `rgba(2, 3, 5, X)` (same alpha value X each rule already has) — a near-black with a cool tint matching `--bg` instead of neutral grey-black.

- [ ] **Step 5: Swap the Google Fonts link**

In `index.html`, replace:
```html
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
```
with:
```html
<link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Titillium+Web:wght@400;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 6: Run the regression suite**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 7: Bump cache-busting and take a real screenshot**

Bump `?v=` on all ~23 occurrences in `index.html`. Screenshot the default "Nouvelle mission" tab in dark theme, then again after toggling light theme. Confirm: background near-black/pale-grey respectively, `--accent`-colored elements render coral (not the old cyan/navy), headings in Rajdhani, body text in Titillium Web.

- [ ] **Step 8: Commit**

```bash
git add css/style.css index.html
git commit -m "Retoken color palette and swap fonts for Cockpit HUD redesign

Replaces the navy/coral/cyan palette with a near-black base and single
coral accent (--accent-cyan and --accent-2 tokens removed, merged into
--accent and --success respectively), and swaps Oswald/IBM Plex Sans
for Rajdhani/Titillium Web. Cascades across the whole site since the
codebase already routes every color through these two :root blocks —
confirmed zero hardcoded hex colors elsewhere in css/style.css."
```

---

### Task 2: Corner-cut treatment on the 5 primary panels

**Files:**
- Modify: `css/style.css` (`.side-block`, `.tabs`, `.access-faces-fieldset`, `.cargo-step-nav`, `.cargo-viewer-panel`)
- Modify: `index.html` (add `cut-corner` class to the matching elements)

**Interfaces:**
- Consumes: `--panel-border` (Task 1)
- Produces: a reusable `.cut-corner` class

- [ ] **Step 1: Add the shared cut-corner rule**

Add this rule right before the `.side-block` rule in `css/style.css`:

```css
/* Motif "coin coupé" façon panneau HUD — réservé aux 5 panneaux de
   contenu primaires (formulaire/action principale). Jamais sur des
   éléments interactifs répétés/petits (boutons, cellules de tableau,
   champs de saisie) : une coupe de 12px déformerait leur contenu. Voir
   Task 3 pour les 18 autres border-radius du site (aplatis ou laissés
   circulaires/pilule selon leur nature). */
.cut-corner {
  clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
  border-radius: 0 !important;
}
```

- [ ] **Step 2: Flatten the 5 panels' own border-radius**

Change `border-radius` to `0` in each of these 5 rules (search each with `grep -n` first to confirm current line numbers, they shift after Task 1's edits):
- `.side-block` (currently `10px`)
- `.tabs` (currently `10px`)
- `.access-faces-fieldset` (currently `6px`)
- `.cargo-viewer-panel` (currently `8px`)
- `.cargo-step-nav` (currently `10px`)

- [ ] **Step 3: Add the `cut-corner` class in `index.html`**

Add `cut-corner` to the `class` attribute on:
- Every element with class `side-block` (3 occurrences: "Mon vaisseau", "Importer une mission", the reset-all wrapper)
- The element with class `tabs`
- `<fieldset id="ship-access-faces" class="access-faces-fieldset">` → `class="access-faces-fieldset cut-corner"`
- `<div id="cargo-step-nav" class="cargo-step-nav" ...>` → `class="cargo-step-nav cut-corner"`
- `<div id="cargo-viewer-panel" class="cargo-viewer-panel" ...>` → `class="cargo-viewer-panel cut-corner"`

- [ ] **Step 4: Run the regression suite**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 5: Bump cache-busting and verify visually**

Screenshot the sidebar cards, the main tab card, the cargo tab's fieldset and step-nav card, in both themes. Confirm no panel content gets clipped by the cut — only the background/border shape is cut.

- [ ] **Step 6: Commit**

```bash
git add css/style.css index.html
git commit -m "Add cut-corner treatment to the 5 primary content panels

.side-block, .tabs, .access-faces-fieldset, .cargo-step-nav,
.cargo-viewer-panel — the panels that hold a primary form/action, per
the design spec's shape-consistency rule. The other 18 border-radius
declarations in the stylesheet are handled separately in Task 3."
```

---

### Task 3: Resolve all remaining border-radius declarations (the other 18)

**Files:**
- Modify: `css/style.css` (18 selectors listed below)

**Interfaces:**
- Consumes: `--input-border` (Task 1)

This task is the direct answer to "the mockups didn't show everything" — a full-file audit found 23 `border-radius` rules; Task 2 covered the 5 designated cut-corner panels, this task resolves every other one so nothing is left in the old rounded style by accident.

- [ ] **Step 1: Flatten header icon/login buttons to sharp corners**

```bash
grep -n "^#theme-toggle,$\|^#login-btn {" css/style.css
```

Change `border-radius: 8px;` to `border-radius: 0;` in both `#theme-toggle, #lang-toggle {}` and `#login-btn {}`.

- [ ] **Step 2: Flatten input-like elements to sharp corners**

Each of these currently has a rounded `border-radius` (6px or 8px) — change every one to `0`:

```bash
grep -n "^input,$\|^#ocr-dropzone {\|^#ocr-preview {\|^\.ocr-raw-text {\|^\.ocr-help-image {\|^\.cargo-field-row {\|^\.company-calibrate-select {" css/style.css
```

This matches: the base `input, select {}` rule, `#ocr-dropzone {}`, `#ocr-preview {}`, `.ocr-raw-text {}`, `.ocr-help-image {}`, `.cargo-field-row {}`, `.company-calibrate-select {}`. Set `border-radius: 0;` in each.

Also, in the base `input, select {}` rule, change `border: 1px solid var(--panel-border);` to `border: 1px solid var(--input-border);` — this is what the new `--input-border` token (Task 1) is for: a slightly different shade than panel borders, applied consistently everywhere an input/dropzone/preview box is bordered. Apply the same `var(--panel-border)` → `var(--input-border)` swap in `#ocr-dropzone`, `.ocr-raw-text`, `.ocr-help-image`, `.cargo-field-row` (all 4 currently border with `var(--panel-border)`).

- [ ] **Step 3: Flatten the `details` disclosure box**

```bash
grep -n "^details {" css/style.css
```

This is the "Quelle capture faire ?" collapsible help box inside the sidebar's "Importer une mission" card (itself a `.side-block`, now cut-corner per Task 2) — nesting another cut-corner inside it would be a box-in-box. Change its `border-radius: 10px;` to `border-radius: 0;` (stays a plain bordered box, no cut).

- [ ] **Step 4: Remove the redundant `.btn-danger` border-radius override**

```bash
grep -n "^\.btn-danger {" -A 10 css/style.css
```

This rule sets its own `border-radius: 6px;`, which (being a class selector) has higher specificity than the base `button {}` rule from Task 3 of the button task below — meaning it would silently keep the OLD rounded corner even after the base button rule is flattened. Delete the `border-radius: 6px;` line from `.btn-danger` entirely so it inherits the base button's radius instead of overriding it.

- [ ] **Step 5: Flatten the two small route/elevator buttons**

```bash
grep -n "^\.btn-elevator-hs {\|^\.route-cargo-btn {" css/style.css
```

Both currently set `border-radius: 5px;` — change both to `border-radius: 0;` (or delete the line so they inherit the base button rule, either is fine since both values will be `0`).

- [ ] **Step 6: Flatten the cargo color swatch**

```bash
grep -n "^\.cargo-color-swatch {" css/style.css
```

Change `border-radius: 3px;` to `border-radius: 0;` (small square swatch, consistent with the sharp/angular system rather than a soft rounded dot).

- [ ] **Step 7: Leave these 3 as deliberate circular/pill exceptions — do NOT change**

- `#user-avatar` (`border-radius: 50%`) — a circular Discord avatar image, always circular regardless of design system, unrelated to the panel/button shape language.
- `.company-lock-btn` (`border-radius: 50%`) — a circular icon toggle (🔓/🔒) in the Réputation tab; a class selector already overrides the base button rule via specificity, so no extra work needed here, just confirm it in Step 9's screenshot.
- `.broken-elevator-chip` (`border-radius: 999px`) — a pill-shaped status chip (route tab, broken-elevator warning), a legitimate distinct shape for a small tag/chip component, not a button or panel.

- [ ] **Step 8: Run the regression suite**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 9: Bump cache-busting and verify visually**

Screenshot: the header (theme/lang/login buttons — sharp corners now), the OCR import panel (dropzone, a pasted preview image, the raw-text box, the help example image — all sharp-cornered, confirm the drop zone still visually reads as a drop target despite losing its rounding), a mission's cargo-item row inputs, the Réputation tab (company cards, the calibration select, the slider + ticks + circular lock button — confirm the lock button is still round, the slider thumb is coral via `accent-color`), and the route-optimization tab's small elevator/cargo buttons and any broken-elevator chip (confirm it's still pill-shaped). Both themes for anything color-sensitive.

- [ ] **Step 10: Commit**

```bash
git add css/style.css
git commit -m "Flatten the remaining 18 border-radius declarations site-wide

Full-file audit found 23 border-radius rules total; Task 2 handled the
5 designated cut-corner panels, this handles the other 18: header
icon/login buttons, all input-like boxes (inputs, OCR dropzone/preview/
raw-text, cargo field rows, the reputation calibration select — now
bordered with the new --input-border token instead of --panel-border),
the details/help disclosure box, small route/elevator buttons, the
cargo color swatch, and a redundant .btn-danger radius override that
would otherwise have silently kept the old rounded corner. Left 3
elements deliberately circular/pill (user avatar, reputation lock
button, broken-elevator chip) since they're distinct icon/chip shapes,
not panels or buttons."
```

---

### Task 4: Button typography (uppercase, body font, sizing)

**Files:**
- Modify: `css/style.css` (base `button` rule)

**Interfaces:**
- Consumes: `--body-font`, `--accent`, `--on-accent`, `--danger` (Task 1); depends on Task 3 having already removed `.btn-danger`'s conflicting radius override

- [ ] **Step 1: Update the base button rule**

```bash
grep -n "^button {" -A 10 css/style.css
```

Currently:
```css
button {
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0.55rem 1rem;
  font-size: 0.9rem;
  font-weight: 600;
  font-family: var(--heading-font);
  letter-spacing: 0.01em;
  transition: transform 0.1s ease, filter 0.15s ease, background-color 0.15s ease, border-color 0.15s ease,
    color 0.15s ease;
}
```

Replace with:

```css
button {
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 0;
  padding: 0.55rem 1.1rem;
  font-size: 0.8rem;
  font-weight: 700;
  font-family: var(--body-font);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  transition: transform 0.1s ease, filter 0.15s ease, background-color 0.15s ease, border-color 0.15s ease,
    color 0.15s ease;
}
```

(This makes Task 3's `border-radius: 0;` on the base rule official — Task 3 must run first since it removed `.btn-danger`'s conflicting override; if Task 3 hasn't run yet, `.btn-danger` will still show a 6px radius here.)

- [ ] **Step 2: Verify no other button rule conflicts**

```bash
grep -n "\.btn-primary {\|\.btn-secondary {\|\.btn-primary-sm {\|\.btn-danger-sm {" css/style.css
```

Read each. None should set `font-family` or `text-transform` — if any do, remove that property so the base rule's values win.

- [ ] **Step 3: Run the regression suite**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 4: Bump cache-busting and verify visually**

Screenshot the "Ajouter la mission"/"Calculer le rangement" primary buttons (solid coral, sharp, uppercase), the Missions enregistrées action row (still equal-width per the existing `min-width:100px` fix), and confirm `.btn-danger` ("Réinitialiser toutes les données") is now sharp-cornered like every other button (proof Task 3's fix worked). Both themes.

- [ ] **Step 5: Commit**

```bash
git add css/style.css
git commit -m "Restyle buttons: uppercase, body font, 700 weight

Base button rule now uses --body-font (Titillium Web) instead of
--heading-font, uppercase with letter-spacing, matching the spec's
button typography row. Confirmed .btn-danger now shares the same sharp
corner as every other button (Task 3 removed its conflicting override)."
```

---

### Task 5: Form label "eyebrow" style

**Files:**
- Modify: `css/style.css` (base `label` rule)

**Interfaces:**
- Consumes: `--muted` (Task 1)

- [ ] **Step 1: Update the base label rule**

```bash
grep -n "^label {" -A 5 css/style.css
```

Currently:
```css
label {
  display: block;
  font-size: 0.85rem;
  color: var(--muted);
  margin-bottom: 0.25rem;
}
```

Replace with:
```css
label {
  display: block;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 600;
  color: var(--muted);
  margin-bottom: 0.35rem;
}
```

- [ ] **Step 2: Run the regression suite**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 3: Bump cache-busting and verify visually**

Screenshot the "Nouvelle mission" form, "Ajouter un lieu personnalisé", "Mon vaisseau" ship-select label, and the custom-capacity label in the sidebar — every label site-wide should now read as small uppercase text. Confirm no label collides visually with the element above it. Both themes.

- [ ] **Step 4: Commit**

```bash
git add css/style.css
git commit -m "Restyle form labels as small uppercase eyebrow text

Single base label rule change (0.68rem, uppercase, letter-spacing
0.1em) cascades to every form field site-wide."
```

---

### Task 6: Table and card row styling (uppercase headers, no zebra striping anywhere)

**Files:**
- Modify: `css/style.css` (`th` rule, `tbody tr:nth-child(even)` rule, `.company-card:nth-child(even)` rule)

**Interfaces:**
- Consumes: `--muted` (Task 1)

- [ ] **Step 1: Update the `th` rule**

```bash
grep -n "^th {" -A 4 css/style.css
```

Currently:
```css
th {
  color: var(--muted);
  font-weight: 600;
}
```

Replace with:
```css
th {
  color: var(--muted);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

- [ ] **Step 2: Remove table zebra-striping**

```bash
grep -n "tbody tr:nth-child(even)" css/style.css
```

Delete the rule:
```css
tbody tr:nth-child(even) {
  background: color-mix(in srgb, var(--panel-border) 18%, transparent);
}
```

- [ ] **Step 3: Remove company-card zebra-striping (same pattern, different selector — missed if you only search for `tbody`)**

```bash
grep -n "\.company-card:nth-child(even)" css/style.css
```

Delete the rule:
```css
.company-card:nth-child(even) {
  background: color-mix(in srgb, var(--panel-border) 18%, transparent);
}
```

- [ ] **Step 4: Run the regression suite**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 5: Bump cache-busting and verify visually**

Screenshot "Missions enregistrées" (create a test mission first if none exist — headers uppercase/muted, no alternating row background), "Historique" (same, with a completed mission), and the "Réputation" tab's company list (no alternating card background either). Both themes.

- [ ] **Step 6: Commit**

```bash
git add css/style.css
git commit -m "Uppercase table headers, remove zebra-striping everywhere

Covers both tbody tr:nth-child(even) (Missions enregistrées,
Historique) and the separate .company-card:nth-child(even) rule
(Réputation tab) — same striping pattern under two different
selectors, both removed per the spec's flat-row rule."
```

---

### Task 7: Recolor the 3D cargo viewer (Three.js)

**Files:**
- Modify: `js/cargo-viewer.js` (4 hardcoded hex color literals)

**Interfaces:**
- Consumes: nothing from CSS (Three.js colors are plain JS hex literals, not linked to CSS custom properties)

- [ ] **Step 1: Replace the wireframe grid color**

```bash
grep -n "0x4dbfdd" js/cargo-viewer.js
```

2 matches (module outline wireframe, ground/boundary grid with `opacity: 0.25`) — replace `0x4dbfdd` with `0xff7a52` (new dark-theme `--accent`) in both, keeping every other property on each line unchanged.

- [ ] **Step 2: Replace the scene background and crate-edge color**

```bash
grep -n "0x12141a" js/cargo-viewer.js
```

2 matches (`scene.background`, solid-crate edge lines) — replace both `0x12141a` with `0x0c0f16` (new dark-theme `--bg`).

- [ ] **Step 3: Leave the lights unchanged**

`THREE.AmbientLight(0xffffff, 0.7)` and `THREE.DirectionalLight(0xffffff, 0.6)` are neutral white lighting, not brand colors — do not change.

- [ ] **Step 4: Run the regression suite**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 5: Bump cache-busting and verify visually**

Bump the `js/cargo-viewer.js` script tag's `?v=`. Create a mission, select a ship, optimize the route, click "Calculer le rangement", screenshot the 3D view: wireframe/outlines should be coral, background near-black `#0c0f16`. (This file doesn't react to the light/dark toggle at all — confirmed no `data-theme`/`prefers-color-scheme` reference in it, a pre-existing characteristic unrelated to this redesign — one screenshot suffices, not one per theme.)

- [ ] **Step 6: Commit**

```bash
git add js/cargo-viewer.js index.html
git commit -m "Recolor the 3D cargo viewer to match the Cockpit HUD palette

Three.js material colors are plain hex literals, not CSS custom
properties, so they need a direct one-time update: wireframe/outlines
from the old cyan (#4dbfdd) to the new accent coral (#ff7a52), scene
background and crate edges from the old near-black (#12141a) to the
new --bg (#0c0f16)."
```

---

### Task 8: Full cross-tab, cross-component visual verification pass

**Files:** none (verification-only; fixes found here land as amendments in the relevant file)

- [ ] **Step 1: Final regression suite run**

```bash
node scripts/cargo-packing-tests.cjs
```
Expected: `34/34 passed`.

- [ ] **Step 2: Screenshot every tab, dark theme**

Using the project's established headless-Edge + Puppeteer approach (launch `msedge.exe --headless=new --disable-gpu --remote-debugging-port=NNNN --user-data-dir=<fresh dir>`, connect via `puppeteer.connect({ browserURL: ... })`, prefer `page.evaluate(() => el.click())` over simulated mouse clicks, always register `page.on("dialog", (d) => d.accept())` — an unhandled location-picker alert silently hangs the session, the root cause behind most automation failures found earlier this session): Nouvelle mission, Missions enregistrées (≥1 row), Optimisation de la route (after optimizing), Optimisation du cargo (after packing, including the 3D viewer), Historique (≥1 completed mission), Réputation (company cards, calibration slider + ticks + lock button).

- [ ] **Step 3: Screenshot every tab, light theme**

Toggle the theme button, repeat Step 2's screenshots.

- [ ] **Step 4: Screenshot the OCR import panel**

Open the "Importer une mission" panel, expand the "Quelle capture faire ?" details disclosure, and (if a sample image is available in the project) paste/drop it to see the dropzone, preview image, and raw-text box all styled consistently.

- [ ] **Step 5: Check for regressions against prior session fixes**

Confirm: the 3 action buttons in Missions enregistrées are still equal width; "Faces accessibles" checkboxes + "Calculer le rangement" still fit one line; the cargo step-nav card still sits beside the 3D viewer and grows independently (not capped/scrolling) for a long crate list; the New Mission Nom/Donneur/Récompense fields still show the 45/45/10 width split; the 3 documented circular/pill exceptions (avatar, lock button, broken-elevator chip) are still round/pill, not sharp.

- [ ] **Step 6: Fix anything found, then final commit**

If Steps 2-5 surface any issue, fix it directly, re-run the regression suite, bump cache-busting, and commit:

```bash
git add -A
git commit -m "Fix visual regressions found in full cross-tab review"
```

If nothing is found, skip this step (no empty commit).
