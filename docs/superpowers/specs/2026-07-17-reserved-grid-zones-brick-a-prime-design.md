# Zones de grille réservées — Brique A′ : clé unique + liste par module

> **Périmètre :** révise le contrat de la **brique A** (déjà livrée) pour lever
> ses deux limitations, jugées gênantes par l'utilisateur :
> 1. réservations indexées par `hold.name` → deux soutes homonymes partagent la
>    réservation ;
> 2. **une seule** empreinte réservée par module → impossible de garer deux
>    véhicules dans la même soute.
>
> A′ change uniquement **l'admission** des réservations dans `simulateRoutePacking`.
> La **barrière dure** (garde d'accès) est inchangée : elle parcourt déjà
> `activeBoxes.some(ab => ab.reserved && …)` et tolère donc plusieurs obstacles
> réservés sans modification. Aucune UI. La brique B consommera ce contrat.

## 1. Le nouveau contrat de données

```js
reservations = {
  [moduleKey(hold, holds)]: [ { x0, y0, sx, sy }, ... ], // 0..N empreintes par module
}
```

- **Clé = `moduleKey(hold, holds)`**, la même identité désambiguïsée que le
  visualiseur : `hold.name`, ou `${hold.name}#${index}` quand plusieurs soutes
  portent le même nom. Deux soutes homonymes ont donc des clés **distinctes** →
  réservations indépendantes.
- **Valeur = une liste** d'empreintes (0, 1 ou plusieurs), chacune
  `{ x0, y0, sx, sy }` en cellules dans le repère packing (axes 0 et 1, hauteur
  = tout l'axe 2), comme en brique A.
- Toujours **optionnel** : absent / `{}` / liste vide → comportement identique à
  aujourd'hui. Les 34 tests d'origine (sans réservation) restent inchangés.

`moduleKey` vit dans `js/cargo-viewer.js` (module ES) et n'est pas accessible
depuis `js/cargo-packing.js`. On **réplique** sa logique (5 lignes) dans
`cargo-packing.js`, calculée à partir du tableau `holds` reçu — les deux côtés
la calculent identiquement (déterministe pour un même `holds`). C'est une
duplication assumée, du même genre que le filtre `syncUexShips`/`fetchShips`
(voir `CLAUDE.md`) : à garder synchronisée si `moduleKey` change un jour.

## 2. Les changements dans `simulateRoutePacking`

Aujourd'hui (brique A), le montage de chaque module résout **une** réservation
(`resolveReservation` → `{x0,y0,sx,sy}` ou `null`), pré-marque ses cellules et
pousse **un** obstacle. A′ généralise à une **liste** :

1. **`resolveModuleKey(hold, holds)`** (nouvelle fonction fichier, réplique de
   `moduleKey`) : renvoie la clé désambiguïsée du hold.
2. **`resolveReservations(reservations, hold, holds, cellDims)`** (remplace
   `resolveReservation`, au pluriel) :
   - lit `reservations[resolveModuleKey(hold, holds)]` ;
   - si absent ou non-tableau → `[]` ;
   - sinon, **valide chaque** entrée avec la même règle qu'avant (entier fini,
     `sx≥1, sy≥1, x0≥0, y0≥0, x0+sx ≤ cellDims[0], y0+sy ≤ cellDims[1]`) et
     **écarte les invalides** ; renvoie la liste des empreintes valides.
3. Au montage du module, **boucler** sur cette liste : pour **chaque** empreinte,
   `markPlaced(module.grid, [x0,y0,0], [sx,sy,cellDims[2]], RESERVED_CELL)` et
   `module.activeBoxes.push({ position:[x0,y0,0], size:[sx,sy,cellDims[2]], dropoffStop: Infinity, reserved: true })`.
   `usedCells` **inchangé** (comme en brique A).
   - **Chevauchement entre empreintes d'un même module** : deux empreintes qui se
     recouvrent partiellement marquent simplement deux fois les mêmes cellules
     (idempotent pour `canPlace`) et poussent deux obstacles ; aucun effet néfaste
     (la garde d'accès est un `some`, un doublon ne change rien). Pas de fusion à
     faire.

**La barrière dure (`findBestPosition` + `tryStackOnExisting`) n'est pas
touchée** : `activeBoxes.some(ab => ab.reserved && isBlockedFromEveryAccessibleFace(…))`
gère nativement plusieurs obstacles réservés.

## 3. Migration des tests de la brique A

Les **34 tests d'origine** (pré-brique-A) n'utilisent pas `reservations` → **aucun
changement**, ils restent la garantie de rétrocompat.

Les **9 tests de la brique A** passent aujourd'hui `reservations = { bay: {x0,…} }`
(objet unique). Ils doivent migrer vers `{ bay: [ {x0,…} ] }` (liste à un
élément). C'est une reshape mécanique de la donnée d'entrée, **pas** un
affaiblissement d'assertion — les invariants vérifiés (exclusion, blocage,
non-empilement, non-conflit, etc.) sont identiques. La clé `bay` reste valide :
`moduleKey` d'un hold unique nommé `"bay"` vaut `"bay"`.

## 4. Nouveaux tests A′

Ajoutés au harnais `scripts/cargo-packing-tests.cjs` :

1. **Deux empreintes dans un même module :** `{ bay: [ boxA, boxB ] }`, disjointes
   → aucune caisse n'occupe ni A ni B ; une caisse se place bien dans l'espace
   restant. Prouve la liste.
2. **Soutes homonymes indépendantes :** deux holds nommés `"bay"` (donc clés
   `"bay"` et `"bay#1"`), réservation sur `"bay#1"` seulement → le hold `"bay"`
   (clé `"bay"`, index 0) n'a **aucune** cellule réservée ; le hold `"bay#1"` a la
   sienne. Prouve la désambiguïsation.
3. **Liste vide / clé absente :** `{ bay: [] }` et `{}` → identiques au rangement
   sans réservation (rétrocompat de la forme liste).
4. **Empreinte invalide dans une liste par ailleurs valide :** `{ bay: [ bad, good ] }`
   → seule `good` est appliquée, `bad` ignorée (pas de plantage).

**Barre verte finale :** `node scripts/cargo-packing-tests.cjs` doit rester à
`(34 + M)` tests, les 34 d'origine inchangés, les 9 de la brique A reshapés, plus
ces 4 nouveaux — le compte exact sera figé au plan.

## 5. Contraintes transverses

- **Aucune dépendance navigateur** (contexte `vm` `{ Object, Math, Array, String }`) :
  la réplique de `moduleKey` n'utilise que `Array.filter/indexOf` et des
  comparaisons de chaînes.
- **Ne pas toucher `assignMissionZones`** (limitation A §5.3, toujours valide).
- **Ne pas toucher la barrière dure** ni le score de sévérité.

## 6. Hors périmètre

- Toute UI (brique B).
- `assignMissionZones` conscient des réservations (brique A″ éventuelle si un cas
  réel de qualité le justifie).
