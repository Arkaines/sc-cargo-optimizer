# Zones de grille réservées — Brique B : l'UI joueur

> **Périmètre :** cette brique construit l'interface qui produit les réservations
> consommées par la **brique A′** (`simulateRoutePacking(..., reservations)` avec
> `reservations = { [moduleKey]: [ {x0,y0,sx,sy}, … ] }` — clé unique par soute,
> liste d'empreintes par soute). Sans la brique B, la brique A′ est inerte.
>
> **Dépendance :** la brique B se construit **sur la brique A′** (voir
> `2026-07-17-reserved-grid-zones-brick-a-prime-design.md`), qui doit être livrée
> avant. A′ lève les deux limitations (soutes homonymes, un seul véhicule par
> soute) — la brique B les exploite : placement libre, plusieurs véhicules,
> plusieurs par soute.

## 1. Motivation et modèle d'interaction

Un joueur gare un véhicule dans une soute et veut que le rangement n'utilise ni
cet emplacement ni ce qu'il rend inaccessible. Modèle validé avec l'utilisateur :

- Le joueur **saisit la taille de son véhicule en cellules** : longueur × largeur
  (ex. 4 × 2). 1 cellule = 1,25 m = 1 SCU. Pleine hauteur (comme la brique A).
- Ça crée une **grille virtuelle** (le véhicule) qu'il **glisse LIBREMENT** dans la
  vue 3D, aimantée sur les cellules — en réutilisant le glisser existant. Pas de
  sélection préalable de soute, pas d'obligation de tenir dans un seul module.
- À la dépose (ou en direct), la grille virtuelle **réserve les cellules qu'elle
  recouvre dans CHAQUE module qu'elle touche** : on calcule l'intersection de son
  empreinte monde avec le rectangle de sol de chaque module, et on en déduit,
  pour chacun, une empreinte en **cellules locales**. Un véhicule à cheval sur
  deux soutes réserve la partie couverte de chacune ; la partie qui déborde dans
  le vide (hors de toute soute) ne réserve rien.
- **Plusieurs empreintes réservées par module** possibles (brique A′) : un
  véhicule couvrant N modules **ajoute** une empreinte à la liste de chacun ;
  deux véhicules dans la même soute ajoutent deux empreintes à sa liste.
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
**liste des véhicules déjà réservés** (chacun avec sa taille et son bouton
**« Effacer »**), et un bouton **« Terminer »**. Rien n'est enregistré tant que
la grille virtuelle n'est pas déposée sur au moins un module. Un placement libre
pouvant couvrir plusieurs soutes, chaque **véhicule** est suivi comme une entité
(un id + ses empreintes par soute) pour qu'« Effacer » le retire entièrement
d'un coup, y compris ses empreintes dans plusieurs soutes.

## 3. Le modèle de données

```js
state.cargoReservations = {
  [shipName]: {
    [moduleKey]: [ { x0, y0, sx, sy, vid }, ... ], // liste, cellules, repère PACKING
  },
}
```

- Indexé par **`moduleKey`** (la clé désambiguïsée du visualiseur, cf. brique A′)
  — **exactement la clé qu'attend la brique A′** (`reservations[moduleKey]`). Deux
  soutes homonymes ont des clés distinctes.
- Valeur = **une liste** d'empreintes (placement libre : plusieurs véhicules, ou
  un véhicule à cheval, peuvent réserver plusieurs zones dans une même soute).
- `x0, y0, sx, sy` : empreinte en cellules dans le repère du packer (axes 0 et 1,
  la hauteur étant implicitement tout l'axe 2).
- `vid` : identifiant du **véhicule** dont provient l'empreinte (un `Date.now()`
  ou un compteur à la création). Il regroupe les empreintes d'un même véhicule à
  travers plusieurs soutes, pour qu'« Effacer » le retire partout d'un coup. La
  brique A′ **ignore** `vid` (son `resolveReservations` ne lit que `x0,y0,sx,sy`),
  donc l'objet stocké est passable **tel quel** au packer, sans le dépouiller.
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

**Résolution dépose → réservations par module** (l'inverse du rendu, par
intersection) :

1. La grille virtuelle est glissée sur le plan du sol (Y=0), aimantée sur
   `UNIT = 1,25 m` — réutiliser exactement la mécanique du glisser existant
   (`onLayoutPointerDown/Move/Up`, `snapToUnit`).
2. À la dépose, obtenir la position monde du coin de la grille virtuelle
   `(vx, vz)` (viewer X, Z) et sa taille `(sx, sy)` cellules — soit le rectangle
   monde `V = [vx, vx + sx·UNIT] × [vz, vz + sy·UNIT]`.
3. Pour **chaque** module de `getResolvedCargoGrid()` (qui expose, par module,
   `name`, `dimensions` **réelles** {x,y,z}, et `position` = worldPos viewer),
   son rectangle de sol viewer est
   `M = [wx, wx + dimensions.x] × [wz, wz + dimensions.y]`
   (dx = dimensions.x le long de viewer-X, dz = dimensions.y le long de viewer-Z ;
   `wx = position.x`, `wz = position.z`).
4. **Intersection** `V ∩ M` sur les deux axes du sol. Si elle est vide, ce module
   n'est pas concerné. Sinon, la convertir en cellules locales du module :
   ```
   ix0 = max(vx, wx) ; ix1 = min(vx + sx·UNIT, wx + dimensions.x)
   x0  = round((ix0 - wx)/UNIT) ; sxLocal = round((ix1 - ix0)/UNIT)
   ```
   idem sur l'axe Z → `y0, syLocal`. Borner `x0, y0 ≥ 0`,
   `x0+sxLocal ≤ cellsX`, `y0+syLocal ≤ cellsY`
   (`cellsX = round(dimensions.x/UNIT)`, `cellsY = round(dimensions.y/UNIT)`).
   Si `sxLocal < 1` ou `syLocal < 1` après arrondi (le véhicule n'effleure
   qu'un liseré), ignorer ce module.
5. **Ajouter** `{ x0, y0, sx: sxLocal, sy: syLocal }` à la liste
   `state.cargoReservations[ship][moduleKey]` (créée si absente) pour chaque
   module intersecté — `moduleKey` calculé via la même fonction que le packer, à
   partir du `holds` du vaisseau. Un placement libre ajoute donc une empreinte à
   chaque soute couverte, sans écraser les précédentes. Le résultat est la forme
   exacte que la brique A′ valide (elle re-borne/re-valide de toute façon).
6. **Aucune intersection avec aucun module** (véhicule lâché dans le vide) :
   rien n'est enregistré, retour visuel léger (la grille virtuelle revient), pas
   d'`alert` bloquante.

**Ce contrat est le plus fragile de la brique** (l'échange Y/Z a déjà causé des
bugs). Sa vérification en Edge headless est **obligatoire** (§9) : poser une
grille virtuelle de taille connue à une position connue sur un vaisseau connu
(Caterpillar), et affirmer que `state.cargoReservations[ship][moduleKey]` contient
l'empreinte `{x0,y0,sx,sy}` attendue dans le repère packer.

## 5. Le contrat de clé : `moduleKey` partagé

Le visualiseur ET le packer (via la réplique de la brique A′) identifient un
module par `moduleKey(hold, holds)` — `hold.name`, ou `${hold.name}#${index}` si
plusieurs soutes portent le même nom. La brique B **stocke** par cette même clé
(elle a `holds` via `getResolvedCargoGrid`/`getShipHolds` pour la calculer), et le
packer la recalcule identiquement à partir du même `holds`. Les deux limitations
de la conception initiale (soutes homonymes partageant une réservation ; un seul
véhicule par soute) sont **levées** par la brique A′ (clés distinctes + liste par
module) — il n'y a plus de compromis à documenter ici.

## 6. Le fil vers le rangement

`runCargoPacking` (`js/app.js`) appelle aujourd'hui
`simulateRoutePacking(entries, holds, steps, getShipAccessFaces(ship.name))`.
Ajouter le 5ᵉ argument :

```js
simulateRoutePacking(entries, holds, steps, getShipAccessFaces(ship.name), getShipReservations(ship.name));
```

C'est le seul point qui rend la brique A′ vivante. La rétrocompat de la brique A′
garantit qu'un vaisseau sans réservation (`{}`) se range comme avant.

## 7. Affichage de la capacité réservée

La capacité d'un vaisseau reste **dérivée de ses dimensions** (invariant, jamais
saisie). Une réservation ne la change pas ; elle rend une partie indisponible
**pour ce joueur**. Afficher, dans le statut du rangement (`#cargo-pack-status`
ou à côté de la capacité), un rappel **« X SCU réservés »** où
`X = Σ (sx · sy · cellsZ)` sur **toutes les empreintes de toutes les listes** du
vaisseau (volume en cellules = SCU, puisque 1 cellule = 1 SCU ; `cellsZ` = hauteur
du module en cellules). Purement informatif ; n'entre pas dans le calcul de
rangement (le packer travaille déjà sur les cellules restantes). Deux empreintes
qui se recouvrent dans une même soute peuvent légèrement surcompter — acceptable
pour un simple rappel.

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

**Prérequis : la brique A′ doit être livrée avant** (contrat `{ [moduleKey]:
[empreintes] }`, clés distinctes + liste par module).

**Tâche 1 — Plomberie (aucune UI).** `state.cargoReservations` (keyé par
`moduleKey`, valeurs = listes) + migration + `getShipReservations(shipName)` +
5ᵉ argument dans `runCargoPacking` + clé de sync `cargoReservations` dans
`CLOUD_SYNCED_KEYS` (`js/cloud.js`). Vérification en Edge headless : poser une
réservation directement dans `state.cargoReservations` (sous la clé `moduleKey`
d'un module de la Caterpillar), lancer le rangement, et affirmer que le résultat
exclut la zone (bout-en-bout avec la brique A′). Livrable testable **sans** écrire
une ligne d'UI.

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
- Réservation à hauteur partielle (la brique A′ est pleine hauteur par décision).
- Rotation de la grille virtuelle : elle a déjà deux champs Longueur/Largeur ;
  échanger les deux valeurs suffit (pas de bouton rotation dédié en v1).
