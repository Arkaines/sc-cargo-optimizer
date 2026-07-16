# Faces d'accès du cargo par vaisseau — conception

**Statut : implémenté.** Voir les commits `d406938..0a664ba` (tâches 1 à 4 : primitives de blocage généralisées, câblage dans `simulateRoutePacking`/`findBestPosition`/`worstConflictDropoff`, cases à cocher `state.shipAccessFaces` dans l'UI, boutons de vue caméra dessus/dessous) plus le commit de cette tâche 5 (bump du cache-busting et enregistrement des chiffres de vérification finale, voir Section 4).

## Contexte

`js/cargo-packing.js` décide non seulement où ranger chaque caisse, mais aussi si elle bloque ou est bloquée par une autre — via `isBlocking`, qui suppose un seul point d'accès par module de cargaison : la coordonnée la plus proche de 0 sur l'axe le plus long du module (`depthAxisIndex`). Cette hypothèse est fausse pour au moins un vaisseau réel (le Raft, accessible à la fois par l'arrière et par le dessous), et l'utilisateur confirme que ce n'est pas un cas isolé — plusieurs vaisseaux ont plus d'un point d'accès physique réel.

FleetYards (la seule source de données réelles utilisée par ce projet pour les dimensions de soute) n'expose aucune information de porte, d'ouverture ou d'orientation — vérifié en direct sur l'API (`GET /v1/models/raft`, `cargoHolds` ne contient que `dimensions`, `capacity`, `maxContainerSize`, `limits`, `name`). Construire et maintenir une table par vaisseau sans source fiable serait fragile et long à tenir à jour. La décision (de l'utilisateur) : laisser le joueur configurer lui-même, par des cases à cocher, quelles faces de la grille de cargaison de son vaisseau sont réellement accessibles — il connaît son vaisseau mieux qu'une donnée qu'on pourrait extrapoler.

## 1. Modèle de données et interface

Nouveau dict dans `state`, `shipAccessFaces`, indexé par nom de vaisseau (même motif que `state.reputationOverrides`) :

```js
state.shipAccessFaces = {
  "Raft": { back: true, front: false, left: false, right: false, top: false, bottom: true },
  // vaisseau absent du dict => comportement par défaut (voir plus bas)
};
```

Six cases à cocher (arrière/avant, gauche/droite, dessus/dessous), affichées dans l'onglet "Optimisation" une fois un vaisseau sélectionné, à côté du sélecteur de vaisseau existant. Édition directe de `state.shipAccessFaces[shipName]`, persistée via `saveState()` comme le reste de l'état (et donc synchronisée dans le cloud si le joueur est connecté, comme `reputationOverrides`).

**Comportement par défaut** (vaisseau absent du dict, ou toutes les cases jamais cochées) : `{ back: true }`, toutes les autres à `false` — reproduit exactement l'heuristique actuelle à un seul axe (accès par l'arrière, la coordonnée la plus proche de 0 sur l'axe le plus long). Aucun changement de comportement pour un vaisseau non configuré ; c'est une amélioration en opt-in uniquement.

**Ajout connexe dans le visualiseur 3D** (`js/cargo-viewer.js`) : deux boutons de vue manquants, "dessus" et "dessous", complétant les 4 déjà existants (avant/arrière/gauche/droite, `index.html:226-229`, `js/cargo-viewer.js:357-373`). Même motif exactement : deux nouvelles branches dans `setCargoViewerView` positionnant la caméra le long de l'axe Y-up de Three.js (qui correspond au vrai Z vertical du jeu, voir le swap Y/Z documenté dans `CLAUDE.md`), et deux boutons `data-view="top"`/`"bottom"` avec leurs clés i18n (`viewTopBtn`/`viewBottomBtn`, FR et EN).

## 2. Correspondance entre les faces et les axes de chaque module

Le réglage est par vaisseau, mais chaque module de cargaison calcule déjà ses propres axes indépendamment (`depthAxisIndex` pour la profondeur, `moduleAxes` pour la largeur/hauteur, introduits lors de la réécriture du zonage 3D). Les six étiquettes se traduisent, PAR MODULE, ainsi :

| Étiquette | Axe | Coordonnée |
|---|---|---|
| Arrière | profondeur (`depthAxis`) | proche de 0 (point d'accès déjà modélisé aujourd'hui) |
| Avant | profondeur | proche du fond (`cellDims[depthAxis] - 1`) |
| Dessous | hauteur (`heightAxis`, toujours Z) | 0 |
| Dessus | hauteur | proche du haut |
| Gauche | largeur (`widthAxis`) | 0 |
| Droite | largeur | proche du haut |

Un même choix du joueur ("arrière + dessous") s'applique donc correctement à chaque module même si leurs axes de profondeur/largeur/hauteur ne coïncident pas d'un module à l'autre (cas réel sur les vaisseaux à modules multiples comme le Hull B) — chaque module traduit les mêmes étiquettes vers ses propres coordonnées, sans donnée supplémentaire par module.

## 3. Généralisation de la détection de blocage

C'est le changement d'algorithme, pas seulement d'interface. Aujourd'hui, `isBlocking` ne connaît qu'un seul point d'accès. Avec plusieurs faces cochées, une caisse n'est **vraiment** bloquée que si **toutes** les faces accessibles configurées sont obstruées — s'il existe ne serait-ce qu'une seule face libre, le joueur peut passer par là pour la récupérer.

- Nouvelle fonction généralisée (remplace l'usage direct d'`isBlocking` aux deux endroits qui comptent pour la sécurité, pas pour le placement) : pour chaque face cochée du vaisseau, traduite en `(axe, direction)` via la Section 2, vérifie si cette face offre un chemin dégagé. Le test géométrique se généralise ainsi selon la direction :
  - Direction "proche de 0" (arrière/dessous/gauche) : un bloqueur gêne si `blockerPos[axe] < targetPos[axe]` — exactement le test d'`isBlocking` aujourd'hui.
  - Direction "proche du fond" (avant/dessus/droite) : un bloqueur gêne si `blockerPos[axe] + blockerSize[axe] > targetPos[axe] + targetSize[axe]` — le bloqueur dépasse la caisse cible du côté opposé, donc plus proche de CETTE face-là.
  - Dans les deux cas, le recoupement d'emprise sur les deux autres axes reste requis (inchangé par rapport à `isBlocking`).
  La caisse est bloquée seulement si **aucune** face cochée n'offre de chemin dégagé (échec du test ci-dessus pour chacune).
- Ça touche exactement deux endroits : la vraie boucle de détection de conflit dans `simulateRoutePacking` (le filtre `blockers` lors du traitement des livraisons), et `worstConflictDropoff` (le score utilisé pendant la recherche de position par `findBestPosition`).
- **Ne change PAS** : `depthAxisIndex` pour répartir les caisses selon leur rang de livraison (`missionBoxRank`/`idealDepthForZone`), `isBetterPosition`, ni le zonage par contrat (`assignMissionZones`, tiers 1/2). Ce sont deux problèmes différents — où on POSE une caisse (inchangé) contre si elle est physiquement récupérable une fois posée (ce qui change ici).
- `simulateRoutePacking` reçoit un nouveau paramètre optionnel `accessFaces` (objet `{ back, front, left, right, top, bottom }`, chacun `bool`), par défaut `{ back: true }` si omis — signature élargie mais strictement rétrocompatible ; aucun appel existant (tests inclus) ne change de comportement sans le fournir explicitement.
- Le calibrage vient de `state.shipAccessFaces[shipName]`, lu dans `js/app.js` au moment d'appeler `simulateRoutePacking` (dans `runCargoPacking`).

## 4. Tests et vérification

- Tests unitaires directs sur la nouvelle fonction de blocage généralisée : une seule face cochée doit reproduire exactement le comportement actuel de `isBlocking` (non-régression) ; plusieurs faces cochées où une seule est dégagée ne doit **pas** produire de conflit ; toutes les faces bloquées doit toujours en produire un.
- Les fixtures réelles Hull B/Raft (`scripts/cargo-packing-tests.cjs`) tournent avec la configuration par défaut (`{ back: true }`, comportement inchangé) — donc les chiffres actuels (Hull B 0, Raft 4) restent la référence de non-régression tant que `accessFaces` n'est pas fourni.
- Vérification réelle supplémentaire, une fois le code en place : configurer le Raft avec **arrière + dessous** (exactement la description de l'utilisateur) et re-mesurer sur les 10 vraies missions déjà utilisées comme fixture — démonstration concrète que la fonctionnalité change réellement le résultat, pas juste une case à cocher cosmétique.

**Vérification (tâche 5, 2026-07-16).** Script ponctuel (non committé) rechargeant `raft-real.json` via le même loader que `scripts/cargo-packing-tests.cjs` et appelant `simulateRoutePacking(entries, holds, stepCount)` deux fois : une fois sans 4ᵉ argument (défaut, `{ back: true }` implicite), une fois avec `{ back: true, bottom: true }`. Résultat mesuré : **4 conflits par défaut → 0 conflit avec arrière + dessous**, `unplaced` à 0 dans les deux cas. C'est une amélioration réelle et complète sur cette fixture (pas un cas où les deux réglages tombent à égalité) : les 4 conflits mesurés par défaut sont, dans ce cas précis, résolubles en autorisant l'accès par le dessous du module (`hardpoint_cargo_grid`, `dimensions.z = 2.5` cases côté jeu) — cohérent avec la description réelle du Raft par l'utilisateur (accès arrière ET par le dessous) et avec l'hypothèse de la Section 3 : un bloqueur gênant sur la face arrière peut très bien laisser un chemin dégagé par le dessous une fois cette face prise en compte dans la détection de blocage.

## 5. Portée

- Modifie : `js/cargo-packing.js` (nouvelle fonction de blocage généralisée, nouveau paramètre `accessFaces` sur `simulateRoutePacking`, deux points d'appel changés), `js/app.js` (nouveau state `shipAccessFaces`, UI des cases à cocher, lecture au moment de l'appel à `simulateRoutePacking`), `js/i18n.js` (nouvelles clés FR/EN pour les cases à cocher et les deux nouveaux boutons de vue), `js/cargo-viewer.js` (deux nouvelles branches de vue caméra), `index.html` (nouveaux boutons de vue, nouvelle section de cases à cocher), `css/style.css` (style de la nouvelle section).
- Ne modifie pas : `assignMissionZones`, `isBetterPosition`, `depthAxisIndex`, le zonage par contrat, ni la forme de retour de `simulateRoutePacking` (`{ placements, unplaced, conflicts, peakStepIndex }`, inchangée — seul un nouveau paramètre d'entrée optionnel est ajouté).
