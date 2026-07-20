# Compaction du rangement : supprimer l'éventail de profondeur inutile

**Date :** 2026-07-20
**Portée :** `js/cargo-packing.js` uniquement
**Origine :** signalement joueur — « y'a juste des espaces vides alors qu'on pourrait coller les caisses »

## Problème

Le rangement laisse des cellules vides entre les caisses là où elles pourraient être collées. Constaté en jeu par le joueur, puis reproduit et mesuré.

## Mesures

Trois scénarios sur une Constellation Andromeda (soute unique de 4×8×3 = 96 cellules), mesurés avant toute modification.

### Cas A — formats mixtes, même arrêt de livraison : correct

64 SCU en caisses de 16 SCU (2 crans de haut) + 32 SCU en caisses de 4 SCU (1 cran).

```
z=0: 1111 1111 1111 1111 1111 1111 1111 1111
z=1: 1111 1111 1111 1111 1111 1111 1111 1111
z=2: 2222 2222 2222 2222 2222 2222 2222 2222
```

**96/96 cellules.** Les caisses basses comblent la couche que les hautes ne peuvent pas atteindre. L'algorithme sait faire.

### Cas B — arrêts de livraison différents : perte réelle mais justifiée

Mêmes caisses, mais le contrat en 4 SCU part un arrêt plus tard.

```
z=0: 11.. 11.. 1111 1111 2211 2211 2222 2222
z=2: .... .... .... .... .... .... 2222 2222
```

**64/96 cellules, 2 caisses non placées.** En cause : `hasValidSupport` interdit qu'une caisse repose sur une caisse partant plus tôt, sinon le support disparaît en cours de trajet.

Le joueur a confirmé qu'en jeu une caisse dont on retire le support **tombe ou se coince**. La règle est donc correcte et **reste inchangée**. Ce cas n'est pas un défaut.

### Cas C — un seul contrat, format uniforme : défaut confirmé

96 SCU entièrement en caisses de 4 SCU (empreinte 2×2, 1 cran de haut), un seul contrat, un seul arrêt de livraison.

```
z=0: 11.. 1111 1111 1111 1111 1111 1111 11..
z=1: 11.. 1111 1111 1111 1111 1111 1111 11..
z=2: 11.. 1111 1111 1111 1111 1111 1111 11..
```

**84/96 cellules, 3 caisses non placées.** Rangement en quinconce : la voie `x=2..3` est décalée d'un cran par rapport à la voie `x=0..1`, ce qui perd 4 cellules par couche. Rien ne le justifie — toutes ces caisses sont identiques, du même contrat, et partent ensemble.

## Cause

`js/cargo-packing.js:937-940` :

```js
const sorted = list.slice().sort((a, b) => a.dropoffStop - b.dropoffStop || a.box.scu - b.box.scu);
sorted.forEach((b, i) => missionBoxRank.set(b, sorted.length > 1 ? i / (sorted.length - 1) : 0));
```

Le rang d'une caisse est son **index** parmi les caisses de son contrat. Ce rang alimente la profondeur idéale (`js/cargo-packing.js:1005-1009`) :

```js
const rankFrac = missionBoxRank.get(b) ?? dropoffFrac;
const idealDepthForZone = (z) => {
  const maxDepthIdx = z.module.cellDims[z.module.depthAxis] - 1;
  return maxDepthIdx > 0 ? rankFrac * maxDepthIdx : 0;
};
```

Le départage `|| a.box.scu - b.box.scu` attribue donc un rang **distinct** à des caisses qui partent pourtant **au même arrêt**. Sur le cas C, 24 caisses reçoivent 24 profondeurs idéales échelonnées de 0 à 7, et chacune est tirée vers sa propre tranche.

`depthDistance` est le critère **n°2** de `isBetterPosition`, au-dessus de tous les critères de compacité (`wallTouches`, `neighborTouches`). L'éventail l'emporte donc systématiquement sur « colle-toi aux autres ».

L'intention d'origine était d'éviter qu'une caisse bloque une autre caisse **du même contrat** partant plus tôt. Cette intention est valable — mais elle ne s'applique qu'entre arrêts de livraison différents. À l'intérieur d'un même arrêt, l'ordre des caisses entre elles n'a aucune importance : elles sortent toutes en même temps.

## Tentative écartée : le rang par groupe de livraison

**Première conception, réfutée par la mesure. Consignée pour qu'on ne la retente pas.**

L'idée était de donner le même rang à toutes les caisses d'un même arrêt (rang du *groupe* et non de la caisse), pour qu'elles cessent d'être départagées en profondeur.

Résultat mesuré : la compaction passait bien à 96/96, mais les conflits sur les données réelles du Raft **passaient de 4 à 12**. L'ordonnancement fin des caisses d'un contrat, loin d'être gratuit, est nécessaire dès que la soute est disputée — le Raft porte 10 contrats pour 8 crans de large, les zones se partagent, et sans ordre interne les caisses d'un même contrat se bloquent entre elles.

Une variante (borner l'étalement à la profondeur réellement occupée par le contrat) a été écartée sans être implémentée : dans le cas C le contrat remplit toute la soute, donc sa profondeur nécessaire *est* la profondeur du module et le bornage ne changerait rien.

## Conception retenue

Le rang par caisse est **conservé tel quel**. Ce qui change est l'**unité de mesure** de l'écart à la profondeur idéale.

`js/cargo-packing.js`, dans `findBestPosition` :

```js
depthDistance:
  idealDepth != null
    ? Math.abs(Math.floor(d / size[depthAxis]) - Math.floor(idealDepth / size[depthAxis]))
    : 0,
```

Au lieu de `Math.abs(d - idealDepth)`.

### Pourquoi

La profondeur idéale avance continûment : rang `i / (n-1)` multiplié par la profondeur du module. Pour 24 caisses dans un module de 8 crans, elle progresse de **0,30 cran par caisse** — alors qu'une caisse de 4 SCU en occupe **2**.

Deux caisses successives visent donc 0,30 et 0,61, et se placent aux profondeurs 0 et 1 : **décalées d'un cran au lieu d'être alignées**. D'où le quinconce.

Mesuré sur le cas C : 3 caisses à chacune des profondeurs 0 à 6, au lieu de 6 caisses aux profondeurs 0, 2, 4 et 6.

En comparant des **rangs de caisse** plutôt que des cellules, toutes les positions d'un même cran deviennent équivalentes pour ce critère, et ce sont les critères de compacité (parois, voisins) qui départagent. L'ordonnancement par date de sortie reste exact d'un cran à l'autre.

### Cas limites

| Situation | Comportement |
|---|---|
| `idealDepth == null` | `depthDistance = 0`, inchangé (branche préexistante). |
| Caisse d'un cran de profondeur | `size[depthAxis] === 1` : la division est neutre, comportement strictement identique à avant. |
| Rotation de la caisse | `size` est l'orientation testée, donc l'unité suit l'encombrement réel de cette orientation précise. |
| `missionBoxRank` | Non modifié. Le rang par caisse et le repli `?? dropoffFrac` restent tels quels. |

## Hors périmètre

Explicitement **non** traités ici :

- `hasValidSupport` — règle confirmée conforme au jeu.
- `decomposeIntoBoxes` — conforme à la règle du jeu : le contrat impose la taille maximum, et la quantité est découpée en glouton décroissant (7 SCU avec un maximum de 4 donne 4+2+1).
- La hiérarchie de `isBetterPosition` — on ne réordonne aucun critère.
- Le cas B et sa perte de capacité — physique du jeu, pas un défaut.

## Suite prévue (chantier distinct)

**P2 — faces d'accès « intérieur gauche / intérieur droit ».** Demandé par le joueur : sur un vaisseau à coursive centrale (Caterpillar), une soute bâbord s'ouvre vers tribord et inversement. La face dépend donc de la **position de chaque soute dans le vaisseau**.

Cette information existe déjà dans les grilles communautaires publiées, mais `js/app.js:3066` la retire :

```js
return published.grid.map((m) => ({ name, dimensions, capacity, maxContainerSize }));  // position perdue
```

P2 corrigerait au passage un défaut structurel mesuré : `depthAxisIndex` choisit la plus longue dimension **de chaque soute** comme direction d'accès, alors que les dimensions FleetYards sont déjà exprimées dans le repère du vaisseau. Sur **18 vaisseaux sur 97**, les soutes d'un même vaisseau n'ont donc pas le même axe d'accès — cocher « arrière » désigne deux directions physiques différentes selon la soute. De plus, **21 soutes** ont leur plus grande dimension sur l'axe vertical, cas où le code lui-même documente que les cases « dessus / dessous » pilotent en réalité une direction horizontale.

P2 fait l'objet de sa propre conception. Il n'est pas couvert par ce document.

## Critères de réussite

| Vérification | Attendu | Mesuré |
|---|---|---|
| Cas C (96 SCU en 4 SCU, 1 contrat) | 96/96 cellules, 0 non placée | **96/96, 0 non placée** |
| Cas B (arrêts différents) | inchangé — la règle de support s'applique toujours | inchangé |
| Raft, 10 contrats réels | pas de hausse des conflits | **4 → 1 conflit**, 0 non placée |
| `scripts/cargo-packing-tests.cjs` | tout vert | **49/49** |
| Suites navigateur | tout vert | **6/6** |
| Non-régression de l'intention d'origine | deux caisses d'un même contrat partant à des arrêts **différents** restent séparées en profondeur | vérifié par test dédié |

Le dernier point est essentiel : c'est la garantie que la correction n'a pas simplement supprimé la protection au lieu de la cibler.

### Un test existant corrigé

`single footprint slot, crossing intervals -> 1 conflict` attendait 1 conflit et le qualifiait d'« inévitable ». Il ne l'est pas : deux caisses dans un couloir de deux crans peuvent toujours être ordonnées par date de sortie, puisque le manifeste complet du trajet est connu d'avance. Cette valeur encodait une limite du placement, pas une contrainte du problème — elle est tombée d'elle-même.

Le test attend désormais 0 conflit **et** vérifie que la caisse partant en premier est bien la plus proche de l'accès. La détection de conflit reste active par ailleurs, comme le prouve le jeu de données réel du Raft qui en signale toujours un.
