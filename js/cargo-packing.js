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

// Tailles de caisses standard du jeu, en crans de grille (x,y,z), du plus
// grand au plus petit.
const SCU_BOX_SIZES = [
  { scu: 32, cells: [2, 2, 8] },
  { scu: 24, cells: [2, 2, 6] },
  { scu: 16, cells: [2, 2, 4] },
  { scu: 8, cells: [2, 2, 2] },
  { scu: 4, cells: [1, 2, 2] },
  { scu: 2, cells: [1, 1, 2] },
  { scu: 1, cells: [1, 1, 1] },
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
  if (remaining > 0) boxes.push({ scu: remaining, cells: [1, 1, 1] });
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

// Les 6 permutations possibles des 3 axes d'une caisse (orientations
// axis-aligned) : une caisse dont la plus grande face ne rentre pas dans le
// sens "naturel" peut très bien rentrer une fois tournée sur un autre axe.
function axisPermutations([a, b, c]) {
  return [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ];
}

// Essaie de placer une caisse dans un module, en testant toutes les
// orientations possibles au premier emplacement libre trouvé — pas une
// recherche du meilleur agencement possible, juste un rangement réaliste et
// sans recouvrement, comme un joueur caserait effectivement ses caisses.
// L'axe de profondeur (depthAxis) est la boucle la plus externe, balayée à
// l'envers (du fond vers l'accès) : chaque plan de profondeur est rempli en
// entier (réparti sur les deux autres axes) avant de passer au plan
// suivant, plus proche de l'accès. Sans ça (profondeur en boucle interne),
// tout finirait entassé contre un seul côté du module au lieu de se
// répartir sur toute sa largeur.
function tryPlaceInModule(grid, cellDims, boxCells, depthAxis) {
  const orientations = axisPermutations(boxCells);
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  const range = (size) => Array.from({ length: size }, (_, i) => i);
  const depths = range(cellDims[depthAxis]).reverse();
  const as = range(cellDims[planeAxes[0]]);
  const bs = range(cellDims[planeAxes[1]]);

  for (const d of depths) {
    for (const a of as) {
      for (const b of bs) {
        const pos = [0, 0, 0];
        pos[depthAxis] = d;
        pos[planeAxes[0]] = a;
        pos[planeAxes[1]] = b;
        for (const size of orientations) {
          if (canPlace(grid, cellDims, pos, size)) {
            markPlaced(grid, pos, size, true);
            return { position: pos, size };
          }
        }
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
        // Modules les moins remplis d'abord (recalculé à chaque caisse, pas
        // une fois par arrêt : plusieurs caisses peuvent être récupérées au
        // même arrêt) : sans ça, tout se tasserait dans le premier module de
        // la liste par empilement en profondeur, quitte à créer des conflits
        // évitables alors que d'autres modules du vaisseau sont encore
        // vides — un joueur répartirait naturellement sa cargaison entre les
        // soutes plutôt que d'en bourrer une seule.
        const byFreeSpace = modules.slice().sort((a, b2) => a.usedCells - b2.usedCells);
        let placed = null;
        for (const m of byFreeSpace) {
          if (m.hold.maxContainerSize && b.box.scu > m.hold.maxContainerSize) continue;
          const result = tryPlaceInModule(m.grid, m.cellDims, b.box.cells, m.depthAxis);
          if (result) {
            placed = { module: m, position: result.position, size: result.size };
            break;
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
