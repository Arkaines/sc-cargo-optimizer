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
      boxes.push(size);
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

function createOccupancyGrid(cellDims) {
  const [dx, dy, dz] = cellDims;
  const grid = [];
  for (let x = 0; x < dx; x++) {
    grid.push([]);
    for (let y = 0; y < dy; y++) {
      grid[x].push(new Array(dz).fill(false));
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

// Essaie de placer une caisse dans un module, en testant les deux rotations
// à plat possibles (voir boxOrientations) au premier emplacement libre
// trouvé — pas une recherche du meilleur agencement possible, juste un
// rangement réaliste et sans recouvrement, comme un joueur caserait
// effectivement ses caisses. Ordre de balayage, du plus externe au plus
// interne : (1) l'axe de profondeur (depthAxis), à l'envers (du fond vers
// l'accès) — chaque plan de profondeur se remplit avant de passer au
// suivant, plus proche de l'accès ; (2) l'axe vertical réel (Z), du sol vers
// le haut — une caisse ne s'empile sur une autre que si tout le sol de ce
// plan de profondeur est déjà occupé, jamais avant d'avoir essayé une place
// au sol toute fraîche ailleurs (sans ça, des caisses s'empilent inutilement
// l'une sur l'autre alors que la soute reste par ailleurs largement vide,
// créant des conflits de chargement évitables) ; (3) l'axe latéral restant,
// pour se répartir sur toute la largeur plutôt que de s'entasser d'un côté.
function tryPlaceInModule(grid, cellDims, box, depthAxis) {
  const orientations = boxOrientations(box);
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  // Si Z fait partie des deux axes de plan (cas courant), il passe en boucle
  // médiane (priorité sol avant empilement) ; l'autre axe latéral reste la
  // boucle la plus interne.
  const zIsPlaneAxis = planeAxes.includes(2);
  const outerPlaneAxis = zIsPlaneAxis ? 2 : planeAxes[0];
  const innerPlaneAxis = zIsPlaneAxis ? planeAxes.find((axis) => axis !== 2) : planeAxes[1];

  const range = (size) => Array.from({ length: size }, (_, i) => i);
  const depths = range(cellDims[depthAxis]).reverse();
  const outers = range(cellDims[outerPlaneAxis]);
  const inners = range(cellDims[innerPlaneAxis]);

  for (const d of depths) {
    for (const o of outers) {
      for (const i of inners) {
        const pos = [0, 0, 0];
        pos[depthAxis] = d;
        pos[outerPlaneAxis] = o;
        pos[innerPlaneAxis] = i;
        for (const size of orientations) {
          if (canPlace(grid, cellDims, pos, size) && hasSupport(grid, pos, size)) {
            markPlaced(grid, pos, size, true);
            return { position: pos, size };
          }
        }
      }
    }
  }
  return null;
}

// Essaie de poser une caisse directement au-dessus (axe vertical réel Z)
// d'une caisse déjà placée passée en argument, alignée sur son coin — pour
// grouper les caisses d'une même ligne de cargaison plutôt que les disperser
// dans la soute. Ne fonctionne que si l'empreinte de la nouvelle caisse
// tient dans celle de la caisse existante (un support plein est requis, voir
// hasSupport) : une caisse plus large que celle du dessous continue de
// passer par la recherche générale (voir tryPlaceInModule).
function tryStackOnExisting(existingBoxes, box) {
  for (const other of existingBoxes) {
    const m = other.placement.module;
    const basePos = other.placement.position;
    const baseSize = other.placement.size;
    const pos = [basePos[0], basePos[1], basePos[2] + baseSize[2]];
    for (const size of boxOrientations(box)) {
      if (size[0] > baseSize[0] || size[1] > baseSize[1]) continue;
      if (canPlace(m.grid, m.cellDims, pos, size) && hasSupport(m.grid, pos, size)) {
        markPlaced(m.grid, pos, size, true);
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
    return { hold: h, cellDims, grid: createOccupancyGrid(cellDims), depthAxis: depthAxisIndex(cellDims), usedCells: 0 };
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
        markPlaced(m.grid, b.placement.position, b.placement.size, false);
        m.usedCells -= b.placement.size[0] * b.placement.size[1] * b.placement.size[2];
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
        let placed = tryStackOnExisting(sameEntryActive, b.box);

        // Sinon, modules les moins remplis d'abord (recalculé à chaque
        // caisse, pas une fois par arrêt : plusieurs caisses peuvent être
        // récupérées au même arrêt) : sans ça, tout se tasserait dans le
        // premier module de la liste par empilement en profondeur, quitte à
        // créer des conflits évitables alors que d'autres modules du
        // vaisseau sont encore vides.
        if (!placed) {
          const byFreeSpace = modules.slice().sort((a, b2) => a.usedCells - b2.usedCells);
          for (const m of byFreeSpace) {
            if (m.hold.maxContainerSize && b.box.scu > m.hold.maxContainerSize) continue;
            const result = tryPlaceInModule(m.grid, m.cellDims, b.box, m.depthAxis);
            if (result) {
              placed = { module: m, position: result.position, size: result.size };
              break;
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
