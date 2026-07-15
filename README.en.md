<p align="center">
  <img src="assets/logo.png" alt="Arkaine Heinlein" width="120" />
</p>

<h1 align="center">Cargo Route Optimizer — Star Citizen</h1>

<p align="center"><a href="README.md">🇫🇷 Français</a> · 🇬🇧 English</p>

> This is an unofficial Star Citizen fan site, not affiliated with the Cloud Imperium group of companies. All content on this site not created by its host or users belongs to its respective owners. Official site: [robertsspaceindustries.com](https://robertsspaceindustries.com)

Small web tool to log Star Citizen cargo hauling missions and compute the stop order that minimizes distance traveled, accounting for your ship's cargo capacity.

No install, no build: it's a static HTML/JS page, opened directly in the browser.

## Features

- **Multi-commodity missions**: each mission can carry several commodities, each with its own pickup and drop-off location.
- **Route optimization**: exact computation (dynamic programming) for a reasonable number of locations, automatically falling back to a heuristic (nearest neighbor + 2-opt) beyond that.
- **Cargo load tracking**: simulates the ship's actual load throughout the route (pickups/drop-offs), not just the total sum — compared against the selected ship's SCU capacity.
- **Real [UEX Corp](https://uexcorp.space/api/documentation/) data**: locations, distances, commodities, companies and ships, with a "Sync all" button to refresh them. Distances between locations are derived from the game's orbital graph. For locations missing from UEX (small delivery points), the app falls back to the more granular [Star Citizen Wiki](https://api.star-citizen.wiki) dataset.
- **Screenshot import (OCR)**: paste or drop a screenshot of an in-game contract details screen, and the app automatically extracts the title, giver, commodities, quantities, reward and locations (text recognition via [Tesseract.js](https://github.com/naptha/tesseract.js), entirely in the browser). Works with both French and English game clients.
- **Estimated reputation per mission**: every mission (new, saved, or in history) shows the reputation it likely grants, based on a mission/reward catalog sourced from [Star Citizen Wiki](https://api.star-citizen.wiki).
- **Reputation tab**: estimated progress toward the next tier for each hauling company (legal or not), using the game's real thresholds. Since the game never shows the exact reputation number, a manual calibration (tier observed in-game + fine-tune slider, lockable) lets you recalibrate the estimate to match reality; missions completed afterwards keep adding on top automatically.
- **Optional Discord login** with cloud backup (Supabase): get your missions, history and reputation calibrations back on another device. The app remains 100% usable without logging in (data stays local-only in that case).
- **Cargo optimization tab**: packs the commodities from included missions into the selected ship's real cargo holds (dimensions and capacities sourced from [FleetYards.net](https://fleetyards.net/tools/cargo-grids/)), aware of the optimized route: each cargo hold module is split into independent access lanes, so cargo due for an early delivery never ends up trapped behind cargo picked up after it (with a clear warning when that isn't avoidable). Stop-by-stop loading plan, plus an interactive 3D view (mouse-drag rotation, front/rear/left/right preset views) at the route's heaviest load point.
- **Bilingual FR/EN** and **light/dark theme**, with remembered preference.

## Usage

Simply open `index.html` in a browser (Chrome/Edge recommended for text recognition), or use the site online directly. All data (missions, custom locations, distances, preferences) is saved in the browser's local storage. Logging in with Discord is optional: it adds a cloud backup (Supabase) to get your data back on another device, otherwise nothing is sent to a server.

## Walkthrough

### 1. Pick your ship

In the **My Ship** box (left panel), select your ship from the list: its SCU capacity is shown and used as the reference for detecting cargo overloads.

### 2. Add missions

Two ways to do it, in the **New Mission** tab:

- **Manually**: fill in the name, giver, reward, then add one or more commodity rows ("Add a commodity" button), specifying the quantity, pickup location and drop-off location for each.
- **From a screenshot (OCR)**: in the left panel, paste (Ctrl+V) or drop the image of an in-game contract details screenshot. The tool automatically extracts the fields — check them, then click "Use these fields in the form". You can also paste/drop **several screenshots at once**: in that case, a mission is created automatically for each one (a summary shows what was created and what to double-check). A how-to guide with a sample screenshot is available in the import panel.

### 3. Manage saved missions

In the **Saved Missions** tab: check/uncheck missions to include in the route calculation, complete a mission (it moves to History) or delete it. A warning appears past 10 active missions (the game caps simultaneously accepted contracts).

### 4. Optimize the route

In the **Route Optimization** tab, optionally pick a starting location then click "Optimize route". The tool computes the stop order that minimizes total distance, respecting each commodity's pickup → drop-off order, and shows the ship's load at each step. In case of overload, a line shows which mission(s) caused it, with a button to deselect them and recompute right away.

### 5. History and custom locations

The **History** tab lists completed missions (grouped if identical, with a "× N" counter), with the option to restore them. If a location doesn't exist in the list, you can add one manually from the New Mission tab. The "Distances between used locations" menu (bottom of the page) lets you correct a distance by hand if needed.

### 6. Reputation

The **Reputation** tab lists hauling companies (legal and illegal) for which progress is tracked. For each: the estimated tier (computed from your completed mission history), and what's left to reach the next one. Since the game never shows the exact number, you can calibrate manually: pick your actually observed in-game tier from the dropdown, fine-tune with the slider (or click directly on 0/25/50/75/100), then click the lock (🔓 → 🔒) to lock in that position — missions completed afterwards then keep adding on top automatically.

### 7. Discord login and cloud backup

The "Log in with Discord" button (top right) is optional. Once logged in, your data (missions, history, custom locations, distances, reputation calibrations) automatically syncs with your account, so you can get it back on another device. Without logging in, everything stays local in the browser as before.

### 8. Syncing, language and theme

The "Sync all" button (left panel) updates locations, distances, commodities, companies and ships from UEX Corp. The buttons at the top of the header let you switch between French/English and light/dark theme; preferences are remembered.

## Docker Deployment

```bash
docker compose up -d --build
```

The tool is then reachable at `http://<server-address>:8080`. The exposed port can be changed in `docker-compose.yml`.

Without docker compose:

```bash
docker build -t sc-cargo-optimizer .
docker run -d -p 8080:80 --name sc-cargo-optimizer sc-cargo-optimizer
```

## Project structure

| Location | Role |
|---|---|
| `index.html` | Main page |
| `css/style.css` | Interface |
| `assets/` | Logo and favicon |
| `js/app.js` | Main logic (state, route optimization, reputation, rendering) |
| `js/i18n.js` | FR/EN translations |
| `js/ocr.js` | Field extraction from Tesseract-recognized text (title, giver, commodities, locations, reward) |
| `js/uex.js` | UEX Corp API calls |
| `js/scwiki.js` | Star Citizen Wiki community API calls |
| `js/fleetyards.js` | FleetYards.net public API calls (per-ship cargo hold dimensions/capacities) |
| `js/cargo-packing.js` | Decomposes commodities into standard boxes and computes their placement in the ship's holds (no overlap) |
| `js/cargo-viewer.js` | Interactive 3D view (Three.js) of the computed placement |
| `js/cloud.js` | Optional Discord login and cloud sync (Supabase) |
| `data/locations.js`, `data/distances.js`, `data/commodities.js`, `data/companies.js`, `data/ships.js` | Default data, generated from UEX Corp (refreshable via "Sync all") |
| `data/location-aliases.js`, `data/commodity-aliases.js` | Aliases for locations/commodities whose in-game displayed name (French client) differs from the UEX name (English), built up as discrepancies are found |
| `data/mission-title-aliases.js` | Translation templates for "generic" mission titles from the French client, rebuilt from the giver to recover the English catalog title |
| `data/scwiki-locations.js` | Fallback locations from the Star Citizen Wiki API, used when a location doesn't exist in UEX (minor outposts/delivery points) |
| `data/location-planets.js` | Local UEX ↔ Star Citizen Wiki cross-reference (planet/moon of each UEX location), used to estimate a distance when UEX doesn't know it (e.g. unresolved orbit) |
| `data/mission-reputation.js`, `data/mission-reputation-by-title.js` | Reputation/reward catalog per mission (by exact title, more reliable, with fallback by giver), sourced from the Star Citizen Wiki API |
| `data/faction-reputation-ladders.js` | Reputation tiers (rank + threshold) per company, sourced from the Star Citizen Wiki API |

## Data sources

Game data (locations, distances, commodities, companies, ships) comes from the public [UEX Corp](https://uexcorp.space/) API. Mission and reputation data (catalog by title/giver, per-company tiers) comes from the community [Star Citizen Wiki](https://api.star-citizen.wiki) API, which also serves as a fallback for locations missing from UEX. Cargo hold dimensions and capacities (Cargo optimization tab) come from the public [FleetYards.net](https://fleetyards.net/tools/cargo-grids/) API.

The displayed reputation remains an **estimate**: the game never exposes the exact number, only a tier and a valueless progress bar — hence the option to manually calibrate the Reputation tab.

The optional cloud backup (Discord login) is hosted on [Supabase](https://supabase.com/) (database + authentication), with access strictly limited to the logged-in account's own data (row-level security/RLS).

The "Made By The Community" logo comes from the [official Roberts Space Industries Fan Kit](https://robertsspaceindustries.com/fankit), used in accordance with the [Star Citizen Fankit and Fandom FAQ](https://support.robertsspaceindustries.com/hc/en-us/articles/360006895793-Star-Citizen-Fankit-and-Fandom-FAQ).

## License

Code under the [MIT](LICENSE) license. Star Citizen, Roberts Space Industries and other mentioned trademarks belong to their respective owners — see the non-affiliation banner at the top of the site.
