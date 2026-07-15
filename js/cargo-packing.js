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

// =========================================================================
// Rangement tenant compte de l'ordre réel du trajet (voir js/app.js pour la
// construction de pickupStop/dropoffStop à partir du trajet optimisé) :
// chaque caisse n'est posée qu'au moment où elle est réellement récupérée et
// retirée au moment de sa livraison — une caisse à livrer tôt ne doit jamais
// se retrouver coincée derrière une caisse récupérée après elle dans le même
// couloir d'accès.
// =========================================================================

// Choisit l'axe le plus long d'un module comme axe de profondeur (accès
// depuis une extrémité) : les deux autres axes forment le plan des couloirs.
// Hypothèse raisonnable en l'absence de donnée réelle de porte/orientation
// (même limite déjà assumée pour le rendu 3D, voir js/cargo-viewer.js).
function depthAxisIndex(cellDims) {
  let best = 0;
  for (let i = 1; i < 3; i++) if (cellDims[i] > cellDims[best]) best = i;
  return best;
}

// Découpe le plan perpendiculaire à l'axe de profondeur en blocs de 2x2
// crans (la plus grande empreinte au sol des caisses standard, voir
// SCU_BOX_SIZES) : chaque bloc est un couloir d'accès indépendant, sur toute
// la profondeur du module. Un couloir en bord de module peut être plus étroit
// (1 cran) si la dimension du module n'est pas un multiple de 2 — sa place
// disponible réelle (planeSize) en tient compte. Une caisse plus petite que
// son couloir laisse un peu de place perdue plutôt que d'être combinée avec
// une autre — simplification volontaire, pour ne pas gérer des couloirs
// fusionnés/partagés entre plusieurs caisses de front.
function buildModuleLanes(cellDims) {
  const depthAxis = depthAxisIndex(cellDims);
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  const depthSize = cellDims[depthAxis];
  const sizeA = cellDims[planeAxes[0]];
  const sizeB = cellDims[planeAxes[1]];
  const lanes = [];
  for (let a = 0; a < sizeA; a += 2) {
    for (let b = 0; b < sizeB; b += 2) {
      lanes.push({
        depthAxis,
        planeAxes,
        planeOrigin: [a, b],
        planeSize: [Math.min(2, sizeA - a), Math.min(2, sizeB - b)],
        depthSize,
        usedDepth: 0,
        stack: [], // du plus profond (index 0, chargé en premier) au plus proche de l'accès (dernier, chargé en dernier)
      });
    }
  }
  return lanes;
}

// Oriente la caisse pour le modèle en couloirs : la plus grande dimension le
// long de la profondeur, les deux autres en travers (aucune caisse standard
// ne dépasse une empreinte de 2x2 crans en travers).
function orientForLanes(cells) {
  const sorted = cells.slice().sort((a, b) => b - a);
  return { depthExtent: sorted[0], planeExtent: [sorted[1], sorted[2]] };
}

// Vérifie qu'une empreinte tient dans un couloir (dans un sens ou dans
// l'autre selon ses deux axes) et renvoie l'empreinte correctement orientée
// pour ce couloir précis, ou null si elle ne tient dans aucun sens.
function fitFootprintToLane(lane, planeExtent) {
  const [p0, p1] = planeExtent;
  const [w0, w1] = lane.planeSize;
  if (p0 <= w0 && p1 <= w1) return [p0, p1];
  if (p0 <= w1 && p1 <= w0) return [p1, p0];
  return null;
}

// Cherche un couloir où poser la caisse sans bloquer un objet qui doit sortir
// avant elle : parmi les couloirs ayant assez de place, celui dont l'objet du
// dessus part le plus tôt tout en partant après (ou en même temps que) la
// nouvelle caisse — algorithme de tri par paquets ("patience sorting"),
// classique pour ce genre de contrainte d'empilement, qui minimise le nombre
// de couloirs réellement nécessaires. Un couloir vide n'est utilisé qu'en
// dernier recours, pour ne pas ouvrir de nouveaux couloirs inutilement.
function findLaneForPush(lanes, depthExtent, planeExtent, dropoffStop) {
  let best = null;
  for (const lane of lanes) {
    const fitted = fitFootprintToLane(lane, planeExtent);
    if (!fitted) continue;
    if (lane.depthSize - lane.usedDepth < depthExtent) continue;
    const top = lane.stack[lane.stack.length - 1];
    if (top && top.dropoffStop < dropoffStop) continue;
    const priority = top ? top.dropoffStop : Infinity;
    if (!best || priority < best.priority) best = { lane, fitted, priority };
  }
  return best ? { lane: best.lane, fitted: best.fitted } : null;
}

// Repli quand aucun couloir ne permet un accès garanti sans déplacement :
// pose quand même la caisse (dans le couloir le plus dégagé) plutôt que
// d'abandonner, mais l'appelant marque le résultat comme un conflit à
// signaler (il faudra déplacer une autre caisse à l'arrêt concerné).
function findLaneForcedPush(lanes, depthExtent, planeExtent) {
  let best = null;
  for (const lane of lanes) {
    const fitted = fitFootprintToLane(lane, planeExtent);
    if (!fitted) continue;
    if (lane.depthSize - lane.usedDepth < depthExtent) continue;
    if (!best || lane.usedDepth < best.lane.usedDepth) best = { lane, fitted };
  }
  return best;
}

// Retire une caisse de son couloir au moment de sa livraison. Si elle n'est
// plus au sommet (une caisse récupérée après elle occupe encore le couloir),
// c'est un vrai conflit physique : il faudra la déplacer temporairement pour
// atteindre celle qu'on veut sortir. On la retire quand même de la
// comptabilité (elle part réellement du vaisseau), mais le conflit est
// remonté pour être affiché.
function popFromLane(lane, item) {
  const idx = lane.stack.indexOf(item);
  if (idx === -1) return [];
  const blocking = lane.stack.slice(idx + 1);
  lane.stack.splice(idx, 1);
  lane.usedDepth -= item.depthExtent;
  return blocking;
}

// Simule le chargement/déchargement le long du trajet optimisé (voir
// js/app.js:buildCargoItemStopIndex) : chaque caisse est posée à l'arrêt où
// elle est réellement récupérée, dans un couloir qui ne bloquera personne
// avant sa propre livraison, puis retirée à l'arrêt où elle est livrée. Les
// livraisons d'un arrêt sont traitées avant les récupérations de ce même
// arrêt, pour réutiliser la place tout juste libérée. Renvoie :
// - placements : une entrée par caisse effectivement posée ({ module,
//   position, size, box, entry, pickupStop, dropoffStop, conflict }),
//   utilisable pour un instantané 3D à un arrêt donné (voir peakStepIndex).
// - unplaced : caisses n'ayant trouvé de place dans aucun module.
// - conflicts : livraisons où la caisse n'était plus accessible sans
//   déplacer une autre caisse récupérée après elle dans le même couloir.
// - peakStepIndex : l'arrêt où la charge totale est la plus importante,
//   pour n'afficher qu'un seul instantané représentatif plutôt que toute la
//   chronologie du trajet.
function simulateRoutePacking(cargoEntries, holds, stepCount) {
  const modules = holds.map((h) => ({
    hold: h,
    lanes: buildModuleLanes(cellsFromDimensions(h.dimensions)),
  }));
  const shipMaxContainerSize = holds.reduce((max, h) => Math.max(max, h.maxContainerSize || 32), 1);

  const boxes = [];
  cargoEntries.forEach((entry) => {
    if (entry.pickupStop == null || entry.dropoffStop == null) return;
    const cap = entry.maxCargoBoxSize
      ? Math.min(entry.maxCargoBoxSize, shipMaxContainerSize)
      : shipMaxContainerSize;
    decomposeIntoBoxes(entry.quantity, cap).forEach((box) => {
      boxes.push({ box, entry, pickupStop: entry.pickupStop, dropoffStop: entry.dropoffStop, placement: null });
    });
  });
  // Les plus grosses caisses d'abord à égalité de récupération : reste une
  // heuristique de remplissage raisonnable une fois l'ordre du trajet fixé.
  boxes.sort((a, b) => a.pickupStop - b.pickupStop || b.box.scu - a.box.scu);

  const unplaced = [];
  const conflicts = [];
  const loadAtStep = new Array(stepCount).fill(0);

  for (let step = 0; step < stepCount; step++) {
    boxes
      .filter((b) => b.dropoffStop === step && b.placement)
      .forEach((b) => {
        const blocking = popFromLane(b.placement.lane, b.placement);
        if (blocking.length) {
          conflicts.push({ box: b.box, entry: b.entry, blockedBy: blocking.map((x) => x.entry), atStep: step });
        }
      });

    boxes
      .filter((b) => b.pickupStop === step)
      .forEach((b) => {
        const { depthExtent, planeExtent } = orientForLanes(b.box.cells);
        let placedModule = null;
        let found = null;
        for (const m of modules) {
          if (m.hold.maxContainerSize && b.box.scu > m.hold.maxContainerSize) continue;
          found = findLaneForPush(m.lanes, depthExtent, planeExtent, b.dropoffStop);
          if (found) {
            placedModule = m;
            break;
          }
        }
        let conflict = false;
        if (!found) {
          for (const m of modules) {
            if (m.hold.maxContainerSize && b.box.scu > m.hold.maxContainerSize) continue;
            found = findLaneForcedPush(m.lanes, depthExtent, planeExtent);
            if (found) {
              placedModule = m;
              conflict = true;
              break;
            }
          }
        }
        if (!found) {
          unplaced.push({ box: b.box, entry: b.entry });
          return;
        }
        const { lane, fitted } = found;
        const item = {
          depthExtent,
          planeExtent: fitted,
          depthStart: lane.usedDepth,
          dropoffStop: b.dropoffStop,
          entry: b.entry,
          box: b.box,
          lane,
          hold: placedModule.hold,
          conflict,
        };
        lane.stack.push(item);
        lane.usedDepth += depthExtent;
        b.placement = item;
        // Le conflit ne se signale qu'une fois, au moment où il se fait
        // vraiment sentir (au retrait, plus bas) — le marquer aussi ici
        // ferait doublon pour la même paire caisse/blocage.
      });

    loadAtStep[step] = modules.reduce(
      (sum, m) => sum + m.lanes.reduce((s2, lane) => s2 + lane.stack.reduce((s3, it) => s3 + it.box.scu, 0), 0),
      0
    );
  }

  let peakStepIndex = 0;
  loadAtStep.forEach((v, i) => {
    if (v > loadAtStep[peakStepIndex]) peakStepIndex = i;
  });

  const placements = boxes
    .filter((b) => b.placement)
    .map((b) => {
      const { lane, depthExtent, planeExtent, depthStart, conflict, hold } = b.placement;
      const position = [0, 0, 0];
      const size = [1, 1, 1];
      position[lane.depthAxis] = depthStart;
      size[lane.depthAxis] = depthExtent;
      position[lane.planeAxes[0]] = lane.planeOrigin[0];
      position[lane.planeAxes[1]] = lane.planeOrigin[1];
      size[lane.planeAxes[0]] = planeExtent[0];
      size[lane.planeAxes[1]] = planeExtent[1];
      return {
        module: hold,
        position,
        size,
        box: b.box,
        entry: b.entry,
        pickupStop: b.pickupStop,
        dropoffStop: b.dropoffStop,
        conflict,
      };
    });

  return { placements, unplaced, conflicts, peakStepIndex };
}
