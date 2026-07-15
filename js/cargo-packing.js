"use strict";

// =========================================================================
// Rangement des marchandises dans les soutes de cargo réelles du vaisseau
// (données FleetYards.net, voir js/fleetyards.js). Le placement n'est pas
// une recherche du premier emplacement libre : pour CHAQUE caisse, toutes
// les positions valides sont énumérées puis notées par une fonction de
// score unique (voir scorePosition/findBestPosition) et seule la meilleure
// est retenue — la recherche géométrique décide QUOI est possible, le score
// décide LAQUELLE est la meilleure.
// =========================================================================

// Un cran de grille = 1,25 m = 1 SCU (confirmé par l'API FleetYards : la
// caisse 1 SCU fait exactement 1,25×1,25×1,25 m — toutes les autres tailles
// standard sont des multiples entiers de cette unité sur chaque axe).
const SCU_UNIT_METERS = 1.25;

// Tailles de caisses standard du jeu, du plus grand au plus petit, en crans
// de grille. Une caisse ne repose jamais que sur une seule face possible (le
// jeu ne permet pas de la coucher sur le flanc) : "footprint" est son
// empreinte au sol (les deux dimensions posées à plat, interchangeables par
// rotation à plat de 90°) et "height" sa hauteur réelle fixe. Dimensions
// réelles vérifiées directement via l'API FleetYards (champ
// maxContainerSize.dimensions/limits de plusieurs vaisseaux, ex. 4 SCU =
// 2,5×2,5×1,25 m sur le 300i, PAS 1,25×2,5×2,5 — une caisse de 4 SCU est
// large et basse, pas haute et étroite). Gardées telles quelles malgré une
// table générique différente suggérée entre-temps (ex. "8 SCU = 2×4") : ces
// dimensions-ci sont vérifiées contre la donnée réelle du jeu, pas devinées.
const SCU_BOX_SIZES = [
  { scu: 32, footprint: [2, 8], height: 2 },
  { scu: 24, footprint: [2, 6], height: 2 },
  { scu: 16, footprint: [2, 4], height: 2 },
  { scu: 8, footprint: [2, 2], height: 2 },
  { scu: 4, footprint: [2, 2], height: 1 },
  { scu: 2, footprint: [1, 2], height: 1 },
  { scu: 1, footprint: [1, 1], height: 1 },
];

// Décompose une quantité en un nombre minimal de caisses standard (glouton :
// la plus grande caisse qui passe encore, répétée) — pas forcément la
// combinaison réellement disponible en jeu (le stock exact n'est pas connu),
// mais une hypothèse raisonnable pour estimer le rangement. Ne propose
// jamais une caisse plus grande que maxBoxScu (le plus grand format que le
// vaisseau accepte, tous modules confondus) : sans ça, une quantité comme 32
// SCU sur un vaisseau qui ne prend que du 24 SCU max resterait bloquée en
// une seule caisse invplaçable au lieu d'être scindée en caisses plus
// petites qui, elles, rentrent.
function decomposeIntoBoxes(quantity, maxBoxScu) {
  const cap = maxBoxScu || 32;
  let remaining = Math.round(quantity);
  const boxes = [];
  for (const size of SCU_BOX_SIZES) {
    if (size.scu > cap) continue;
    while (remaining >= size.scu) {
      // Copie propre à chaque caisse : SCU_BOX_SIZES est une table de tailles
      // partagée, pas des instances de caisses. Pousser la même référence
      // partagée pour toutes les caisses d'une taille donnée les rendrait
      // indiscernables pour tout code qui identifie une caisse par référence
      // d'objet (ex. js/app.js:renderCargoStepView, qui associe un conflit à
      // "la" caisse via une Map/Set) — un conflit sur UNE caisse de 2 SCU
      // apparaîtrait alors à tort sur TOUTES les autres caisses de 2 SCU du
      // trajet, quelle que soit leur mission ou leur position réelle.
      boxes.push({ ...size });
      remaining -= size.scu;
    }
  }
  if (remaining > 0) boxes.push({ scu: remaining, footprint: [1, 1], height: 1 });
  return boxes;
}

function cellsFromDimensions(dimensions) {
  return [
    Math.round(dimensions.x / SCU_UNIT_METERS),
    Math.round(dimensions.y / SCU_UNIT_METERS),
    Math.round(dimensions.z / SCU_UNIT_METERS),
  ];
}

// Chaque cellule vaut null (libre) ou un objet { dropoffStop, scu }
// identifiant la caisse qui l'occupe (scu sert à la règle d'empilement, voir
// hasValidSupport) — jamais de recouvrement, une caisse repose au sol ou sur
// une autre déjà posée (jamais dans le vide).
function createOccupancyGrid(cellDims) {
  const [dx, dy, dz] = cellDims;
  const grid = [];
  for (let x = 0; x < dx; x++) {
    grid.push([]);
    for (let y = 0; y < dy; y++) {
      grid[x].push(new Array(dz).fill(null));
    }
  }
  return grid;
}

function canPlace(grid, cellDims, pos, size) {
  const [dx, dy, dz] = cellDims;
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  if (px + sx > dx || py + sy > dy || pz + sz > dz) return false;
  for (let x = px; x < px + sx; x++) {
    for (let y = py; y < py + sy; y++) {
      for (let z = pz; z < pz + sz; z++) {
        if (grid[x][y][z]) return false;
      }
    }
  }
  return true;
}

// Règle d'empilement : une caisse ne peut reposer sur une autre que si sa
// taille est STRICTEMENT plus petite que celle de la caisse du dessous (ex.
// une caisse de 4 SCU crée une surface sur laquelle seules des caisses de 1
// ou 2 SCU peuvent être empilées, jamais 4 SCU ou plus) — spécifique au jeu,
// pas une simple histoire de tenir géométriquement dans l'empreinte.
function canStackOn(newScu, baseScu) {
  return newScu < baseScu;
}

// Une caisse ne peut jamais flotter : elle doit reposer au sol (z=0) ou avoir
// toute son empreinte directement soutenue par d'autres caisses juste en
// dessous (contact complet, pas de trou, ET chacune de taille strictement
// supérieure — voir canStackOn) — sans cette vérification, une caisse de 4
// SCU pourrait par exemple se retrouver posée pour moitié sur une caisse de
// 2 SCU et pour moitié dans le vide, ou empilée sur une caisse trop petite
// pour la porter, ce que le jeu ne permet pas. z (index 2) est toujours
// l'axe vertical réel (voir cellsFromDimensions), indépendamment de l'axe
// d'accès choisi pour ce module (depthAxis).
function hasValidSupport(grid, pos, size, boxScu) {
  const [px, py, pz] = pos;
  const [sx, sy] = size;
  if (pz === 0) return true;
  for (let x = px; x < px + sx; x++) {
    for (let y = py; y < py + sy; y++) {
      const below = grid[x][y][pz - 1];
      if (!below || !canStackOn(boxScu, below.scu)) return false;
    }
  }
  return true;
}

// value = { dropoffStop, scu } pour occuper (récupération), null pour
// libérer (livraison, voir simulateRoutePacking) — la place libérée par une
// livraison redevient disponible pour une récupération plus tardive du même
// trajet.
function markPlaced(grid, pos, size, value) {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  for (let x = px; x < px + sx; x++) {
    for (let y = py; y < py + sy; y++) {
      for (let z = pz; z < pz + sz; z++) {
        grid[x][y][z] = value;
      }
    }
  }
}

// Une caisse ne peut tourner qu'à plat, autour de son axe vertical réel — le
// jeu ne permet pas de la coucher sur une autre face (une caisse de 4 SCU
// couchée pour "faire tenir" une orientation différente n'existe pas en
// jeu). Sa hauteur reste donc toujours sur l'axe vertical (Z, voir
// cellsFromDimensions) ; seules les deux dimensions posées au sol peuvent
// s'échanger par une rotation à plat de 90°.
function boxOrientations(box) {
  const [a, b] = box.footprint;
  const h = box.height;
  return [
    [a, b, h],
    [b, a, h],
  ];
}

// Ajuste l'occupation de chaque plan de profondeur couvert par une caisse
// (une caisse peut s'étendre sur plusieurs plans si sa dimension sur cet
// axe dépasse 1 cran) — delta positif à la pose, négatif au retrait. Sert de
// terme secondaire de la fonction de score (voir scorePosition) pour se
// répartir sur toute la longueur du module plutôt que de se tasser dans un
// coin, à égalité des autres critères.
function bumpLayerUsage(layerUsage, depthAxis, pos, size, delta) {
  const start = pos[depthAxis];
  const span = size[depthAxis];
  const footprintArea = (size[0] * size[1] * size[2]) / span;
  for (let d = start; d < start + span; d++) {
    layerUsage.set(d, (layerUsage.get(d) || 0) + delta * footprintArea);
  }
}

// Choisit l'axe le plus long d'un module comme axe de profondeur (accès
// depuis une extrémité, coordonnée 0 = côté accès) : hypothèse raisonnable en
// l'absence de donnée réelle de porte/orientation (même limite déjà assumée
// pour le rendu 3D, voir js/cargo-viewer.js) — sert uniquement à juger si une
// caisse en bloque une autre (voir isBlocking), pas à contraindre le
// placement lui-même.
function depthAxisIndex(cellDims) {
  let best = 0;
  for (let i = 1; i < 3; i++) if (cellDims[i] > cellDims[best]) best = i;
  return best;
}

// Une caisse bloque l'accès à une autre si elle est plus proche de l'accès
// du module (coordonnée plus petite sur l'axe de profondeur) ET que son
// emprise recoupe celle de l'autre sur les deux axes restants — il faudrait
// alors la déplacer temporairement pour atteindre celle qu'on veut sortir.
function isBlocking(depthAxis, blockerPos, blockerSize, targetPos, targetSize) {
  if (blockerPos[depthAxis] >= targetPos[depthAxis]) return false;
  for (let axis = 0; axis < 3; axis++) {
    if (axis === depthAxis) continue;
    const aStart = blockerPos[axis];
    const aEnd = aStart + blockerSize[axis];
    const bStart = targetPos[axis];
    const bEnd = bStart + targetSize[axis];
    if (aEnd <= bStart || bEnd <= aStart) return false;
  }
  return true;
}

// Gravité d'un conflit potentiel pour une position donnée : la date de
// livraison la plus proche parmi les caisses avec lesquelles ça coincerait
// (dans un sens ou dans l'autre) — Infinity si aucun conflit. Utilisé par la
// fonction de score (voir scorePosition) pour transformer un blocage
// potentiel en pénalité : plus le conflit arrive tôt (livraison proche), plus
// il coûte cher, pour toujours préférer déplacer un blocage lointain plutôt
// qu'un blocage imminent quand aucune position n'est totalement sûre.
function worstConflictDropoff(depthAxis, activeBoxes, pos, size, dropoffStop) {
  let worst = Infinity;
  for (const other of activeBoxes) {
    if (isBlocking(depthAxis, other.position, other.size, pos, size) && other.dropoffStop < dropoffStop) {
      worst = Math.min(worst, other.dropoffStop);
    }
    if (isBlocking(depthAxis, pos, size, other.position, other.size) && dropoffStop < other.dropoffStop) {
      worst = Math.min(worst, dropoffStop);
    }
  }
  return worst;
}

// Compte les faces de la caisse en contact avec une paroi du module (bord de
// la grille sur un axe) — favorise les caisses collées aux parois plutôt que
// posées en plein milieu d'un espace ouvert, plus stables et qui laissent de
// plus grands espaces libres continus ailleurs.
function countWallTouches(cellDims, pos, size) {
  let touches = 0;
  for (let axis = 0; axis < 3; axis++) {
    if (pos[axis] === 0) touches++;
    if (pos[axis] + size[axis] === cellDims[axis]) touches++;
  }
  return touches;
}

// Compte les faces de la caisse en contact avec une autre caisse déjà posée
// (pas avec une paroi, déjà comptée par countWallTouches) — favorise les
// caisses collées les unes aux autres, qui tassent le chargement plutôt que
// de fragmenter l'espace libre en petites poches inutilisables. Si
// missionId est fourni, ne compte QUE les caisses du MÊME contrat (voir
// isBetterPosition, niveau 2 : regrouper un contrat avant d'optimiser la
// compacité générale) ; sinon compte toute caisse, quel que soit son contrat.
function countNeighborTouches(grid, cellDims, pos, size, missionId) {
  let touches = 0;
  for (let axis = 0; axis < 3; axis++) {
    const otherAxes = [0, 1, 2].filter((a) => a !== axis);
    const [oa, ob] = otherAxes;
    [pos[axis] - 1, pos[axis] + size[axis]].forEach((coord) => {
      if (coord < 0 || coord >= cellDims[axis]) return; // paroi, déjà comptée ailleurs
      for (let u = pos[oa]; u < pos[oa] + size[oa]; u++) {
        for (let v = pos[ob]; v < pos[ob] + size[ob]; v++) {
          const c = [0, 0, 0];
          c[axis] = coord;
          c[oa] = u;
          c[ob] = v;
          const occupant = grid[c[0]][c[1]][c[2]];
          if (!occupant) continue;
          if (missionId === undefined || occupant.missionId === missionId) touches++;
        }
      }
    });
  }
  return touches;
}

// Compare deux positions valides et renvoie true si `a` est strictement
// meilleure que `b` — HIÉRARCHIQUE, pas additif : chaque critère ne
// départage qu'à égalité stricte du (des) critère(s) plus prioritaire(s),
// jamais compensé par une accumulation de petits bonus de niveau inférieur.
// Un score additif (somme pondérée) laisse toujours une combinaison de
// bonus spatiaux mineurs l'emporter sur un critère de livraison si les poids
// ne sont pas parfaitement calibrés (mesuré : un scénario adversarial est
// passé de 21 à 36 conflits en introduisant un score additif) — la
// hiérarchie stricte élimine ce risque par construction. Ordre de priorité :
//  1. Sécurité : une position totalement sûre (severity=Infinity) bat
//     TOUJOURS une position en conflit ; entre deux conflits, celui qui
//     bloque une livraison plus tardive est le moins grave (voir
//     worstConflictDropoff).
//  2. Ordre de livraison : la profondeur la plus proche de l'idéal d'après
//     la date de livraison de cette caisse (part tôt = près de l'accès, part
//     tard = peut aller au fond) — la contrainte de livraison prime sur
//     toute optimisation spatiale.
//  3. Sol avant empilé (comme l'ancienne recherche en deux passes).
//  4. Organisation logistique : contact avec d'autres caisses du MÊME
//     contrat (voir countNeighborTouches) — regrouper un contrat prime sur
//     la compacité générale, pas seulement sur la sécurité.
//  5. Compacité générale : contact avec les parois du module, puis avec
//     n'importe quelle caisse déjà posée (limite la fragmentation de
//     l'espace libre restant) — ne départage qu'entre positions déjà à
//     égalité sur tout ce qui précède.
//  6. Départage final : préfère le plan de profondeur le moins rempli, pour
//     se répartir sur toute la longueur du module plutôt que de se tasser
//     dans un coin quand tout le reste est rigoureusement équivalent.
function isBetterPosition(a, b) {
  if (a.severity !== b.severity) return a.severity > b.severity;
  if (a.depthDistance !== b.depthDistance) return a.depthDistance < b.depthDistance;
  if (a.isFloor !== b.isFloor) return a.isFloor;
  if (a.missionTouches !== b.missionTouches) return a.missionTouches > b.missionTouches;
  if (a.wallTouches !== b.wallTouches) return a.wallTouches > b.wallTouches;
  if (a.neighborTouches !== b.neighborTouches) return a.neighborTouches > b.neighborTouches;
  return a.layerFill < b.layerFill;
}

// Explore TOUTES les positions valides possibles pour une caisse dans un
// module (les deux rotations à plat, tous les plans de profondeur autorisés,
// toutes les positions latérales) et renvoie la meilleure au sens de
// isBetterPosition — pas la première trouvée dans un ordre de balayage
// arbitraire. allowedDepths, si fourni, restreint la recherche à la zone
// réservée au contrat de cette caisse (voir assignMissionZones). missionId
// sert au niveau 4 (regroupement du contrat, voir isBetterPosition).
function findBestPosition(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, dropoffFrac, allowedDepths, missionId) {
  const orientations = boxOrientations(box);
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  const zIsPlaneAxis = planeAxes.includes(2);
  const outerPlaneAxis = zIsPlaneAxis ? 2 : planeAxes[0];
  const innerPlaneAxis = zIsPlaneAxis ? planeAxes.find((axis) => axis !== 2) : planeAxes[1];

  const range = (size) => Array.from({ length: size }, (_, i) => i);
  let depths = range(cellDims[depthAxis]);
  if (allowedDepths) depths = depths.filter((d) => allowedDepths.has(d));
  const outers = range(cellDims[outerPlaneAxis]);
  const inners = range(cellDims[innerPlaneAxis]);

  const maxDepthIdx = cellDims[depthAxis] - 1;
  const idealDepth = dropoffFrac != null && maxDepthIdx > 0 ? dropoffFrac * maxDepthIdx : null;

  let best = null;
  for (const d of depths) {
    for (const o of outers) {
      for (const i of inners) {
        const pos = [0, 0, 0];
        pos[depthAxis] = d;
        pos[outerPlaneAxis] = o;
        pos[innerPlaneAxis] = i;
        for (const size of orientations) {
          if (!canPlace(grid, cellDims, pos, size)) continue;
          if (!hasValidSupport(grid, pos, size, box.scu)) continue;

          const candidate = {
            position: pos.slice(),
            size,
            severity: worstConflictDropoff(depthAxis, activeBoxes, pos, size, dropoffStop),
            depthDistance: idealDepth != null ? Math.abs(d - idealDepth) : 0,
            isFloor: pos[2] === 0,
            missionTouches: missionId != null ? countNeighborTouches(grid, cellDims, pos, size, missionId) : 0,
            wallTouches: countWallTouches(cellDims, pos, size),
            neighborTouches: countNeighborTouches(grid, cellDims, pos, size),
            layerFill: layerUsage ? layerUsage.get(d) || 0 : 0,
          };

          if (!best || isBetterPosition(candidate, best)) best = candidate;
        }
      }
    }
  }
  return best;
}

// Essaie de poser une caisse directement au-dessus (axe vertical réel Z)
// d'une caisse déjà placée passée en argument, alignée sur son coin — pour
// grouper les caisses d'une même ligne de cargaison plutôt que les disperser
// dans la soute. Ne fonctionne que si l'empreinte de la nouvelle caisse tient
// dans celle de la caisse existante ET que la règle d'empilement le permet
// (voir canStackOn — deux caisses de 4 SCU ou plus de la même ligne ne
// peuvent PAS se poser l'une sur l'autre, même issues du même contrat) : une
// caisse plus large, ou trop grosse pour la règle d'empilement, continue de
// passer par la recherche générale (voir findBestPosition).
function tryStackOnExisting(existingBoxes, box, dropoffStop, missionId) {
  for (const other of existingBoxes) {
    const m = other.placement.module;
    const basePos = other.placement.position;
    const baseSize = other.placement.size;
    const pos = [basePos[0], basePos[1], basePos[2] + baseSize[2]];
    for (const size of boxOrientations(box)) {
      if (size[0] > baseSize[0] || size[1] > baseSize[1]) continue;
      if (canPlace(m.grid, m.cellDims, pos, size) && hasValidSupport(m.grid, pos, size, box.scu)) {
        markPlaced(m.grid, pos, size, { dropoffStop, scu: box.scu, missionId });
        if (m.layerUsage) bumpLayerUsage(m.layerUsage, m.depthAxis, pos, size, 1);
        return { module: m, position: pos, size };
      }
    }
  }
  return null;
}

// Réserve à chaque contrat (mission) sa/ses propre(s) zone(s) contiguë(s) en
// profondeur AVANT même de commencer à ranger quoi que ce soit : le trajet
// entier est déjà connu (quantités, tailles, dates de récup/livraison de
// TOUTES les marchandises), ce n'est pas un vrai flux en ligne — exactement
// comme un joueur qui, en préparant son chargement, réserve une grille par
// contrat quand ça rentre, ou scinde une grille en deux zones s'il y a plus
// de contrats que de grilles. Sans ça, deux contrats différents peuvent finir
// mélangés dans le même module simplement parce qu'ils sont arrivés dans cet
// ordre, avec le risque qu'une caisse d'un contrat qui reste longtemps bloque
// l'accès à une caisse d'un autre contrat qui part plus tôt (observé sur le
// Hull B : contrat A et contrat B mélangés dans la même soute).
// Renvoie une Map missionId -> [{ module, depthStart, depthEnd }, ...] (une
// zone par tranche de profondeur réservée ; plusieurs zones si le contrat ne
// tient pas dans un seul module). Prend les caisses déjà décomposées (pas les
// lignes de cargaison brutes) pour connaître la vraie empreinte de chacune.
function assignMissionZones(boxes, modules) {
  const missionNeed = new Map();
  boxes.forEach((b) => {
    const missionId = b.entry.mission && b.entry.mission.id;
    if (missionId == null) return; // pas de contrat identifiable : pas de zone dédiée, recherche libre à l'exécution.
    const cur = missionNeed.get(missionId) || { mission: b.entry.mission, totalScu: 0, minFootprintNeeded: 1 };
    cur.totalScu += b.box.scu;
    // Une caisse ne peut pivoter qu'à plat (voir boxOrientations) : sa PLUS
    // PETITE dimension d'empreinte est le minimum de crans de profondeur
    // qu'il lui faut d'un coup, quelle que soit l'orientation choisie. Une
    // caisse de 4 SCU ou plus a toujours une empreinte d'au moins 2×2 : la
    // zone du contrat doit faire au moins cette profondeur, sans quoi
    // aucune de ses caisses de cette taille ne pourra jamais y tenir.
    const minFootprint = Math.min(b.box.footprint[0], b.box.footprint[1]);
    if (minFootprint > cur.minFootprintNeeded) cur.minFootprintNeeded = minFootprint;
    missionNeed.set(missionId, cur);
  });

  // loEdge/hiEdge : bornes encore libres de chaque module, DES DEUX CÔTÉS
  // (pas juste un pointeur qui avance depuis l'accès) — un premier contrat
  // dans un module prend le côté "accès" (lo), le suivant le côté "fond"
  // (hi), en alternance, comme un joueur qui met un contrat à gauche, un à
  // droite, et finit par le milieu s'il en reste un troisième à caser dans la
  // même soute : ça garde le maximum d'écart entre deux contrats différents
  // plutôt que de les coller dès que la place vient à manquer.
  const moduleState = modules.map((m) => ({
    module: m,
    layerCapacity: (m.cellDims[0] * m.cellDims[1] * m.cellDims[2]) / m.cellDims[m.depthAxis],
    loEdge: 0,
    hiEdge: m.cellDims[m.depthAxis],
    maxDepth: m.cellDims[m.depthAxis],
    nextSide: "lo",
  }));

  // Les plus gros contrats d'abord : leur donne la première chance de tenir
  // entiers dans un seul module plutôt que d'être scindés inutilement.
  const missionsSorted = [...missionNeed.values()].sort((a, b) => b.totalScu - a.totalScu);
  const zonesByMission = new Map();

  missionsSorted.forEach(({ mission, totalScu, minFootprintNeeded }) => {
    let remaining = totalScu;
    const zones = [];
    while (remaining > 0.0001) {
      // N'exige PAS ici que le module ait la place idéale (minFootprintNeeded) :
      // avec plus de contrats que de crans disponibles (ex. le Raft, un seul
      // module), l'exiger aurait pour effet pervers de refuser purement et
      // simplement une zone aux contrats traités en dernier plutôt que de
      // leur donner au moins QUELQUE CHOSE — mieux vaut une zone un peu trop
      // fine pour la plus grosse caisse du contrat (qui débordera un peu)
      // qu'aucune zone du tout (qui livre TOUT le contrat à la recherche
      // libre, avec le risque de contaminer les zones des autres).
      const openModules = moduleState.filter((ms) => ms.hiEdge - ms.loEdge > 0);
      if (!openModules.length) break; // Plus de place nulle part : le repli sur la recherche libre (voir simulateRoutePacking) prendra le relais à l'exécution.

      const freeCapOf = (ms) => (ms.hiEdge - ms.loEdge) * ms.layerCapacity;
      const isFresh = (ms) => ms.loEdge === 0 && ms.hiEdge === ms.maxDepth;

      // Un module ENTIÈREMENT LIBRE qui peut tout contenir d'un coup, en
      // préférant celui où ça rentre le plus juste (garde les gros modules
      // libres pour les gros contrats encore à traiter) — priorité absolue
      // sur un module déjà partagé avec un autre contrat, même si ce dernier
      // "rentrerait mieux" : mélanger deux contrats dans la même soute est ce
      // qu'on cherche justement à éviter, pas juste minimiser la place perdue.
      let bestFit = null;
      openModules.forEach((ms) => {
        if (!isFresh(ms)) return;
        const freeCap = freeCapOf(ms);
        if (freeCap >= remaining && (!bestFit || freeCap < bestFit.freeCap)) bestFit = { ms, freeCap };
      });
      // Aucun module libre ne suffit à tout contenir : un module déjà
      // partagé qui, lui, peut tout contenir d'un coup (mélange accepté
      // seulement faute de mieux).
      if (!bestFit) {
        openModules.forEach((ms) => {
          if (isFresh(ms)) return;
          const freeCap = freeCapOf(ms);
          if (freeCap >= remaining && (!bestFit || freeCap < bestFit.freeCap)) bestFit = { ms, freeCap };
        });
      }
      // Personne ne peut tout prendre d'un coup : prend le plus grand espace
      // libre restant (libre en priorité), pour limiter le nombre de
      // morceaux du contrat.
      const ms =
        bestFit?.ms ||
        openModules.reduce((best, cur) => {
          const curFresh = isFresh(cur) ? 1 : 0;
          const bestFresh = isFresh(best) ? 1 : 0;
          if (curFresh !== bestFresh) return curFresh > bestFresh ? cur : best;
          return freeCapOf(cur) > freeCapOf(best) ? cur : best;
        });

      const freeDepths = ms.hiEdge - ms.loEdge;
      const neededDepths = Math.min(freeDepths, Math.max(minFootprintNeeded, Math.ceil(remaining / ms.layerCapacity)));
      const side = ms.nextSide;
      ms.nextSide = side === "lo" ? "hi" : "lo"; // alterne pour le PROCHAIN contrat qui arriverait dans ce même module.

      // Pas de marge explicite entre deux zones ici : on ne sait pas encore,
      // à ce stade, combien d'autres contrats devront encore partager ce
      // même module — en réserver une systématiquement a déjà fait manquer
      // des crans à des contrats plus petits traités ensuite (observé sur le
      // Raft : 10 contrats sur 12 crans, la marge à elle seule en a englouti
      // 5, laissant 4 contrats sans zone du tout). S'il reste vraiment de la
      // place une fois tous les contrats casés, elle apparaît naturellement
      // au milieu (entre le dernier contrat côté accès et le dernier côté
      // fond) sans qu'il soit besoin de la réserver à l'avance.
      let depthStart, depthEnd;
      if (side === "lo") {
        depthStart = ms.loEdge;
        depthEnd = ms.loEdge + neededDepths;
        ms.loEdge = depthEnd;
      } else {
        depthEnd = ms.hiEdge;
        depthStart = ms.hiEdge - neededDepths;
        ms.hiEdge = depthStart;
      }
      zones.push({ module: ms.module, depthStart, depthEnd });
      remaining -= neededDepths * ms.layerCapacity;
    }
    zonesByMission.set(mission.id, zones);
  });

  return zonesByMission;
}

// Cherche, parmi une liste de modules candidats (déjà triés dans l'ordre de
// préférence par l'appelant), la meilleure position pour une caisse — une
// position totalement sûre dans le PREMIER module candidat qui en offre une
// (les modules étant déjà triés par préférence, pas la peine de comparer les
// positions sûres entre elles), sinon la position la moins mauvaise
// (conflit le moins sévère) tous modules candidats confondus, jamais figée
// sur le premier module testé pour ce deuxième cas.
function placeInBestModule(candidateModules, box, dropoffStop, dropoffFrac, allowedDepthsForModule, missionId) {
  let worstCaseBest = null;
  for (const m of candidateModules) {
    const allowedDepths = allowedDepthsForModule ? allowedDepthsForModule(m) : null;
    const result = findBestPosition(m.grid, m.cellDims, box, m.depthAxis, dropoffStop, m.activeBoxes, m.layerUsage, dropoffFrac, allowedDepths, missionId);
    if (!result) continue;
    if (result.severity === Infinity) {
      markPlaced(m.grid, result.position, result.size, { dropoffStop, scu: box.scu, missionId });
      bumpLayerUsage(m.layerUsage, m.depthAxis, result.position, result.size, 1);
      return { module: m, position: result.position, size: result.size };
    }
    if (!worstCaseBest || result.severity > worstCaseBest.severity) worstCaseBest = { module: m, ...result };
  }
  if (worstCaseBest) {
    markPlaced(worstCaseBest.module.grid, worstCaseBest.position, worstCaseBest.size, { dropoffStop, scu: box.scu, missionId });
    bumpLayerUsage(worstCaseBest.module.layerUsage, worstCaseBest.module.depthAxis, worstCaseBest.position, worstCaseBest.size, 1);
    return { module: worstCaseBest.module, position: worstCaseBest.position, size: worstCaseBest.size };
  }
  return null;
}

// =========================================================================
// Rangement tenant compte de l'ordre réel du trajet (voir js/app.js pour la
// construction de pickupStop/dropoffStop à partir du trajet optimisé) :
// chaque caisse n'est posée qu'au moment où elle est réellement récupérée et
// retirée au moment de sa livraison, ce qui libère la place pour une
// récupération plus tardive. Un conflit est détecté après coup si, au
// moment de sortir une caisse, une autre caisse encore présente se trouve
// entre elle et l'accès du module — il faudra alors la déplacer
// temporairement pour l'atteindre.
// =========================================================================
function simulateRoutePacking(cargoEntries, holds, stepCount) {
  const modules = holds.map((h) => {
    const cellDims = cellsFromDimensions(h.dimensions);
    return {
      hold: h,
      cellDims,
      grid: createOccupancyGrid(cellDims),
      depthAxis: depthAxisIndex(cellDims),
      usedCells: 0,
      // Caisses actuellement à bord dans ce module précis ({ position, size,
      // dropoffStop }) : sert à juger si une nouvelle position est sûre
      // (voir worstConflictDropoff), pas seulement via la grille d'occupation.
      activeBoxes: [],
      // Occupation actuelle de chaque plan de profondeur (Map profondeur ->
      // nombre de crans occupés à cette profondeur) : terme secondaire de la
      // fonction de score (voir findBestPosition).
      layerUsage: new Map(),
    };
  });
  const shipMaxContainerSize = holds.reduce((max, h) => Math.max(max, h.maxContainerSize || 32), 1);

  const boxes = [];
  cargoEntries.forEach((entry) => {
    if (entry.pickupStop == null || entry.dropoffStop == null) return;
    const cap = entry.maxCargoBoxSize
      ? Math.min(entry.maxCargoBoxSize, shipMaxContainerSize)
      : shipMaxContainerSize;
    decomposeIntoBoxes(entry.quantity, cap).forEach((box) => {
      boxes.push({
        box,
        entry,
        pickupStop: entry.pickupStop,
        dropoffStop: entry.dropoffStop,
        placement: null,
        active: false,
      });
    });
  });
  // À égalité de récupération, les caisses qui repartent le plus tard
  // d'abord (dernières livrées = chargées en premier, pour avoir le premier
  // choix de position — les caisses qui repartent tôt s'insèrent ensuite près
  // de l'accès), puis les plus grosses avant les petites (pour ne pas
  // fragmenter l'espace avec du petit avant que le gros n'ait pu se placer).
  boxes.sort((a, b) => a.pickupStop - b.pickupStop || b.dropoffStop - a.dropoffStop || b.box.scu - a.box.scu);

  // Une zone dédiée par contrat, calculée une fois pour toutes AVANT le
  // rangement (voir assignMissionZones) : le trajet entier est déjà connu, ce
  // n'est pas la peine d'attendre d'être coincé pour découvrir qu'un contrat
  // aurait dû avoir sa propre soute. MAIS seulement s'il y a structurellement
  // assez de modules pour espérer donner à chaque contrat le sien : vérifié
  // empiriquement (données réelles utilisateur) qu'avec MOINS de modules que
  // de contrats actifs (ex. le Raft, une seule grille, pour 10 contrats), les
  // forcer quand même dans des zones étroites fait plus de mal que de bien —
  // un contrat confiné à 1-2 crans de profondeur se retrouve à se bloquer
  // LUI-MÊME (ses propres caisses n'ont plus la place de s'étaler dans le
  // temps), alors que la recherche libre s'en sort mieux sans cette
  // contrainte artificielle. Le zonage reste un net gain quand chaque contrat
  // PEUT raisonnablement avoir sa propre soute (Hull B : 16 modules pour 10
  // contrats, 1 seul conflit résiduel après zonage).
  const distinctMissionCount = new Set(
    boxes.map((b) => b.entry.mission && b.entry.mission.id).filter((id) => id != null)
  ).size;
  const zonesByMission = modules.length >= distinctMissionCount ? assignMissionZones(boxes, modules) : new Map();

  const unplaced = [];
  const conflicts = [];
  const loadAtStep = new Array(stepCount).fill(0);

  for (let step = 0; step < stepCount; step++) {
    // Livraisons d'abord (libère de la place pour les récupérations de ce
    // même arrêt) : on vérifie d'abord si une autre caisse encore présente
    // bloquait l'accès, puis on retire la caisse dans tous les cas (elle
    // part réellement du vaisseau).
    boxes
      .filter((b) => b.dropoffStop === step && b.active)
      .forEach((b) => {
        const m = b.placement.module;
        // Une caisse qui part au même arrêt n'est jamais un vrai blocage :
        // les deux sortent de toute façon à cette étape, l'ordre dans lequel
        // on les prend n'a aucune conséquence.
        const blockers = boxes.filter(
          (other) =>
            other !== b &&
            other.active &&
            other.dropoffStop !== step &&
            other.placement.module === m &&
            isBlocking(m.depthAxis, other.placement.position, other.placement.size, b.placement.position, b.placement.size)
        );
        if (blockers.length) {
          conflicts.push({ box: b.box, entry: b.entry, blockedBy: blockers.map((x) => x.entry), atStep: step });
        }
        markPlaced(m.grid, b.placement.position, b.placement.size, null);
        m.usedCells -= b.placement.size[0] * b.placement.size[1] * b.placement.size[2];
        bumpLayerUsage(m.layerUsage, m.depthAxis, b.placement.position, b.placement.size, -1);
        const activeIdx = m.activeBoxes.indexOf(b.placement.activeEntry);
        if (activeIdx !== -1) m.activeBoxes.splice(activeIdx, 1);
        b.active = false;
      });

    boxes
      .filter((b) => b.pickupStop === step)
      .forEach((b) => {
        // Essaie d'abord d'empiler directement sur une caisse déjà posée de
        // la MÊME ligne de cargaison (même mission/marchandise/contrat) :
        // garde les caisses d'un même contrat groupées (ex. une caisse de
        // 2 SCU posée sur celle de 4 SCU du même contrat) plutôt que
        // dispersées dans la soute, comme un joueur le ferait naturellement.
        const dropoffFrac = stepCount > 1 ? b.dropoffStop / (stepCount - 1) : 0;
        const missionId = b.entry.mission && b.entry.mission.id;

        const sameEntryActive = boxes.filter((other) => other !== b && other.active && other.entry === b.entry);
        let placed = tryStackOnExisting(sameEntryActive, b.box, b.dropoffStop, missionId);

        // Sinon, essaie la/les zone(s) réservée(s) au contrat de cette caisse
        // (voir assignMissionZones, calculé une fois pour tout le trajet) :
        // une grille dédiée par contrat quand ça rentre, sinon une zone en
        // profondeur au sein d'un module partagé — avant même de regarder
        // ailleurs sur le vaisseau.
        if (!placed) {
          const zones = (missionId != null ? zonesByMission.get(missionId) : null) || [];
          const zoneModules = zones
            .filter((z) => !(z.module.hold.maxContainerSize && b.box.scu > z.module.hold.maxContainerSize))
            .map((z) => z.module);
          const allowedDepthsByModule = new Map();
          zones.forEach((z) => {
            const s = allowedDepthsByModule.get(z.module) || new Set();
            for (let d = z.depthStart; d < z.depthEnd; d++) s.add(d);
            allowedDepthsByModule.set(z.module, s);
          });
          placed = placeInBestModule(zoneModules, b.box, b.dropoffStop, dropoffFrac, (m) => allowedDepthsByModule.get(m), missionId);
        }

        // Sinon (zone réservée pleine ou contrat sans zone), modules les
        // moins remplis d'abord (recalculé à chaque caisse, pas une fois par
        // arrêt : plusieurs caisses peuvent être récupérées au même arrêt) :
        // sans ça, tout se tasserait dans le premier module de la liste,
        // quitte à créer des conflits évitables alors que d'autres modules du
        // vaisseau sont encore vides. Un module vide ou déjà occupé
        // uniquement par le MÊME contrat est "compatible" — préféré à un
        // module qui contient déjà la cargaison d'un autre contrat, pour
        // garder chaque contrat groupé plutôt que mélangé avec d'autres.
        if (!placed) {
          const isCompatible = (m) => m.activeBoxes.length === 0 || m.activeBoxes.every((a) => a.missionId === missionId);
          const byFreeSpace = modules
            .slice()
            .filter((m) => !(m.hold.maxContainerSize && b.box.scu > m.hold.maxContainerSize))
            .sort((a, b2) => {
              const ac = isCompatible(a) ? 0 : 1;
              const bc = isCompatible(b2) ? 0 : 1;
              if (ac !== bc) return ac - bc;
              return a.usedCells - b2.usedCells;
            });
          placed = placeInBestModule(byFreeSpace, b.box, b.dropoffStop, dropoffFrac, null, missionId);
        }

        if (!placed) {
          unplaced.push({ box: b.box, entry: b.entry });
          return;
        }
        b.placement = placed;
        b.active = true;
        placed.module.usedCells += placed.size[0] * placed.size[1] * placed.size[2];
        placed.activeEntry = {
          position: placed.position,
          size: placed.size,
          dropoffStop: b.dropoffStop,
          missionId: b.entry.mission && b.entry.mission.id,
        };
        placed.module.activeBoxes.push(placed.activeEntry);
      });

    loadAtStep[step] = boxes.filter((b) => b.active).reduce((sum, b) => sum + b.box.scu, 0);
  }

  let peakStepIndex = 0;
  loadAtStep.forEach((v, i) => {
    if (v > loadAtStep[peakStepIndex]) peakStepIndex = i;
  });

  const conflictedBoxes = new Set(conflicts.map((c) => c.box));
  const placements = boxes
    .filter((b) => b.placement)
    .map((b) => ({
      module: b.placement.module.hold,
      position: b.placement.position,
      size: b.placement.size,
      box: b.box,
      entry: b.entry,
      pickupStop: b.pickupStop,
      dropoffStop: b.dropoffStop,
      conflict: conflictedBoxes.has(b.box),
    }));

  return { placements, unplaced, conflicts, peakStepIndex };
}
