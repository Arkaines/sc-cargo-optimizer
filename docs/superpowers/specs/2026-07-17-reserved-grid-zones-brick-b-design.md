# Zones de grille réservées — Brique B : l'UI joueur

> **Périmètre :** cette brique construit l'interface qui produit les réservations
> consommées par la **brique A** (déjà livrée : `simulateRoutePacking(..., reservations)`
> exclut en dur les cellules réservées et interdit de placer derrière le véhicule).
> Sans la brique B, la brique A est inerte — rien ne lui envoie de réservation.

## 1. Motivation et modèle d'interaction

Un joueur gare un véhicule dans une soute et veut que le rangement n'utilise ni
cet emplacement ni ce qu'il rend inaccessible. Modèle validé avec l'utilisateur :

- Le joueur **saisit la taille de son véhicule en cellules** : longueur × largeur
  (ex. 4 × 2). 1 cellule = 1,25 m = 1 SCU. Pleine hauteur (comme la brique A).
- Ça crée une **grille virtuelle** (le véhicule) qu'il **glisse** dans la vue 3D,
  aimantée sur les cellules — en réutilisant le glisser existant.
- À la dépose, la grille virtuelle se **rattache au module qu'elle recouvre** ;
  on en déduit son empreinte en **cellules locales** de ce module, stockée comme
  réservation.
- **Une réservation par module**, plusieurs modules possibles (plusieurs
  véhicules sur un gros vaisseau).
- **Propre à chaque joueur**, synchronisé (localStorage + Supabase), **jamais
  publié** : n'affecte que le rangement de ce joueur.

## 2. Entrée : un bouton dédié « Réserver un emplacement »

Un bouton **« Réserver un emplacement »** dans les contrôles de la vue 3D
(`.cargo-viewer-controls`), côté **joueur** (pas admin) — visible dès qu'un
vaisseau est sélectionné et que sa grille est affichée. Il ouvre un **mode
réservation**, distinct du mode « Éditer la disposition » (glisser ses grilles)
et de l'éditeur admin. Un seul de ces modes actif à la fois.

En mode réservation, le panneau affiche : deux champs cellules **Longueur** et
**Largeur**, un bouton **« Placer »** (crée la grille virtuelle à glisser), la
liste des réservations déjà posées avec un bouton **« Effacer »** par soute, et
un bouton **« Terminer »**. Rien n'est enregistré tant que la grille virtuelle
n'est pas déposée sur un module valide.

## 3. Le modèle de données

```js
state.cargoReservations = {
  [shipName]: {
    [hold.name]: { x0, y0, sx, sy }, // cellules, repère PACKING (axes 0 et 1)
  },
}
```

- Indexé par **`hold.name`** — **exactement la clé qu'attend la brique A**
  (`resolveReservation` lit `reservations[hold.name]`). Voir §5 pour le cas des
  soutes homonymes.
- `x0, y0, sx, sy` : empreinte en cellules dans le repère du packer (axes 0 et 1,
  la hauteur étant implicitement tout l'axe 2). C'est la forme exacte que la
  brique A valide et consomme — **aucune conversion à la lecture**.
- Par joueur, dans `state` (persisté `localStorage`), migré au chargement comme
  les autres champs (voir `loadState`/`migrate*` dans `js/app.js`, et
  `DATA_SCHEMA_VERSION`), **jamais** écrit dans `ship_layouts` (table des grilles
  publiées) — c'est une donnée perso, pas une grille officielle.

**Accès :** `getShipReservations(shipName)` (`js/app.js`) renvoie
`state.cargoReservations[shipName] || {}` — l'objet directement passable à
`simulateRoutePacking`.

## 4. Le contrat de coordonnées — LE point à risque

Le visualiseur (`js/cargo-viewer.js`) échange Y/Z pour le rendu Three.js Y-haut.
Vérifié dans `renderCargoViewer3D` (calcul de `layout`/`worldPos`) :

```
viewer X  = packing x   (axe 0)            dx = hold.dimensions.x
viewer Z  = packing y   (axe 1)            dz = hold.dimensions.y
viewer Y  = packing z   (axe 2, hauteur)   dy = hold.dimensions.z
```

Le **sol** de la vue (plan X–Z) correspond donc au **sol** du packer (plan des
axes 0–1). Une empreinte réservée sur les axes packing 0 et 1 s'étend, à l'écran,
le long de **viewer-X** et **viewer-Z**. La hauteur (packing axe 2) est
**viewer-Y**, non éditable (pleine hauteur).

**Résolution dépose → module + cellules locales** (l'inverse du rendu) :

1. La grille virtuelle est glissée sur le plan du sol (Y=0), aimantée sur
   `UNIT = 1,25 m` — réutiliser exactement la mécanique du glisser existant
   (`onLayoutPointerDown/Move/Up`, `snapToUnit`).
2. À la dépose, obtenir la position monde du coin de la grille virtuelle
   `(vx, vz)` (viewer X, Z) et sa taille `(sx, sy)` cellules.
3. Parmi les modules de `getResolvedCargoGrid()` (qui expose, par module,
   `name`, `dimensions` **réelles** {x,y,z}, et `position` = worldPos viewer),
   trouver celui dont le **rectangle de sol** contient entièrement la grille
   virtuelle :
   - rectangle viewer du module = `[wx, wx + dimensions.x] × [wz, wz + dimensions.y]`
     (car dx = dimensions.x le long de viewer-X, dz = dimensions.y le long de
     viewer-Z ; `wx = position.x`, `wz = position.z`) ;
   - la grille virtuelle `[vx, vx + sx·UNIT] × [vz, vz + sy·UNIT]` doit tenir
     dans ce rectangle.
4. Cellules locales : `x0 = round((vx - wx)/UNIT)`, `y0 = round((vz - wz)/UNIT)`.
   Borner `x0, y0 ≥ 0` et `x0+sx ≤ cellsX`, `y0+sy ≤ cellsY`
   (`cellsX = round(dimensions.x/UNIT)`, `cellsY = round(dimensions.y/UNIT)`).
5. **Dépose invalide** (aucune grille ne contient entièrement la virtuelle, ou
   elle est à cheval sur deux modules) : **rien n'est enregistré**, retour visuel
   (la grille virtuelle revient / clignote), pas d'`alert` bloquante.

**Ce contrat est le plus fragile de la brique** (l'échange Y/Z a déjà causé des
bugs). Sa vérification en Edge headless est **obligatoire** (§9) : poser une
grille virtuelle de taille connue à une position connue sur un vaisseau connu
(Caterpillar), et affirmer que `state.cargoReservations` contient l'`{x0,y0,sx,sy}`
attendu dans le repère packer.

## 5. Le contrat de clé : `hold.name` vs `moduleKey`

Le visualiseur identifie un module par `moduleKey(hold, holds)` — qui vaut
`hold.name`, **sauf** si plusieurs soutes portent le même nom, auquel cas il
suffixe `#index`. La brique A, elle, indexe par `hold.name`.

**Décision (v1) :** stocker et résoudre par **`hold.name`**, pour coller
directement à la brique A sans la modifier. **Limitation connue et documentée :**
sur un vaisseau à **soutes homonymes**, une réservation posée dans l'une
s'applique à **toutes** celles du même nom (rendu et rangement compris). C'est
rare (les noms de soutes FleetYards sont presque toujours distincts, ex.
`module_01..04` du Caterpillar). Si un cas réel gêne, une brique A′ fera passer
la brique A **et** B à la clé désambiguïsée `moduleKey` — hors périmètre ici.

Cette limitation est explicitement soumise à validation utilisateur (comme le
§5.3 de la brique A) : arbitrage simplicité-maintenant / exhaustivité-plus-tard.

## 6. Le fil vers le rangement

`runCargoPacking` (`js/app.js`) appelle aujourd'hui
`simulateRoutePacking(entries, holds, steps, getShipAccessFaces(ship.name))`.
Ajouter le 5ᵉ argument :

```js
simulateRoutePacking(entries, holds, steps, getShipAccessFaces(ship.name), getShipReservations(ship.name));
```

C'est le seul point qui rend la brique A vivante. La rétrocompat de la brique A
garantit qu'un vaisseau sans réservation (`{}`) se range comme avant.

## 7. Affichage de la capacité réservée

La capacité d'un vaisseau reste **dérivée de ses dimensions** (invariant, jamais
saisie). Une réservation ne la change pas ; elle rend une partie indisponible
**pour ce joueur**. Afficher, dans le statut du rangement (`#cargo-pack-status`
ou à côté de la capacité), un rappel **« X SCU réservés »** où
`X = Σ (sx · sy · cellsZ)` sur toutes les réservations du vaisseau (volume en
cellules = SCU, puisque 1 cellule = 1 SCU). Purement informatif ; n'entre pas
dans le calcul de rangement (le packer travaille déjà sur les cellules restantes).

## 8. Le rendu de la grille virtuelle et des réservations

Dans `js/cargo-viewer.js`, en mode réservation :

- La **grille virtuelle en cours de placement** : une boîte pleine hauteur
  distincte (couleur dédiée, ex. jaune/ambre translucide), suivant le curseur,
  aimantée sur les cellules — comme un module qu'on glisse, mais c'est le
  véhicule.
- Les **réservations déjà posées** : rendues comme des boîtes pleine hauteur
  colorées à l'intérieur de leur module, à leur empreinte `{x0,y0,sx,sy}`
  convertie en position viewer (l'inverse du §4 : `vx = wx + x0·UNIT`, etc.).
- Réutiliser le repère d'axes / la grille de sol du mode édition tant qu'on
  place (aide au placement).

## 9. Découpage en tâches (logique testable d'abord, comme la brique A)

**Tâche 1 — Plomberie (aucune UI).** `state.cargoReservations` + migration +
`getShipReservations(shipName)` + 5ᵉ argument dans `runCargoPacking` + clé de sync
`cargoReservations` dans `CLOUD_SYNCED_KEYS` (`js/cloud.js`). Vérification en Edge
headless : poser une réservation directement dans `state.cargoReservations`,
lancer le rangement, et affirmer que le résultat exclut la zone (bout-en-bout
avec la brique A). Livrable testable **sans** écrire une ligne d'UI.

**Tâche 2 — L'éditeur.** Le bouton « Réserver un emplacement », le mode, les
champs Longueur/Largeur, la création + le glisser de la grille virtuelle, la
résolution dépose→module (§4), le rendu (§8), la liste + « Effacer », « Terminer ».
Coexistence exclusive avec les autres modes d'édition. Vérification headless du
contrat de coordonnées (§4) sur la Caterpillar.

**Tâche 3 — Affichage capacité.** « X SCU réservés » (§7).

Chaque tâche cache-buste `index.html` (les ~23 occurrences `?v=…`) et garde
`node scripts/cargo-packing-tests.cjs` à `43/43` (la brique B ne touche PAS
`cargo-packing.js`).

## 10. Contraintes transverses

- **Scripts classiques, un seul scope global** ; `js/cargo-viewer.js` est le SEUL
  module ES et ne parle aux autres que via `window` (voir `CLAUDE.md`).
- **Cache-busting manuel** : bump `?v=YYYYMMDD-rN` sur les ~23 occurrences à
  chaque changement JS/CSS.
- **i18n : DEUX dictionnaires** dans `js/i18n.js` (FR puis EN) — toute chaîne
  ajoutée doit l'être aux deux endroits (erreur récurrente du projet).
- **Le glisser existant** est déjà réparé pour naître avec la scène et n'aimante
  que la verticale au sol (voir l'historique récent) — le réutiliser, ne pas le
  réécrire.
- **La sync ne doit jamais publier** `cargoReservations` dans `ship_layouts` :
  c'est une donnée perso, elle passe par le même canal que `cargoViewerLayout`
  (état joueur synchronisé), pas par la publication admin.

## 11. Hors périmètre

- Rendre la brique A consciente des réservations dans `assignMissionZones`
  (limitation A §5.3).
- La clé désambiguïsée `moduleKey` côté packer pour les soutes homonymes
  (limitation §5, brique A′ éventuelle).
- Réservation à hauteur partielle (la brique A est pleine hauteur par décision).
- Plusieurs véhicules **dans un même module** (un par module en v1).
- Rotation de la grille virtuelle : elle a déjà deux champs Longueur/Largeur ;
  échanger les deux valeurs suffit (pas de bouton rotation dédié en v1).
