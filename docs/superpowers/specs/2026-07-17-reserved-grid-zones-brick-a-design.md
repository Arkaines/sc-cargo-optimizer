# Zones de grille réservées — Brique A : le rangement

> **Périmètre :** cette brique enseigne à `js/cargo-packing.js` à accepter des
> zones réservées et à les exclure du rangement. **Aucune UI.** L'UI qui produit
> ces zones (sélection de grille, boîte en cellules, aperçu 3D, état joueur,
> sync Supabase) est la **brique B**, spécifiée séparément et construite ensuite.

## 1. Motivation

Certains joueurs garent un véhicule dans une soute et veulent que le rangement
n'utilise pas cet emplacement. Souvent ce n'est **pas** une soute entière mais
**une partie d'une grande grille** (décision utilisateur). Il faut donc pouvoir
réserver un **sous-rectangle** d'un module, pas seulement un module complet.

Réserver un module entier est un cas particulier trivial (le rectangle couvre
tout le module) ; l'algorithme ci-dessous le gère sans traitement à part.

## 2. Le modèle : un véhicule garé est un obstacle permanent pleine hauteur

Une zone réservée est modélisée comme un **véhicule** occupant une **empreinte
rectangulaire au sol, sur toute la hauteur du module**. Deux propriétés le
distinguent d'une caisse ordinaire, et ce sont elles qui dictent la conception :

1. **Il ne part jamais.** Une caisse a une date de dépose (`dropoffStop`) après
   laquelle elle libère sa place. Un véhicule garé reste présent pendant **tout**
   le trajet. Une caisse qu'il empêche d'atteindre est donc **définitivement**
   inaccessible, pas seulement jusqu'à un arrêt.
2. **Il est pleine hauteur.** L'empreinte réservée occupe toutes les cellules de
   l'axe vertical (Z, voir `cellsFromDimensions`). Rien ne peut donc être posé
   **au-dessus** : la question de l'empilement sur le véhicule ne se pose pas.

Choisir la pleine hauteur est délibéré (YAGNI) : une réservation à hauteur
partielle rouvrirait toute la logique d'empilement (`canStackOn`,
`hasValidSupport`) pour un gain douteux — on ne pose pas de cargo en équilibre
sur le toit d'un véhicule. La brique B n'exposera donc **pas** de réglage de
hauteur : une zone réservée est toujours pleine hauteur.

## 3. Le contrat de données

`simulateRoutePacking` reçoit un nouveau paramètre `reservations`, dans le même
esprit que `accessFaces` (déjà passé par l'appelant, voir `js/app.js:2636`) :

```
simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces, reservations)
```

`reservations` est un objet indexé par **clé de module** — la même identité que
celle utilisée ailleurs pour désigner un hold (`hold.name`), stable pour un
vaisseau donné :

```js
reservations = {
  [hold.name]: { x0, y0, sx, sy }, // en CELLULES, repère de cargo-packing
}
```

- `x0, y0` : coin de l'empreinte réservée, en cellules, sur les **deux axes
  horizontaux** du module (les axes 0 et 1 de `cellDims` ; l'axe 2 est le
  vertical). Voir §7 pour la correspondance avec ce que voit le joueur.
- `sx, sy` : taille de l'empreinte, en cellules, sur ces deux axes.
- La hauteur est implicite : **tout** l'axe vertical (`cellDims[2]`).
- Au plus **une** zone réservée par module (YAGNI : un joueur ne gare pas deux
  véhicules dans le même module ; la brique B ne propose qu'une boîte par grille).

**Rétrocompatibilité obligatoire.** `reservations` est **optionnel**. Absent
(`undefined`) ou `{}`, `simulateRoutePacking` se comporte exactement comme
aujourd'hui — c'est ce que garantissent les 34 tests existants, qui appellent la
fonction sans ce paramètre et **doivent rester verts sans modification**.

**Validation défensive, côté packer.** Une réservation dont l'empreinte sort du
module, a une taille nulle ou négative, ou des coordonnées non entières, est
**ignorée** (comme si le module n'avait pas de réservation) plutôt que de faire
planter le rangement. La brique B validera aussi à la saisie, mais le packer ne
fait jamais confiance à son entrée.

## 4. L'insertion dans `simulateRoutePacking`

Au montage de chaque module (la `holds.map(...)` en tête de
`simulateRoutePacking`), après `createOccupancyGrid` et avant le rangement :

1. **Résoudre la réservation du module** depuis `reservations[hold.name]`, en la
   validant (§3). Si invalide ou absente : rien à faire pour ce module.
2. **Pré-marquer les cellules réservées** dans la grille d'occupation, sur toute
   la hauteur, avec une valeur sentinelle distincte d'une caisse :
   ```js
   markPlaced(module.grid, [x0, y0, 0], [sx, sy, cellDims[2]], RESERVED)
   ```
   où `RESERVED` est une constante non nulle (donc `canPlace` la rejette comme
   une cellule occupée) et **reconnaissable** — voir le trap §5.1. `canPlace`
   teste seulement `if (grid[x][y][z])` : n'importe quelle valeur non nulle
   protège la cellule. Ne PAS mettre à jour `module.usedCells` : ce compteur suit
   les caisses rangées, pas l'espace physiquement indisponible (voir §6).
3. **Injecter un obstacle permanent** dans `module.activeBoxes`, une entrée de la
   même forme que celles créées au rangement (`{ position, size, dropoffStop,
   ... }`), avec :
   - `position = [x0, y0, 0]`, `size = [sx, sy, cellDims[2]]` ;
   - `dropoffStop = Infinity` — il n'est jamais retiré (aucune étape `step ===
     Infinity`, donc la boucle de livraison ne le touche pas) ;
   - un marqueur `reserved: true` — c'est ce marqueur (pas `dropoffStop`) qui
     identifie l'obstacle pour la barrière dure ci-dessous.

### 4.1 La barrière dure : interdire de placer DERRIÈRE le véhicule

**Décision utilisateur : interdiction dure**, pas un simple score. Le §2.1
(véhicule = obstacle permanent) est appliqué comme un **refus de placement**, au
même niveau que `canPlace` et `hasValidSupport`, et **pas** via le score de
sévérité (`worstConflictDropoff`, qui ne fait que classer des positions
autorisées, sans jamais en interdire une).

Concrètement, une position candidate est **refusée** si l'obstacle réservé du
module la bloque **par toutes les faces accessibles** — exactement le prédicat
`isBlockedFromEveryAccessibleFace` déjà utilisé partout ailleurs, appliqué à
l'obstacle réservé. Aux **deux** endroits où une caisse est effectivement posée :

- **`findBestPosition`** (boucle de balayage, après `canPlace` +
  `hasValidSupport`) : ajouter une garde qui saute (`continue`) toute position
  telle que
  ```js
  activeBoxes.some((ab) => ab.reserved &&
    isBlockedFromEveryAccessibleFace(effectiveFaceAxes, ab.position, ab.size, pos, size))
  ```
  `activeBoxes` et `effectiveFaceAxes` sont déjà des paramètres/locales de
  `findBestPosition` — aucune signature à changer.
- **`tryStackOnExisting`** (empilement direct sur une caisse déjà posée) :
  ajouter la même garde avant `markPlaced`, avec `m.activeBoxes` et `m.faceAxes`.
  En pratique une caisse-base a forcément passé la garde (sinon elle n'aurait pas
  été posée), et un empilement partage son empreinte horizontale, donc il passe
  aussi ; la garde est mise par **cohérence et robustesse**, pas parce qu'un cas
  de fuite est connu.

**Pourquoi une barrière dure et non le score de sévérité.** `worstConflictDropoff`
alimente `severity`, le critère de niveau 1 de `isBetterPosition` : il *classe*
les positions autorisées, il n'en *interdit* aucune. Une caisse sans position
sans-conflit y est quand même posée (au moins mauvais endroit), et un conflit est
signalé à la livraison. C'est le bon modèle pour deux caisses (l'une peut être
déplacée), mais **pas** pour un véhicule (il ne bouge jamais) : la décision
utilisateur est que cet espace, et ce qu'il y a derrière, sont **inutilisables**.
D'où la garde dure. L'obstacle reste néanmoins dans `activeBoxes` : c'est là que
la garde le lit (via `reserved: true`).

**Effet de bord sur le score, vérifié nul.** L'obstacle réservé étant aussi dans
`activeBoxes`, `worstConflictDropoff` l'y rencontre. Mais pour une position
**autorisée** (donc que l'obstacle ne bloque pas — sinon la garde l'a écartée),
`isBlockedFromEveryAccessibleFace(obstacle, position)` est faux, et l'autre
branche exige `position.dropoffStop > obstacle.dropoffStop` c.-à-d.
`> Infinity`, toujours faux. L'obstacle ne modifie donc **jamais** la sévérité
d'une position autorisée : le classement des positions retenues est inchangé.
**Test obligatoire (§8) :** un rangement sans réservation et le même avec une
réservation qui ne bloque personne donnent un résultat identique.

## 5. Les pièges (traps) à traiter explicitement

### 5.1 Ne jamais empiler sur le véhicule, ni s'appuyer dessus

`hasValidSupport` autorise une caisse à reposer sur ce qu'il y a en dessous si
`canStackOn(boxScu, below.scu)` et si la date de dépose du dessous est
compatible. La valeur sentinelle `RESERVED` **n'a pas de `.scu`** : si elle
atteignait ce code, `below.scu` serait `undefined` et `canStackOn` renverrait
n'importe quoi.

En pratique, la pleine hauteur (§2.2) fait qu'**aucune cellule au-dessus d'une
cellule réservée n'existe** (la réservation va jusqu'à `cellDims[2]-1`), donc
`hasValidSupport` ne peut pas prendre une cellule réservée comme support — il n'y
a pas de `pz-1` réservé sous une cellule libre. Le trap est donc neutralisé par
construction. **Test obligatoire** pour verrouiller l'invariant : aucune caisse
ne se pose sur une colonne réservée (§8).

### 5.2 L'obstacle permanent ne doit ni être livré ni être signalé comme conflit

L'entrée `reserved` est présente dans `activeBoxes` dès le montage du module et
**ne doit jamais** en être retirée. Le seul retrait se fait dans la boucle de
livraison, indexée par `dropoffStop === step` ; avec `dropoffStop = Infinity`,
elle n'est jamais sélectionnée. Elle ne doit pas non plus être comptée comme un
« vrai » conflit de livraison à signaler au joueur (elle n'a pas
d'`entry`/mission) : la boucle de conflits itère sur des caisses `b.active`
issues de `boxes`, pas sur `activeBoxes`, donc l'obstacle permanent n'y entre
pas — **à confirmer par lecture** du code au moment de l'implémentation, pas à
supposer. Toute autre itération de `activeBoxes` (il y en a peu : le score de
sévérité `worstConflictDropoff`, et le `splice` de retrait à la livraison) doit
tolérer une entrée sans `.scu` ni `.entry` — à recenser une par une.

### 5.3 `assignMissionZones` suppose un module vide — RISQUE PRINCIPAL

`assignMissionZones` calcule les voies de largeur sur `m.cellDims[widthAxis]`
(largeur **entière** du module) et la capacité d'une voie sur
`cellDims[depthAxis] * cellDims[heightAxis]`, **sans regarder la grille
d'occupation**. Une empreinte réservée réduit la largeur/profondeur réellement
disponible, mais `assignMissionZones` l'ignore : il peut donc attribuer à un
contrat une zone qui **recouvre** les cellules réservées.

**Ce que ça casse — et ce que ça ne casse pas :**

- **Correction : intacte.** Une zone qui recouvre des cellules réservées ne
  permet pas d'y ranger quoi que ce soit : `canPlace` rejette les cellules
  pré-marquées (§4.2) et l'obstacle permanent bloque l'accès (§4.3). Aucune
  caisse ne peut donc physiquement occuper ni être bloquée par la zone réservée.
  **Le rangement reste correct quoi qu'il arrive.**
- **Qualité : dégradée possible.** Le zonage peut sous-estimer l'encombrement et
  proposer un agencement moins bon (un contrat croit avoir une voie qui n'a en
  fait pas la place), aboutissant à des caisses non placées là où un zonage
  informé de la réservation aurait réussi.

**Décision de périmètre pour la brique A :** on garantit la **correction** par
les tests, et on **ne** rend **pas** `assignMissionZones` pleinement conscient
des réservations dans cette brique — c'est une amélioration de qualité séparable,
à mesurer sur des cas réels avant de complexifier le zonage. Le spec le
**documente comme limitation connue** plutôt que de le cacher. Si un cas réel de
la brique B montre une dégradation nette, on ouvrira une brique A′ dédiée.

Cette décision est explicitement soumise à validation utilisateur : c'est un
arbitrage correction-maintenant / qualité-plus-tard, pas un oubli.

## 6. Capacité affichée

La capacité d'un vaisseau reste **dérivée de ses dimensions** (invariant du
projet, jamais saisie). Une réservation ne change pas la capacité du vaisseau ;
elle rend juste une partie indisponible **pour ce joueur**. La brique A n'a rien
à afficher (pas d'UI). Elle ne touche pas `usedCells` pour les cellules
réservées (§4.2). Ce que le joueur voit (« X SCU réservés », capacité utile
réduite) relève de la brique B.

## 7. Repères d'axes : le piège de coordonnées

`cargo-packing.js` travaille en `[x, y, z]` avec **Z vertical** (voir
`cellsFromDimensions` et `CLAUDE.md`). Le visualiseur 3D (`js/cargo-viewer.js`)
échange Y/Z pour le rendu Three.js Y-up. La brique A vit **entièrement dans le
repère de `cargo-packing.js`** : l'empreinte réservée est sur les axes 0 et 1,
la hauteur sur l'axe 2. La correspondance entre ce repère et ce que le joueur
dessine dans la vue 3D est un problème de la **brique B**, qui devra convertir
avec le plus grand soin (c'est exactement le genre d'échange Y/Z qui a déjà causé
des bugs). La brique A n'assume qu'une chose : `x0,y0,sx,sy` sont sur les axes
horizontaux, la hauteur est l'axe 2.

## 8. Tests (harnais Node existant, `scripts/cargo-packing-tests.cjs`)

Le fichier se charge dans un `vm` au contexte minimal (`{ Object, Math, Array,
String }`) : la brique A ne doit introduire **aucune** dépendance navigateur.
Nouveaux cas, tous via `simulateRoutePacking(..., reservations)` :

1. **Rétrocompat :** appel sans le 5ᵉ argument → résultat identique à
   l'existant. (Déjà couvert par les 34 tests ; on vérifie qu'ils passent
   toujours, inchangés.)
2. **Exclusion :** une réservation couvrant des cellules où une caisse se
   plaçait sans réservation → cette caisse ne s'y place plus (soit ailleurs,
   soit non placée), et **aucune** caisse n'occupe une cellule réservée.
3. **Module entier réservé :** empreinte = tout le module → équivaut à retirer
   ce module des holds (aucune caisse dedans).
4. **Barrière dure d'accès (§4.1) :** avec une seule face accessible, une caisse
   qui, faute de mieux, se placerait DERRIÈRE la zone réservée (bloquée par
   toutes les faces) est **refusée** — elle va ailleurs, ou reste non placée ;
   **aucune** caisse ne finit derrière le véhicule. Avec une face accessible d'un
   autre côté (non bloqué), la même caisse **peut** se placer → confirme qu'on
   réutilise bien `isBlockedFromEveryAccessibleFace` sans le court-circuiter.
   Cas jumeau : sévérité inchangée — un rangement avec une réservation qui ne
   bloque personne est identique au même sans réservation (§4.1, effet nul).
5. **Pas d'empilement sur le véhicule (§5.1) :** aucune caisse ne repose sur une
   colonne réservée ; `below.scu === undefined` n'est jamais atteint.
6. **Réservation invalide ignorée (§3) :** empreinte hors module / taille nulle
   / non entière → traitée comme absente, rangement identique à sans réservation.
7. **Capacité inchangée / `usedCells` sain :** le compteur d'occupation ne
   comptabilise pas les cellules réservées.

**Barre verte :** `node scripts/cargo-packing-tests.cjs` doit afficher
`(34 + N)/(34 + N) passed`, les 34 d'origine **inchangés**.

## 9. Hors périmètre (brique B, spec séparé)

- Toute UI : sélection de grille, boîte en cellules, aperçu 3D, surbrillance.
- L'état joueur `state.cargoReservations`, sa migration, sa sync Supabase, le
  fait qu'il n'est **jamais** publié.
- La conversion repère 3D ↔ repère cargo-packing (§7).
- Le fil `getShipReservations(ship.name)` passé à `simulateRoutePacking` depuis
  `js/app.js` (la brique A ajoute le paramètre ; la brique B le remplit).
- L'affichage « X SCU réservés » / capacité utile (§6).
- Rendre `assignMissionZones` conscient des réservations (§5.3, brique A′
  éventuelle).
