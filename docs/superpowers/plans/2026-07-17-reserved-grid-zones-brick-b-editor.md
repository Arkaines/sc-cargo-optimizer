# Zones réservées — Brique B, l'éditeur — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au joueur l'UI pour réserver l'emplacement de son véhicule : saisir sa taille (cellules), le glisser librement dans la vue 3D, et à la dépose réserver les cellules qu'il recouvre dans chaque soute touchée — alimentant la plomberie déjà livrée (`state.cargoReservations`, `getShipReservations`, brique A′).

**Architecture :** Le cœur risqué (conversion monde→cellules-de-module, l'échange Y/Z) est isolé en **fonction pure testable** (Tâche 1). La Tâche 2 rend la grille virtuelle glissable et affiche les réservations dans `js/cargo-viewer.js`. La Tâche 3 monte le panneau UI, le mode réservation exclusif des autres modes d'édition, la liste des véhicules + « Effacer », et l'affichage « X SCU réservés ».

**Tech Stack :** JS vanilla ; `js/cargo-viewer.js` est le SEUL module ES (parle aux scripts classiques via `window`). Tests : Edge headless + `puppeteer-core` (le projet n'a pas de framework JS navigateur).

## Global Constraints

- **La plomberie existe déjà** (commit `3cd4c52`) : `state.cargoReservations[ship][moduleKey] = [ {x0,y0,sx,sy,vid} ]`, `getShipReservations(shipName)`, 5ᵉ arg de `simulateRoutePacking`, clé de sync `cargoReservations`. Ne PAS la refaire.
- **Repère (le piège) :** viewer-X = packing-x (axe 0) ; viewer-Z = packing-y (axe 1) ; viewer-Y = packing-z (hauteur, axe 2). `UNIT = 1,25 m`. Les positions de module NE sont PAS alignées sur les cellules (`MODULE_GAP = 1.5`) → la conversion arrondit au plus proche.
- **`moduleKey` doit être LE MÊME** des deux côtés : le packer (brique A′, dans `cargo-packing.js`) et le stockage brique B. On l'expose depuis `getResolvedCargoGrid` (calculé par le visualiseur) plutôt que de le recalculer en 3ᵉ endroit.
- **Placement libre :** un véhicule réserve l'intersection de son empreinte avec CHAQUE module touché (spanning permis) ; hors de toute soute → rien.
- **Jamais publié** : `cargoReservations` est perso, synchronisé, jamais dans `ship_layouts`.
- **Cache-busting manuel** : bump `?v=20260717-rN` (23 occurrences) à chaque changement JS/CSS.
- **i18n : DEUX dictionnaires** dans `js/i18n.js` (FR puis EN) — toute chaîne ajoutée aux deux.
- **Mode exclusif** : le mode réservation coexiste avec « Éditer la disposition » et l'éditeur admin — un seul actif à la fois.
- `node scripts/cargo-packing-tests.cjs` reste à `47/47` (la brique B ne touche PAS `cargo-packing.js`).
- Spec : `docs/superpowers/specs/2026-07-17-reserved-grid-zones-brick-b-design.md`.

## Repères de code (lus, exacts)

- `getResolvedCargoGrid` — `js/cargo-viewer.js:846-854` : renvoie par module `{ name, dimensions:{x,y,z} réelles, capacity, maxContainerSize, position:{x,y,z} = worldPos viewer }`. `lastResolvedLayout` (l.81) porte `l.hold`. `moduleKey(hold, holds)` est défini l.294.
- Glisser : `onLayoutPointerDown` (l.903), `onLayoutPointerMove` (l.936), `onLayoutPointerUp` (l.1021) ; `pickMeshes` peuplé dans `renderCargoViewer3D` (l.~591-603, boîtes invisibles par module en mode édition) ; `snapToUnit` (l.887), `applyLayoutEditingToScene`/`setCargoLayoutEditing` (l.~870-895).
- `window.persistCargoModulePosition` (`js/app.js:1090`), `window.onCargoModulePicked` (`js/app.js:1109`), `getShipReservations` (`js/app.js`, après `getShipAccessFaces` l.1013), `runCargoPacking` (l.2636), `UNIT_M = 1.25` (`js/app.js:8`).
- Contrôles 3D : `.cargo-viewer-controls` dans `index.html` (~l.263) ; panneau admin `#admin-grid-panel` (~l.236) — même zone pour y ajouter le panneau réservation.

---

## Task 1 : Fonction pure de résolution monde → réservations (le cœur à risque)

**Files:**
- Modify: `js/cargo-viewer.js` (`getResolvedCargoGrid`, ~846-854 — exposer `moduleKey`)
- Modify: `js/app.js` (nouvelle fonction pure `resolveVehicleReservations`, près de `getShipReservations`)
- Test: Edge headless (script dans le scratchpad)

**Interfaces:**
- Produces (consommé par Tâche 2) :
  - `getResolvedCargoGrid()` inclut désormais `moduleKey` par module.
  - `resolveVehicleReservations(vx, vz, sxCells, syCells, resolvedGrid)` → `[ { moduleKey, x0, y0, sx, sy }, ... ]`, une entrée par module intersecté (repère packing, cellules locales), `[]` si le véhicule ne touche aucune soute.

- [ ] **Step 1 : Exposer `moduleKey` dans `getResolvedCargoGrid`**

Dans `js/cargo-viewer.js`, remplacer le corps de `getResolvedCargoGrid` (l.846-854) par :

```js
window.getResolvedCargoGrid = function getResolvedCargoGrid() {
  const holds = lastResolvedLayout.map((l) => l.hold);
  return lastResolvedLayout.map((l) => ({
    name: l.hold.name,
    // Clé désambiguïsée IDENTIQUE à celle du packer (brique A′) : indispensable
    // pour que la réservation stockée soit retrouvée module par module.
    moduleKey: moduleKey(l.hold, holds),
    dimensions: { x: l.hold.dimensions.x, y: l.hold.dimensions.y, z: l.hold.dimensions.z },
    capacity: l.hold.capacity,
    maxContainerSize: l.hold.maxContainerSize,
    position: { x: l.worldPos[0], y: l.worldPos[1], z: l.worldPos[2] },
  }));
};
```

- [ ] **Step 2 : Écrire la fonction pure `resolveVehicleReservations`**

Dans `js/app.js`, juste après `getShipReservations`, ajouter :

```js
// Convertit une grille virtuelle (véhicule) posée LIBREMENT dans la vue 3D en
// réservations par module, dans le repère du packer. Le piège est l'échange
// Y/Z du visualiseur (voir renderCargoViewer3D) : le SOL de la vue est le plan
// (viewer-X, viewer-Z) = (packing-x axe 0, packing-y axe 1). On calcule
// l'intersection de l'empreinte monde du véhicule avec le rectangle de sol de
// CHAQUE module, puis on la ramène en cellules locales de ce module. Un module
// n'est pas forcément aligné sur la grille (MODULE_GAP=1.5), d'où l'arrondi.
// vx, vz : coin monde du véhicule sur viewer-X / viewer-Z (mètres).
// sxCells, syCells : taille du véhicule en cellules (axe 0, axe 1).
// resolvedGrid : sortie de getResolvedCargoGrid() (avec moduleKey).
// Retour : [ { moduleKey, x0, y0, sx, sy } ] par module réellement recouvert.
function resolveVehicleReservations(vx, vz, sxCells, syCells, resolvedGrid) {
  const U = UNIT_M;
  const vx1 = vx + sxCells * U;
  const vz1 = vz + syCells * U;
  const out = [];
  (resolvedGrid || []).forEach((m) => {
    const wx = m.position.x;
    const wz = m.position.z;
    const wx1 = wx + m.dimensions.x; // dim.x le long de viewer-X
    const wz1 = wz + m.dimensions.y; // dim.y le long de viewer-Z
    const ix0 = Math.max(vx, wx);
    const ix1 = Math.min(vx1, wx1);
    const iz0 = Math.max(vz, wz);
    const iz1 = Math.min(vz1, wz1);
    if (ix1 - ix0 <= 1e-6 || iz1 - iz0 <= 1e-6) return; // pas d'intersection réelle
    const cellsX = Math.max(1, Math.round(m.dimensions.x / U));
    const cellsY = Math.max(1, Math.round(m.dimensions.y / U));
    let x0 = Math.round((ix0 - wx) / U);
    let y0 = Math.round((iz0 - wz) / U);
    let sx = Math.round((ix1 - ix0) / U);
    let sy = Math.round((iz1 - iz0) / U);
    // Borne dans la grille du module ; un chevauchement < 1 cellule après
    // arrondi (le véhicule n'effleure qu'un liseré) est ignoré.
    x0 = Math.max(0, Math.min(x0, cellsX - 1));
    y0 = Math.max(0, Math.min(y0, cellsY - 1));
    sx = Math.min(Math.max(sx, 0), cellsX - x0);
    sy = Math.min(Math.max(sy, 0), cellsY - y0);
    if (sx < 1 || sy < 1) return;
    out.push({ moduleKey: m.moduleKey, x0, y0, sx, sy });
  });
  return out;
}
```

- [ ] **Step 3 : Vérifier en Edge headless (le contrat de coordonnées §4)**

Depuis le scratchpad (`require("puppeteer-core")` résout). Server `http://localhost:8080` (démarrer `python -m http.server 8080` si absent). Edge headless, profil FRAIS, port dédié, `page.on("dialog", d => d.accept())`, forcer `syncFleetyardsCargoHolds()`. Rendre la Caterpillar une fois pour peupler `getResolvedCargoGrid`, puis dans la page :

```js
// Récupère la grille résolue et vérifie la conversion sur des cas connus.
renderCargoViewer3D(getShipHolds("Caterpillar"), [], 0, false, {});
const grid = getResolvedCargoGrid();
// (a) chaque module expose un moduleKey (== name sur la Caterpillar, noms distincts)
const allKeyed = grid.every((m) => typeof m.moduleKey === "string" && m.moduleKey === m.name);
// (b) un véhicule 1x1 posé pile au coin monde d'un module -> réserve sa cellule (0,0)
const m0 = grid[0];
const r1 = resolveVehicleReservations(m0.position.x, m0.position.z, 1, 1, grid);
// (c) un véhicule couvrant tout m0 -> empreinte = toute la grille de m0
const cx = Math.round(m0.dimensions.x / 1.25), cy = Math.round(m0.dimensions.y / 1.25);
const rFull = resolveVehicleReservations(m0.position.x, m0.position.z, cx, cy, grid);
// (d) un véhicule loin de tout (x=99999) -> aucune réservation
const rNone = resolveVehicleReservations(99999, 99999, 2, 2, grid);
return { allKeyed, r1, rFull, m0key: m0.moduleKey, cx, cy, rNone };
```

Affirmations : `allKeyed === true` ; `r1` = `[{ moduleKey: m0.moduleKey, x0:0, y0:0, sx:1, sy:1 }]` ; `rFull` = `[{ moduleKey: m0.moduleKey, x0:0, y0:0, sx:cx, sy:cy }]` ; `rNone` = `[]`. Reporter les valeurs réelles.

- [ ] **Step 4 : Bump cache-bust + commit**

```bash
sed -i 's/20260717-r46/20260717-r47/g' index.html   # 23 occurrences
node --check js/app.js && node --check js/cargo-viewer.js
git add js/app.js js/cargo-viewer.js index.html
git commit -m "Zones réservées (brique B) : résolution monde->module (fonction pure) + moduleKey exposé"
```

---

## Task 2 : La grille virtuelle glissable + le rendu

**Files:**
- Modify: `js/cargo-viewer.js` (création/pick/glisser de la boîte virtuelle ; rendu de la boîte + des réservations posées)
- Modify: `js/app.js` (mode réservation : `enterReservationEdit`, la dépose appelle `resolveVehicleReservations` + écrit l'état via un helper de la Tâche 3)

**Interfaces:**
- Consumes : `resolveVehicleReservations` (T1), `getResolvedCargoGrid` (T1), le glisser existant (`setCargoLayoutEditing`, `onLayoutPointerDown/Move/Up`, `snapToUnit`).
- Produces (consommé par Tâche 3) :
  - `window.setReservationVehicleSize(sxCells, syCells)` — crée/dimensionne la grille virtuelle et l'ajoute à la scène, glissable sur le sol.
  - `window.onReservationVehicleDropped(vx, vz, sx, sy)` (implémentée côté app.js) — appelée au relâchement avec le coin monde + la taille cellules du véhicule.
  - `window.renderReservationOverlays(resolvedGrid, reservations)` — dessine les réservations posées (boîtes pleine hauteur colorées) dans leurs modules.

**Notes de conception (à respecter, la Tâche est trop intégrée pour du code-tout-fait ligne à ligne ici — l'implémenteur lit le glisser existant et le décalque) :**
- La boîte virtuelle est un `THREE.Mesh` (boîte translucide ambre) pleine hauteur, ajouté à `contentGroup`, avec sa propre entrée dans `pickMeshes` (userData `{ isReservationVehicle: true, dims }`) pour que `onLayoutPointerDown` la sélectionne. En mode réservation, `pickMeshes` ne contient QUE cette boîte (pas les modules).
- Le glisser réutilise `onLayoutPointerMove` (plan du sol Y=0, `snapToUnit` sur les 2 axes horizontaux — la boîte reste au sol). Il faut un branchement : si `dragTarget.userData.isReservationVehicle`, `onLayoutPointerUp` n'appelle PAS `persistCargoModulePosition` mais lit le coin monde `(x, z)` de la boîte + sa taille cellules et appelle `window.onReservationVehicleDropped(x, z, sx, sy)`.
- `renderReservationOverlays` : pour chaque `reservations[moduleKey]` (liste), retrouver le module dans `resolvedGrid` par `moduleKey`, et poser une boîte pleine hauteur à `vx = m.position.x + x0*UNIT`, `vz = m.position.z + y0*UNIT`, taille `sx*UNIT × hauteur × sy*UNIT` (couleur distincte des caisses et de la grille virtuelle en cours). Rendu à chaque entrée en mode réservation et après chaque dépose/effacement.
- Réutiliser la grille de sol + le repère d'axes du mode édition (déjà rendus quand `editingLayout`).

- [ ] **Step 1 : Écrire le script de vérification headless d'abord (drop → état)**

Un script qui : entre en mode réservation, appelle `setReservationVehicleSize(2,2)`, simule un glisser réel de la boîte virtuelle jusqu'au coin d'un module connu (via la projection écran d'un module, cf. `__cargoViewerTestProbe`), relâche, et affirme que `state.cargoReservations.Caterpillar[m.moduleKey]` contient une empreinte 2×2 au bon offset. (Écrire le script complet dans le scratchpad ; il échoue tant que la Tâche 2 n'est pas codée.)

- [ ] **Step 2 : Implémenter la boîte virtuelle + son glisser + le rendu, puis faire passer le script**

Suivre les notes de conception ci-dessus. Vérifier aussi qu'un glisser SANS relâcher sur une soute (dans le vide) n'écrit rien. Reporter les valeurs réelles observées.

- [ ] **Step 3 : Bump cache-bust + commit**

```bash
sed -i 's/20260717-r47/20260717-r48/g' index.html
node --check js/app.js && node --check js/cargo-viewer.js
git add js/cargo-viewer.js js/app.js index.html
git commit -m "Zones réservées (brique B) : grille virtuelle glissable + rendu des réservations"
```

---

## Task 3 : Le panneau, le mode exclusif, la liste + « Effacer », la capacité

**Files:**
- Modify: `index.html` (bouton « Réserver un emplacement » dans `.cargo-viewer-controls` ; panneau `#reservation-panel` près de `#admin-grid-panel`)
- Modify: `js/app.js` (mode réservation exclusif ; helpers d'état `addReservationVehicle`/`removeReservationVehicle` ; liste + « Effacer » ; « X SCU réservés »)
- Modify: `js/i18n.js` (chaînes FR + EN, DEUX dictionnaires)
- Modify: `css/style.css` (panneau réservation, réutiliser `.admin-grid-row`)

**Interfaces:**
- Consumes : `setReservationVehicleSize`, `renderReservationOverlays` (T2), `resolveVehicleReservations` (T1).
- Produces : `enterReservationEdit()`, `exitReservationEdit()`, `onReservationVehicleDropped(vx,vz,sx,sy)`, `addReservationVehicle(shipName, footprints, vid)`, `removeReservationVehicle(shipName, vid)`.

- [ ] **Step 1 : Le bouton + le panneau (HTML)**

Ajouter dans `.cargo-viewer-controls` un bouton `#reservation-edit-btn` (`data-i18n="reserveSpotBtn"`). Ajouter, à côté de `#admin-grid-panel`, un `#reservation-panel` (`display:none`) : champs Longueur/Largeur (`#reservation-len`, `#reservation-wid`, number, min 1, step 1), bouton `#reservation-place-btn` (« Placer »), une liste `#reservation-list`, un bouton `#reservation-close-btn` (« Terminer »). Cache-bust au passage.

- [ ] **Step 2 : Le mode exclusif + les helpers d'état**

`enterReservationEdit()` : ferme les autres modes (garde-fou identique à ce qui existe entre layout-edit et admin), affiche `#reservation-panel`, `setCargoLayoutEditing(true)` (pour le glisser + sol + axes), rend les réservations existantes (`renderReservationOverlays`). `exitReservationEdit()` : inverse, `setCargoLayoutEditing(false)`, `renderCargoStepView()`.
`onReservationVehicleDropped(vx,vz,sx,sy)` : `const fps = resolveVehicleReservations(vx,vz,sx,sy,getResolvedCargoGrid())` ; si `fps.length`, `addReservationVehicle(ship, fps, Date.now())`, `saveState()`, re-render la liste + les overlays ; sinon retour visuel léger.
`addReservationVehicle(ship, footprints, vid)` : pour chaque `{moduleKey,x0,y0,sx,sy}`, pousse `{x0,y0,sx,sy,vid}` dans `state.cargoReservations[ship][moduleKey]` (créant l'objet/liste). `removeReservationVehicle(ship, vid)` : retire de chaque liste toutes les empreintes de ce `vid`, supprime les listes vides.

- [ ] **Step 3 : La liste des véhicules + « Effacer », et « X SCU réservés »**

`renderReservationList()` : regroupe les empreintes de `state.cargoReservations[ship]` par `vid`, une ligne par véhicule (taille + un bouton « Effacer » appelant `removeReservationVehicle` puis re-render + `runCargoPacking` si un rangement est affiché). Le total « X SCU réservés » = Σ `sx·sy·cellsZ` sur toutes les empreintes — l'afficher dans `#cargo-pack-status` ou près de la capacité.

- [ ] **Step 4 : i18n (DEUX dictionnaires)**

Ajouter aux FR **et** EN : `reserveSpotBtn` (« Réserver un emplacement » / « Reserve a spot »), `reservationLen` (« Longueur (cellules) » / …), `reservationWid`, `reservationPlaceBtn` (« Placer » / « Place »), `reservationCloseBtn` (« Terminer » / « Done »), `reservationClearBtn` (« Effacer » / « Remove »), `reservedScu` (« {n} SCU réservés » / « {n} SCU reserved »). Vérifier les DEUX emplacements.

- [ ] **Step 5 : Vérification headless de bout en bout + commit**

Script : entrer en mode réservation, placer un véhicule (glisser réel), vérifier qu'il apparaît dans la liste et en overlay ; lancer un rangement et vérifier « X SCU réservés » ; « Effacer » → la réservation disparaît de l'état et de la liste. Vérifier l'exclusivité : entrer en réservation depuis le mode disposition ferme proprement ce dernier. Puis :

```bash
sed -i 's/20260717-r48/20260717-r49/g' index.html
node --check js/app.js && node --check js/cargo-viewer.js
git add index.html js/app.js js/i18n.js css/style.css
git commit -m "Zones réservées (brique B) : panneau, mode exclusif, liste + Effacer, capacité réservée"
```

---

## Notes de vérification finale (revue de branche)

- **Le contrat de coordonnées (T1) est le point critique** — la revue doit re-vérifier la conversion sur au moins un cas spanning (véhicule à cheval sur deux modules → une empreinte par module).
- **`moduleKey` cohérent** entre `getResolvedCargoGrid` et le packer (même `holds`).
- **Jamais publié** : confirmer qu'aucun chemin n'écrit `cargoReservations` dans `ship_layouts`.
- **Mode exclusif** : réservation / disposition / admin ne peuvent pas être actifs ensemble.
- `47/47` au packing (intouché).
