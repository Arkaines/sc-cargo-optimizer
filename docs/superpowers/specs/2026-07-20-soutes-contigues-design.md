# Grilles contiguës : détecter les blocages d'une grille à l'autre

**Date :** 2026-07-20
**Portée :** `js/cargo-packing.js`, `js/app.js` (`getShipHolds`)
**Origine :** fait de jeu donné par le joueur

## Le fait

Sur des vaisseaux comme l'**Ironclad**, les quatre grilles `front_left`, `front_right`, `rear_left`, `rear_right` ne sont **pas quatre pièces**. C'est **un seul volume continu**, découpé parce qu'une bande d'exactement **1 SCU** les sépare — bande où l'on ne peut rien poser, mais qui n'est **pas une cloison**.

Le joueur précise que **ça dépend du vaisseau** : certains ont de vraies pièces séparées.

## Le défaut

`js/cargo-packing.js`, détection de conflits dans `simulateRoutePacking` :

```js
other.placement.module === m
```

Un blocage n'est cherché qu'**à l'intérieur d'une même grille**. Quand la soute est en réalité continue, l'outil annonce donc « 0 conflit » alors qu'une caisse en bloque physiquement une autre dans la grille voisine. **Le plan a l'air bon et ne fonctionne pas en soute.** C'est le vrai coût, et c'est ce que cette évolution corrige.

En revanche le **remplissage** grille par grille n'est pas un défaut : la bande d'1 SCU est réelle et inutilisable, donc remplir une grille puis la suivante est physiquement correct.

## Pourquoi les positions, et pas les noms

Savoir qu'une caisse en bloque une autre suppose de savoir **où sont les grilles les unes par rapport aux autres**. FleetYards ne fournit **aucune position** pour l'Ironclad — ses neuf soutes n'en ont pas une seule (vérifié).

Deux sources possibles :

| | |
|---|---|
| **Positions réelles** *(retenu)* | L'éditeur admin place déjà les modules et publie la grille. Les positions existent, `getShipHolds` les jette. |
| Convention de nommage | `front_*` devant `rear_*`. Aucune saisie, mais c'est une supposition sur le nommage de CIG, invérifiable et fausse dès qu'un vaisseau nomme autrement. |

Le nommage est écarté : cette famille d'approximation a déjà coûté plusieurs corrections dans la journée.

**Conséquence heureuse : aucune case à cocher n'est nécessaire.** Deux grilles séparées d'au plus 1 SCU *sont* contiguës — ça se calcule. Le « ça dépend du vaisseau » se résout de lui-même, vaisseau par vaisseau, à partir de la disposition réelle.

## Conception

### Découpage en deux incréments

**Incrément 1 — détecter** *(ce document)*
Signaler les blocages entre grilles contiguës. Ne change **pas** le placement : aucun risque de régression sur ce qui a été corrigé aujourd'hui, et le gain est immédiat — le plan cesse de mentir.

**Incrément 2 — éviter** *(plus tard)*
Faire entrer ces blocages dans le score de placement pour les contourner. À concevoir séparément, après avoir mesuré ce que l'incrément 1 révèle sur de vrais chargements.

### Chemin de données

`getShipHolds` (js/app.js) remappe aujourd'hui une grille publiée vers `name / dimensions / capacity / maxContainerSize` et **retire `position`**. Il la conserve désormais.

`position` reste **absente** quand aucune grille n'est publiée : le comportement actuel est alors inchangé, sans régression.

### Contiguïté

Deux modules sont contigus si, dans le repère du vaisseau :
- leur écart sur **un** axe vaut au plus 1 SCU (1 cran), bord à bord ;
- et leurs emprises se **recouvrent** sur les deux autres axes.

Un module sans `position` n'est contigu à rien.

### Détection du blocage

Aujourd'hui les positions sont en cellules **locales au module**. Pour comparer deux modules il faut les ramener en cellules **du vaisseau** :

```
posVaisseau[axe] = posLocale[axe] + round(hold.position[axe] / 1.25)
```

Le test de blocage lui-même (`isBlockedFromEveryAccessibleFace`) est inchangé : il travaille sur des positions et des tailles, peu importe le repère, à condition que les deux caisses soient exprimées dans le même.

**Restriction assumée :** la comparaison n'a lieu qu'entre modules partageant le même `depthAxis`. `depthAxisIndex` déduit l'axe d'accès de la forme de chaque grille, et deux grilles d'une même soute peuvent en obtenir de différents (mesuré : 18 vaisseaux sur 97 ont des grilles aux axes divergents). Comparer des repères incohérents produirait des conflits faux, ce qui est pire que de n'en signaler aucun. Corriger cette incohérence relève du chantier P2.

## Critères de réussite

| Vérification | Attendu |
|---|---|
| Aucune grille publiée | comportement strictement inchangé — les 60 tests de rangement passent sans modification |
| Deux grilles contiguës, une caisse devant une autre | le conflit est signalé, alors qu'il ne l'était pas |
| Deux grilles **non** contiguës (écart > 1 SCU) | aucun conflit inventé |
| Grilles contiguës mais emprises disjointes latéralement | aucun conflit — elles sont côte à côte, pas l'une derrière l'autre |
| Flotte (`07-flotte`) | aucun conflit nouveau sur les 12 gros porteurs, qui n'ont pas de grille publiée |

## Hors périmètre

- Le placement, qui ne change pas (incrément 2).
- L'incohérence des axes par grille (chantier P2).
- Les faces « intérieur gauche/droit », déjà livrées et indépendantes.
