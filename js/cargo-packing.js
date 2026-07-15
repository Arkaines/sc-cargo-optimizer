"use strict";

// =========================================================================
// Rangement des marchandises dans les soutes de cargo réelles du vaisseau
// (données FleetYards.net, voir js/fleetyards.js) : décompose chaque ligne
// de cargaison en caisses de tailles standard, puis les place dans les
// modules de la soute avec un algorithme glouton simple (premier
// emplacement libre, sans recouvrement) — pas un solveur d'optimalité, un
// rangement correct et lisible, pour savoir où mettre chaque marchandise.
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
// large et basse, pas haute et étroite).
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

// Chaque cellule vaut null (libre) ou un objet { dropoffStop } identifiant
// la caisse qui l'occupe — sert au test de support physique (hasSupport) :
// jamais de recouvrement, une caisse repose au sol ou sur une autre déjà
// posée (jamais dans le vide).
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

// Une caisse ne peut jamais flotter : elle doit reposer au sol (z=0) ou avoir
// toute son empreinte directement soutenue par d'autres caisses juste en
// dessous (contact complet, pas de trou) — sans cette vérification, une
// caisse de 4 SCU pourrait par exemple se retrouver posée pour moitié sur une
// caisse de 2 SCU et pour moitié dans le vide, ce que le jeu ne permet pas.
// z (index 2) est toujours l'axe vertical réel (voir cellsFromDimensions),
// indépendamment de l'axe d'accès choisi pour ce module (depthAxis).
function hasSupport(grid, pos, size) {
  const [px, py, pz] = pos;
  const [sx, sy] = size;
  if (pz === 0) return true;
  for (let x = px; x < px + sx; x++) {
    for (let y = py; y < py + sy; y++) {
      if (!grid[x][y][pz - 1]) return false;
    }
  }
  return true;
}

// value = true pour occuper (récupération), false pour libérer (livraison,
// voir simulateRoutePacking) — la place libérée par une livraison redevient
// disponible pour une récupération plus tardive du même trajet.
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
// axe dépasse 1 cran) — delta positif à la pose, négatif au retrait. Sert à
// préférer le plan le moins rempli plutôt que le premier "jamais touché"
// (voir tryPlaceInModule).
function bumpLayerUsage(layerUsage, depthAxis, pos, size, delta) {
  const start = pos[depthAxis];
  const span = size[depthAxis];
  const footprintArea = (size[0] * size[1] * size[2]) / span;
  for (let d = start; d < start + span; d++) {
    layerUsage.set(d, (layerUsage.get(d) || 0) + delta * footprintArea);
  }
}

// Une position n'est sûre que si elle n'entre en conflit avec AUCUNE caisse
// active du module, dans AUCUN des deux sens : ni bloquée par une caisse
// déjà là plus proche de l'accès qui part avant elle (voir isBlocking), ni
// en train de bloquer, elle, une caisse déjà là plus profonde qui doit
// partir avant elle — sans ce deuxième sens, deux caisses posées toutes les
// deux au sol mais à des profondeurs différentes (donc jamais empilées
// l'une sur l'autre) peuvent quand même se bloquer l'une l'autre si la plus
// proche de l'accès reste plus longtemps à bord.
function isSafePosition(depthAxis, activeBoxes, pos, size, dropoffStop) {
  for (const other of activeBoxes) {
    if (isBlocking(depthAxis, other.position, other.size, pos, size) && other.dropoffStop < dropoffStop) return false;
    if (isBlocking(depthAxis, pos, size, other.position, other.size) && dropoffStop < other.dropoffStop) return false;
  }
  return true;
}

// Gravité d'un conflit potentiel pour une position donnée : la date de
// livraison la plus proche parmi les caisses avec lesquelles ça coincerait
// (dans un sens ou dans l'autre) — Infinity si aucun conflit. Sert à choisir
// la moins mauvaise option en dernier recours (voir tryPlaceInModule),
// plutôt que de subir l'ordre de balayage.
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

// Essaie de placer une caisse dans un module, en testant les deux rotations
// à plat possibles (voir boxOrientations) — pas une recherche du meilleur
// agencement possible, juste un rangement réaliste et sans recouvrement,
// comme un joueur caserait effectivement ses caisses. activeBoxes est la
// liste des caisses actuellement à bord DANS CE MODULE ({position, size,
// dropoffStop}), utilisée pour juger si une position est sûre (voir
// isSafePosition) — pas seulement pour l'empilement vertical, mais aussi
// pour deux caisses posées au sol à des profondeurs différentes : la plus
// proche de l'accès bloque l'autre exactement de la même façon si elle part
// plus tard. Trois passes, de la plus sûre au dernier recours :
// 1. Au sol (Z=0), sûre, sur toute la profondeur disponible du module — pour
//    se répartir sur toute sa longueur plutôt que de se tasser dans un
//    coin, sans pour autant ignorer les conflits de profondeur au sol.
// 2. Empilée, sûre.
// 3. N'importe quelle position valide géométriquement, en dernier recours :
//    on garde celle dont le pire conflit part le plus tard (la moins
//    mauvaise), plutôt que la première trouvée dans l'ordre de balayage.
//
// Scindé en deux fonctions (voir plus bas) plutôt qu'une seule qui gère les
// trois passes d'un coup : le niveau au-dessus (simulateRoutePacking) doit
// pouvoir essayer la passe "sûre" dans TOUS les modules du vaisseau avant de
// se rabattre sur la passe 3 dans N'IMPORTE LEQUEL — sinon un module presque
// plein mais encore "le moins rempli" force un conflit évitable alors qu'un
// autre module, plus rempli au global mais avec un emplacement encore
// totalement libre pour cette caisse précise, existe ailleurs sur le
// vaisseau. C'était le bug : la caisse était forcée dans le premier module
// testé dès qu'une position géométriquement valide existait, même conflictuelle,
// sans jamais regarder si un autre module avait une place réellement libre.
function computeDepthOrder(cellDims, depthAxis, layerUsage, dropoffFrac) {
  const range = (size) => Array.from({ length: size }, (_, i) => i);
  const allDepths = range(cellDims[depthAxis]).reverse();
  const maxDepthIdx = cellDims[depthAxis] - 1;
  const idealDepth = dropoffFrac != null ? dropoffFrac * maxDepthIdx : null;
  return allDepths.slice().sort((a, b) => {
    if (idealDepth != null) {
      const diff = Math.abs(a - idealDepth) - Math.abs(b - idealDepth);
      if (diff !== 0) return diff;
    }
    return layerUsage ? (layerUsage.get(a) || 0) - (layerUsage.get(b) || 0) : 0;
  });
}

// Passes 1 et 2 (sol sûr, puis empilé sûr) : ne commite (markPlaced) que si
// une position sûre est trouvée, renvoie null sinon sans aucun effet de bord
// — permet au niveau au-dessus d'essayer un autre module sans avoir à
// annuler quoi que ce soit.
function trySafePlacement(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, dropoffFrac, allowedDepths) {
  const orientations = boxOrientations(box);
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  const zIsPlaneAxis = planeAxes.includes(2);
  const outerPlaneAxis = zIsPlaneAxis ? 2 : planeAxes[0];
  const innerPlaneAxis = zIsPlaneAxis ? planeAxes.find((axis) => axis !== 2) : planeAxes[1];

  const range = (size) => Array.from({ length: size }, (_, i) => i);
  // Ordre de préférence des plans de profondeur : d'abord par proximité avec
  // la profondeur "idéale" pour cette caisse d'après sa date de livraison
  // (dropoffFrac, 0 = part tout de suite, 1 = part en dernier) — une caisse
  // qui part tôt doit rester près de l'accès (profondeur faible) et une
  // caisse qui reste longtemps peut aller au fond, pour que l'ordre spatial
  // corresponde à l'ordre réel de sortie et ne force jamais un blocage
  // évitable. À proximité égale, préfère le plan le moins rempli (occupation
  // RÉELLE, pas juste "déjà touché une fois") pour se répartir sur toute la
  // longueur du module plutôt que de se tasser dans un coin. allowedDepths,
  // si fourni, restreint la recherche à la zone réservée au contrat de cette
  // caisse (voir assignMissionZones) — une caisse d'un autre contrat ne doit
  // pas venir s'y intercaler.
  let depths = computeDepthOrder(cellDims, depthAxis, layerUsage, dropoffFrac);
  if (allowedDepths) depths = depths.filter((d) => allowedDepths.has(d));
  const outers = range(cellDims[outerPlaneAxis]);
  const inners = range(cellDims[innerPlaneAxis]);

  for (const floorOnly of [true, false]) {
    for (const d of depths) {
      for (const o of outers) {
        for (const i of inners) {
          const pos = [0, 0, 0];
          pos[depthAxis] = d;
          pos[outerPlaneAxis] = o;
          pos[innerPlaneAxis] = i;
          if (floorOnly && pos[2] !== 0) continue;
          if (!floorOnly && pos[2] === 0) continue; // déjà couvert par la passe "floor"
          for (const size of orientations) {
            if (!canPlace(grid, cellDims, pos, size) || !hasSupport(grid, pos, size)) continue;
            if (!isSafePosition(depthAxis, activeBoxes, pos, size, dropoffStop)) continue;
            markPlaced(grid, pos, size, { dropoffStop });
            if (layerUsage) bumpLayerUsage(layerUsage, depthAxis, pos, size, 1);
            return { position: pos, size };
          }
        }
      }
    }
  }
  return null;
}

// Passe 3 (dernier recours) : passe en revue TOUTES les positions valides
// possibles de CE module et renvoie celle dont le pire conflit part le plus
// tard — SANS commiter, pour que le niveau au-dessus puisse comparer avec les
// autres modules du vaisseau avant de choisir où placer réellement la caisse.
function tryWorstCasePlacement(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, dropoffFrac, allowedDepths) {
  const orientations = boxOrientations(box);
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  const zIsPlaneAxis = planeAxes.includes(2);
  const outerPlaneAxis = zIsPlaneAxis ? 2 : planeAxes[0];
  const innerPlaneAxis = zIsPlaneAxis ? planeAxes.find((axis) => axis !== 2) : planeAxes[1];

  const range = (size) => Array.from({ length: size }, (_, i) => i);
  let depths = computeDepthOrder(cellDims, depthAxis, layerUsage, dropoffFrac);
  if (allowedDepths) depths = depths.filter((d) => allowedDepths.has(d));
  const outers = range(cellDims[outerPlaneAxis]);
  const inners = range(cellDims[innerPlaneAxis]);

  let best = null;
  for (const d of depths) {
    for (const o of outers) {
      for (const i of inners) {
        const pos = [0, 0, 0];
        pos[depthAxis] = d;
        pos[outerPlaneAxis] = o;
        pos[innerPlaneAxis] = i;
        for (const size of orientations) {
          if (!canPlace(grid, cellDims, pos, size) || !hasSupport(grid, pos, size)) continue;
          const severity = worstConflictDropoff(depthAxis, activeBoxes, pos, size, dropoffStop);
          if (!best || severity > best.severity) best = { position: pos.slice(), size, severity };
        }
      }
    }
  }
  return best;
}

// Essaie de poser une caisse directement au-dessus (axe vertical réel Z)
// d'une caisse déjà placée passée en argument, alignée sur son coin — pour
// grouper les caisses d'une même ligne de cargaison plutôt que les disperser
// dans la soute. Ne fonctionne que si l'empreinte de la nouvelle caisse
// tient dans celle de la caisse existante (un support plein est requis, voir
// hasSupport) : une caisse plus large que celle du dessous continue de
// passer par la recherche générale (voir tryPlaceInModule).
function tryStackOnExisting(existingBoxes, box, dropoffStop) {
  for (const other of existingBoxes) {
    const m = other.placement.module;
    const basePos = other.placement.position;
    const baseSize = other.placement.size;
    const pos = [basePos[0], basePos[1], basePos[2] + baseSize[2]];
    for (const size of boxOrientations(box)) {
      if (size[0] > baseSize[0] || size[1] > baseSize[1]) continue;
      if (canPlace(m.grid, m.cellDims, pos, size) && hasSupport(m.grid, pos, size)) {
        markPlaced(m.grid, pos, size, { dropoffStop });
        if (m.layerUsage) bumpLayerUsage(m.layerUsage, m.depthAxis, pos, size, 1);
        return { module: m, position: pos, size };
      }
    }
  }
  return null;
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

// =========================================================================
// Rangement tenant compte de l'ordre réel du trajet (voir js/app.js pour la
// construction de pickupStop/dropoffStop à partir du trajet optimisé) :
// chaque caisse n'est posée qu'au moment où elle est réellement récupérée
// (rangement libre, comme un joueur le ferait vraiment — toutes orientations
// testées, premier emplacement disponible) et retirée au moment de sa
// livraison, ce qui libère la place pour une récupération plus tardive.
// Un conflit est détecté après coup si, au moment de sortir une caisse,
// une autre caisse encore présente se trouve entre elle et l'accès du
// module — il faudra alors la déplacer temporairement pour l'atteindre.
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
      // (voir isSafePosition), pas seulement via la grille d'occupation.
      activeBoxes: [],
      // Occupation actuelle de chaque plan de profondeur (Map profondeur ->
      // nombre de crans occupés à cette profondeur, mis à jour au fil des
      // arrêts) : préfère le plan le moins rempli pour se répartir sur toute
      // la longueur du module (voir tryPlaceInModule).
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
  // Les plus grosses caisses d'abord à égalité de récupération : reste une
  // heuristique de remplissage raisonnable une fois l'ordre du trajet fixé.
  boxes.sort((a, b) => a.pickupStop - b.pickupStop || b.box.scu - a.box.scu);

  // Une zone dédiée par contrat, calculée une fois pour toutes AVANT le
  // rangement (voir assignMissionZones) : le trajet entier est déjà connu, ce
  // n'est pas la peine d'attendre d'être coincé pour découvrir qu'un contrat
  // aurait dû avoir sa propre soute. MAIS seulement s'il y a structurellement
  // assez de modules pour espérer donner à chaque contrat le sien : vérifié
  // empiriquement (données réelles utilisateur) qu'avec MOINS de modules que
  // de contrats actifs (ex. le Raft, une seule grille, pour 10 contrats), les
  // forcer quand même dans des zones étroites fait plus de mal que de bien —
  // 24 conflits avec zonage contre 20 sans, sur le même trajet réel — car un
  // contrat confiné à 1-2 crans de profondeur se retrouve à se bloquer
  // LUI-MÊME (ses propres caisses n'ont plus la place de s'étaler dans le
  // temps), alors que la recherche libre (préférence de profondeur par date
  // de livraison + sécurité bidirectionnelle) s'en sort mieux sans cette
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
        const sameEntryActive = boxes.filter((other) => other !== b && other.active && other.entry === b.entry);
        let placed = tryStackOnExisting(sameEntryActive, b.box, b.dropoffStop);

        // Sinon, essaie la/les zone(s) réservée(s) au contrat de cette caisse
        // (voir assignMissionZones, calculé une fois pour tout le trajet) :
        // une grille dédiée par contrat quand ça rentre, sinon une zone en
        // profondeur au sein d'un module partagé — avant même de regarder
        // ailleurs sur le vaisseau.
        if (!placed) {
          const dropoffFracForZone = stepCount > 1 ? b.dropoffStop / (stepCount - 1) : 0;
          const missionIdForZone = b.entry.mission && b.entry.mission.id;
          const zones = missionIdForZone != null ? zonesByMission.get(missionIdForZone) || [] : [];
          for (const zone of zones) {
            if (zone.module.hold.maxContainerSize && b.box.scu > zone.module.hold.maxContainerSize) continue;
            const allowedDepths = new Set();
            for (let d = zone.depthStart; d < zone.depthEnd; d++) allowedDepths.add(d);
            const result = trySafePlacement(
              zone.module.grid,
              zone.module.cellDims,
              b.box,
              zone.module.depthAxis,
              b.dropoffStop,
              zone.module.activeBoxes,
              zone.module.layerUsage,
              dropoffFracForZone,
              allowedDepths
            );
            if (result) {
              placed = { module: zone.module, position: result.position, size: result.size };
              break;
            }
          }
        }

        // Sinon (zone réservée pleine ou contrat sans zone), modules les moins remplis d'abord (recalculé à chaque
        // caisse, pas une fois par arrêt : plusieurs caisses peuvent être
        // récupérées au même arrêt) : sans ça, tout se tasserait dans le
        // premier module de la liste par empilement en profondeur, quitte à
        // créer des conflits évitables alors que d'autres modules du
        // vaisseau sont encore vides.
        if (!placed) {
          const dropoffFrac = stepCount > 1 ? b.dropoffStop / (stepCount - 1) : 0;
          const missionId = b.entry.mission && b.entry.mission.id;
          // Un module vide ou déjà occupé uniquement par le MÊME contrat est
          // "compatible" — préféré à un module qui contient déjà la
          // cargaison d'un autre contrat, pour garder chaque contrat groupé
          // dans ses propres soutes plutôt que mélangé avec d'autres (plus
          // facile à suivre pour le joueur, et ça évite qu'une caisse d'un
          // contrat se retrouve coincée par une caisse d'un autre contrat qui
          // reste à bord plus longtemps, comme observé sur le Hull B).
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

          // Passe 1 : une place SÛRE dans N'IMPORTE LEQUEL des modules du
          // vaisseau (le moins rempli d'abord) — avant de se rabattre sur un
          // conflit forcé, on vérifie que TOUT le vaisseau n'a vraiment aucune
          // place sûre, pas seulement le premier module testé.
          for (const m of byFreeSpace) {
            const result = trySafePlacement(m.grid, m.cellDims, b.box, m.depthAxis, b.dropoffStop, m.activeBoxes, m.layerUsage, dropoffFrac);
            if (result) {
              placed = { module: m, position: result.position, size: result.size };
              break;
            }
          }

          // Passe 2 : aucun module n'a de place sûre pour cette caisse ->
          // compare le pire conflit de CHAQUE module (sans rien commiter) et
          // ne retient que le moins mauvais de tout le vaisseau, plutôt que le
          // premier trouvé dans le module le moins rempli.
          if (!placed) {
            let best = null;
            for (const m of byFreeSpace) {
              const candidate = tryWorstCasePlacement(m.grid, m.cellDims, b.box, m.depthAxis, b.dropoffStop, m.activeBoxes, m.layerUsage, dropoffFrac);
              if (candidate && (!best || candidate.severity > best.severity)) best = { module: m, ...candidate };
            }
            if (best) {
              markPlaced(best.module.grid, best.position, best.size, { dropoffStop: b.dropoffStop });
              bumpLayerUsage(best.module.layerUsage, best.module.depthAxis, best.position, best.size, 1);
              placed = { module: best.module, position: best.position, size: best.size };
            }
          }
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
