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

function markPlaced(grid, pos, size) {
  const [px, py, pz] = pos;
  const [sx, sy, sz] = size;
  for (let x = px; x < px + sx; x++) {
    for (let y = py; y < py + sy; y++) {
      for (let z = pz; z < pz + sz; z++) {
        grid[x][y][z] = true;
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
// orientations possibles au premier emplacement libre trouvé (balayage
// x/y/z) — pas une recherche du meilleur agencement possible, juste un
// rangement correct (jamais de recouvrement) et déterministe.
function tryPlaceInModule(grid, cellDims, boxCells) {
  const orientations = axisPermutations(boxCells);
  const [dx, dy, dz] = cellDims;
  for (let x = 0; x < dx; x++) {
    for (let y = 0; y < dy; y++) {
      for (let z = 0; z < dz; z++) {
        for (const size of orientations) {
          if (canPlace(grid, cellDims, [x, y, z], size)) {
            markPlaced(grid, [x, y, z], size);
            return { position: [x, y, z], size };
          }
        }
      }
    }
  }
  return null;
}

// Range une liste d'entrées de cargaison ({ quantity, ...métadonnées libres })
// dans les modules réels de la soute d'un vaisseau (holds, voir
// js/fleetyards.js:getShipCargoHolds). Renvoie { placements, unplaced } :
// - placements : un tableau { module, position, size, box, entry } (un par
//   caisse effectivement placée), position/size en crans de grille (1,25 m)
//   relatifs à l'origine du module.
// - unplaced : les caisses qui n'ont trouvé de place dans aucun module
//   (soute trop petite, ou aucun module n'accepte cette taille de caisse).
function packCargoIntoHolds(cargoEntries, holds) {
  const modules = holds.map((h) => {
    const cellDims = cellsFromDimensions(h.dimensions);
    return { hold: h, cellDims, grid: createOccupancyGrid(cellDims) };
  });

  const shipMaxContainerSize = holds.reduce((max, h) => Math.max(max, h.maxContainerSize || 32), 1);

  // Les plus grosses caisses d'abord (premier ajustement décroissant) :
  // heuristique simple et efficace pour le rangement en bacs.
  const allBoxes = [];
  cargoEntries.forEach((entry) => {
    decomposeIntoBoxes(entry.quantity, shipMaxContainerSize).forEach((box) => allBoxes.push({ box, entry }));
  });
  allBoxes.sort((a, b) => b.box.scu - a.box.scu);

  const placements = [];
  const unplaced = [];
  allBoxes.forEach(({ box, entry }) => {
    let placed = null;
    for (const m of modules) {
      if (m.hold.maxContainerSize && box.scu > m.hold.maxContainerSize) continue;
      const result = tryPlaceInModule(m.grid, m.cellDims, box.cells);
      if (result) {
        placed = { module: m.hold, position: result.position, size: result.size, box, entry };
        break;
      }
    }
    if (placed) placements.push(placed);
    else unplaced.push({ box, entry });
  });

  return { placements, unplaced };
}
