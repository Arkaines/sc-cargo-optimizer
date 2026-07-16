# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A French-first (FR/EN) fan tool for Star Citizen: logs cargo-hauling missions, computes the optimal stop order (TSP with pickup→dropoff precedence), and packs mission cargo into the selected ship's real cargo holds. No build step — a static HTML/JS page opened directly in a browser or served as-is. Not affiliated with Cloud Imperium / Roberts Space Industries (see the disclaimer banner in `index.html`).

## Commands

There is no build, lint, or test tooling at the repo root — it's a static site; changes are tested by opening `index.html` in a browser (or serving the directory with any static file server) and exercising the feature by hand.

Docker (for serving a built copy, not for development):
```bash
docker compose up -d --build          # http://<host>:8080, port set in docker-compose.yml
```

`scripts/` contains a standalone Node harness for the OCR pipeline (`scripts/test-ocr.js`), with its own `package.json` (`tesseract.js`, `sharp`). It sandbox-loads `js/ocr.js` and specific pure functions extracted from `js/app.js` via `vm`, since `app.js` touches `document`/`localStorage` at load time and can't be `require`d directly. It reads images from a hardcoded local folder path (`IMAGES_DIR` in the script) — not a portable repeatable test, adjust that path before running.

## Architecture

**Script loading is order-dependent global scope, not modules.** Every script in `index.html` is a classic `<script>` tag sharing one global scope (in load order: `i18n.js` → `data/*.js` → `uex.js`/`scwiki.js`/`fleetyards.js`/`cargo-packing.js`/`ocr.js`/`cloud.js` → `app.js`). The **only** ES module is `js/cargo-viewer.js` (needs `import` for Three.js, loaded via the import map in `index.html` pointing at a jsdelivr CDN build) — it cannot see or be seen by the classic-script globals except through `window`.

**Cache-busting is manual and must be kept in sync.** Every `<script src="...">` and `<link>` in `index.html` carries a `?v=YYYYMMDD-rN` query string. Bump it (all ~23 occurrences) whenever you change any JS/CSS file, not just once per session — browsers aggressively cache the unversioned static files otherwise, and a stale cached script makes a real fix look like it didn't apply.

**State is a single global mutable object persisted to `localStorage`.** `js/app.js` holds `let state = loadState()` (see top of file for the shape: missions, custom locations, distances, synced UEX/SCWiki/FleetYards snapshots, reputation overrides). Every mutation calls `saveState()`, which writes to `localStorage` and, if a user is connected, kicks off cloud sync (`js/cloud.js`, Supabase). `loadState()` runs migration functions (`migrateMission`, `migrateCustomLocation`) on every load to upgrade old saved shapes — when changing a persisted field's shape, add a migration rather than assuming a fresh shape.

**Data layer is baked from external APIs, with alias reconciliation.** `data/*.js` (locations, distances, commodities, companies, ships, reputation ladders) are generated snapshots from UEX Corp and Star Citizen Wiki's public APIs, refreshed via the "Tout synchroniser" button (`js/uex.js`, `js/scwiki.js`). Because the game's French client displays different names than UEX's English catalog, `data/location-aliases.js`, `data/commodity-aliases.js`, and `data/mission-title-aliases.js` map observed FR display strings to the English catalog keys — these are built up incrementally as OCR/manual-entry mismatches are discovered, not derived from a formula.

**Route optimization** (`js/app.js`, "Optimisation" section): exact DP over a location-subset bitmask (Held-Karp style TSP) respecting pickup-before-dropoff precedence per cargo item, falling back to nearest-neighbor + 2-opt once the location count makes the exact DP infeasible. Cargo load at each stop is simulated (pickups/dropoffs in sequence), not just summed, to catch mid-route overloads.

**Cargo packing** (`js/cargo-packing.js`) is the most intricate module and the one most likely to need multi-function reading to modify safely:
- Works in game-native `[x, y, z]` cell coordinates throughout (`cellsFromDimensions`); Z is always the real vertical/gravity axis. `js/cargo-viewer.js` is the only place that swaps Y/Z, purely for Three.js's Y-up rendering — never swap axes inside `cargo-packing.js` itself.
- `SCU_BOX_SIZES` (crate footprint/height per SCU size) is verified against real FleetYards API data, not inferred from a generic formula — check before "correcting" it against an assumed pattern.
- `depthAxisIndex` picks a module's longest cell dimension as its "access direction" (a heuristic — FleetYards exposes no real door/orientation data). `isBlocking`/`isSafePosition`/`worstConflictDropoff` use that axis to decide whether one crate would block access to another, factoring in each crate's actual dropoff time (the full route manifest is known upfront, so this isn't a truly online bin-packing problem).
- `assignMissionZones` reserves each mission (contract) its own floor-plan lane *before* per-box placement runs, sized by SCU need and footprint minimums, so different contracts' cargo doesn't get spatially interleaved in a way that forces moving one mission's crate to reach another's. This only activates when there's structurally enough room to matter — cross-check with real ship data before changing its heuristics, since a plausible-looking improvement can silently regress a specific ship's real numbers.
- `findBestPosition`/`isBetterPosition` picks the best of *all* valid positions via a strict hierarchical (lexicographic) comparison — not an additive weighted score. This is deliberate: an additive score lets compact-looking placements outweigh delivery-order constraints once enough small bonuses stack up. Keep new comparison criteria as additional tiers, not additive terms.
- Box object identity matters: `decomposeIntoBoxes` must return a fresh object per crate (`{ ...size }`), never the shared `SCU_BOX_SIZES` entry — `js/app.js`'s conflict-highlighting logic keys off box object identity, and a shared reference makes one real conflict falsely light up every other crate of the same SCU size.
- Known limitation, not a bug to "fix" reflexively: a single-hold ship with more active contracts than the hold has independent lateral positions cannot geometrically isolate every contract — some residual conflicts are a real physical constraint of the ship's geometry, not an algorithm gap. Verify against the ship's actual `cellDims` before assuming more code will remove them.

**OCR import** (`js/ocr.js`): Tesseract.js runs entirely client-side against crops of the mission-screenshot (top banner + right column, fixed ratios), producing raw text that `parseOcrText` turns into structured fields. Reconciles against the FR/EN alias tables above since the recognized text is whatever language the player's client is in.

**Reputation estimation** (`js/app.js`, "Réputation" section): the game never exposes an exact reputation number, only a tier and an unlabeled progress bar. Two baked catalogs are tried in order — by exact mission title (`data/mission-reputation-by-title.js`, far more reliable but needs the real title, not an OCR-failure placeholder like "Mission N") and by mission giver as a fallback (`data/mission-reputation.js`, coarser since many differing contracts share a giver). When a title/giver has multiple reward-range variants, the one whose range contains (or is closest to) the mission's actual reward is picked (`pickReputationVariant`). Manual calibration (`reputationOverrides` in state) lets a player anchor the estimate to what the game actually shows, with completed missions accumulating on top afterward.
