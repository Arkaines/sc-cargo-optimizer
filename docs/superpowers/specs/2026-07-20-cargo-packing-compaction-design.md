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

## Conception

Le rang devient celui du **groupe de livraison**, pas de la caisse individuelle.

```js
boxesByMission.forEach((list) => {
  const stops = [...new Set(list.map((b) => b.dropoffStop))].sort((a, b) => a - b);
  if (stops.length < 2) return;
  list.forEach((b) => missionBoxRank.set(b, stops.indexOf(b.dropoffStop) / (stops.length - 1)));
});
```

Deux conséquences :

1. **Deux arrêts différents donnent toujours deux profondeurs idéales différentes.** La protection d'origine est intégralement conservée.
2. **Deux caisses du même arrêt partagent la même profondeur idéale.** `depthDistance` cesse alors de les départager, et les critères de compacité reprennent la main.

### Contrat à un seul arrêt de livraison

Aucune entrée n'est écrite dans `missionBoxRank`. Le repli déjà présent ligne 1005 s'applique :

```js
const rankFrac = missionBoxRank.get(b) ?? dropoffFrac;
```

avec `dropoffFrac = b.dropoffStop / (stepCount - 1)` (ligne 985), identique pour toutes les caisses concernées. Les contrats livrés tôt restent donc près de l'accès et les tardifs au fond — l'ordonnancement **entre** contrats est préservé — tandis que l'éventail **à l'intérieur** d'un contrat disparaît.

Aucun code appelant n'est modifié : le repli existe déjà.

### Cas limites

| Situation | Comportement |
|---|---|
| Contrat sans `mission.id` | Déjà exclu de `boxesByMission` (ligne 933). Inchangé. |
| Contrat à une seule caisse | `stops.length === 1` → repli `dropoffFrac`. Avant : rang 0. Changement volontaire et cohérent avec le point précédent. |
| Contrat à 2+ arrêts | Rang par groupe. Les caisses d'un même groupe se compactent, les groupes restent séparés. |
| `stepCount <= 1` | `dropoffFrac = 0` (ligne 985, inchangé). Profondeur idéale 0 pour tous. |

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

| Vérification | Attendu |
|---|---|
| Cas C (96 SCU en 4 SCU, 1 contrat) | 84/96 → **96/96 cellules, 0 non placée** |
| Cas A (formats mixtes, même arrêt) | reste à 96/96 |
| Cas B (arrêts différents) | inchangé — la règle de support continue de s'appliquer |
| `scripts/cargo-packing-tests.cjs` | 47/47, sans hausse du nombre de conflits |
| Non-régression de l'intention d'origine | deux caisses d'un même contrat partant à des arrêts **différents** restent séparées en profondeur |

Le dernier point est essentiel : c'est la garantie que la correction n'a pas simplement supprimé la protection au lieu de la cibler.
