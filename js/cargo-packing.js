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
// taille est INFÉRIEURE OU ÉGALE à celle de la caisse du dessous (ex. deux
// caisses de 4 SCU peuvent se poser l'une sur l'autre ; une caisse de 4 SCU
// ne peut PAS se poser sur une caisse de 1 SCU) — spécifique au jeu, pas une
// simple histoire de tenir géométriquement dans l'empreinte. Confirmé par
// l'utilisateur : la règle avait été implémentée à l'envers ("strictement
// plus petite uniquement"), ce qui interdisait à tort deux caisses de même
// taille de s'empiler.
function canStackOn(newScu, baseScu) {
  return newScu <= baseScu;
}

// Une caisse ne peut jamais flotter : elle doit reposer au sol (z=0) ou avoir
// toute son empreinte directement soutenue par d'autres caisses juste en
// dessous (contact complet, pas de trou, taille autorisée par canStackOn, ET
// dont la date de livraison est ÉGALE OU POSTÉRIEURE à celle de la caisse du
// dessus) — sans cette dernière vérification, une caisse pourrait reposer
// sur une caisse qui repart plus tôt et se retrouver en l'air en cours de
// route sans qu'aucun conflit ne soit jamais détecté. z (index 2) est
// toujours l'axe vertical réel (voir cellsFromDimensions), indépendamment de
// l'axe d'accès choisi pour ce module (depthAxis). C'est cette règle,
// appliquée partout où une caisse peut en supporter une autre (pas seulement
// au sein d'un même contrat), qui rend l'empilement croisé entre contrats
// sûr (voir assignMissionZones).
function hasValidSupport(grid, pos, size, boxScu, dropoffStop) {
  const [px, py, pz] = pos;
  const [sx, sy] = size;
  if (pz === 0) return true;
  for (let x = px; x < px + sx; x++) {
    for (let y = py; y < py + sy; y++) {
      const below = grid[x][y][pz - 1];
      if (!below) return false;
      if (!canStackOn(boxScu, below.scu)) return false;
      if (below.dropoffStop < dropoffStop) return false;
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

// Une caisse bloque l'accès à une autre le long d'un AXE et d'une DIRECTION
// donnés si elle est plus proche de CETTE face précise ET que son emprise
// recoupe celle de l'autre sur les deux axes restants — il faudrait alors la
// déplacer temporairement pour atteindre celle qu'on veut sortir PAR CETTE
// FACE. direction "near" = accès par la coordonnée 0 de l'axe (arrière,
// dessous, gauche) ; "far" = accès par l'extrémité opposée (avant, dessus,
// droite) — voir docs/superpowers/specs/2026-07-17-ship-access-faces-design.md.
function isBlockingOnAxis(axis, direction, blockerPos, blockerSize, targetPos, targetSize) {
  if (direction === "near") {
    if (blockerPos[axis] >= targetPos[axis]) return false;
  } else {
    if (blockerPos[axis] + blockerSize[axis] <= targetPos[axis] + targetSize[axis]) return false;
  }
  for (let otherAxis = 0; otherAxis < 3; otherAxis++) {
    if (otherAxis === axis) continue;
    const aStart = blockerPos[otherAxis];
    const aEnd = aStart + blockerSize[otherAxis];
    const bStart = targetPos[otherAxis];
    const bEnd = bStart + targetSize[otherAxis];
    if (aEnd <= bStart || bEnd <= aStart) return false;
  }
  return true;
}

// Conservée pour compatibilité et lisibilité : le modèle historique à un
// seul axe est désormais un cas particulier (la face "arrière") de
// isBlockingOnAxis — comportement strictement identique à avant.
function isBlocking(depthAxis, blockerPos, blockerSize, targetPos, targetSize) {
  return isBlockingOnAxis(depthAxis, "near", blockerPos, blockerSize, targetPos, targetSize);
}

// Faces accessibles par défaut si le joueur n'a rien configuré pour ce
// vaisseau (voir state.shipAccessFaces dans js/app.js) : reproduit
// exactement l'ancien modèle à un seul axe (accès par l'arrière uniquement).
const DEFAULT_ACCESS_FACES = { back: true };

// Côté du vaisseau où se trouve une soute, déduit de son NOM. FleetYards
// n'expose aucune position, mais nomme explicitement le côté sur la moitié des
// soutes (142 sur 288, réparties sur 31 vaisseaux) : hardpoint_cargogrid_left,
// hardpoint_cargo_front_right, hardpoint_cargogrid_main_small_left...
// Renvoie "left", "right", ou null quand le nom ne dit rien (soute centrale ou
// unique) — dans ce cas les faces « intérieur » ne s'appliquent tout
// simplement pas à cette soute.
function moduleShipSide(hold) {
  const name = (hold && hold.name) || "";
  if (/(^|[_-])left($|[_-])/i.test(name)) return "left";
  if (/(^|[_-])right($|[_-])/i.test(name)) return "right";
  return null;
}

// Traduit les 6 étiquettes de faces (point de vue du joueur : arrière/avant/
// gauche/droite/dessus/dessous) vers les axes réels de CE module précis
// (depthAxis/widthAxis/heightAxis — calculés une fois par module, voir
// simulateRoutePacking et moduleAxes). Renvoie toujours les 6, quel que soit
// ce que le joueur a coché — le filtrage se fait dans accessibleFaceAxes.
// Note : cet étiquetage n'est fidèle à l'orientation réelle du vaisseau que
// lorsque depthAxis !== 2 — dans le cas rare où l'axe de profondeur d'un
// module EST l'axe vertical (une soute plus haute que longue), le repli
// pré-existant de moduleAxes échange largeur/hauteur, et moduleFaceAxes
// hérite de cet échange (les cases "dessus/dessous" du joueur pilotent alors
// en réalité une direction horizontale). Comportement inchangé, documenté
// seulement — ne concerne que la configuration explicite de faces non-
// défaut sur une soute de forme inhabituelle.
function moduleFaceAxes(module) {
  // Objects must be created with explicit prototype assignment to work with
  // deepStrictEqual across VM contexts in tests.
  const mkFace = (axis, direction) => {
    const obj = Object.create(Object.prototype);
    obj.axis = axis;
    obj.direction = direction;
    return obj;
  };
  const mapping = {
    back: mkFace(module.depthAxis, "near"),
    front: mkFace(module.depthAxis, "far"),
    bottom: mkFace(module.heightAxis, "near"),
    top: mkFace(module.heightAxis, "far"),
    left: mkFace(module.widthAxis, "near"),
    right: mkFace(module.widthAxis, "far"),
  };

  // Faces « intérieures » : le joueur se tient dans la coursive centrale et
  // décrit ce qu'il atteint à sa gauche et à sa droite. Une soute de bâbord
  // s'ouvre donc vers TRIBORD (sa face droite) et une soute de tribord vers
  // BÂBORD (sa face gauche) — c'est exactement ce qu'une case « gauche » ou
  // « droite » seule ne peut pas exprimer, puisque le côté à ouvrir change
  // d'une soute à l'autre sur le même vaisseau.
  //
  // Ne s'applique qu'aux soutes dont le nom identifie un côté (voir
  // moduleShipSide) : ailleurs, ces cases n'ont aucun effet.
  const side = moduleShipSide(module.hold);
  if (side === "left") mapping.interiorLeft = mapping.right;
  if (side === "right") mapping.interiorRight = mapping.left;
  return mapping;
}

// Liste des {axis, direction} correspondant aux faces cochées par le joueur
// pour ce vaisseau (ou DEFAULT_ACCESS_FACES si rien n'est configuré) — une
// entrée par face cochée, calculée UNE FOIS par module (pas par caisse), puis
// réutilisée pour toutes les caisses de ce module (voir simulateRoutePacking).
function accessibleFaceAxes(accessFaces, module) {
  const mapping = moduleFaceAxes(module);
  const filtered = Object.keys(mapping)
    .filter((face) => accessFaces && accessFaces[face])
    .map((face) => mapping[face]);
  // Repli sur DEFAULT_ACCESS_FACES pas seulement quand accessFaces est
  // falsy, mais aussi quand c'est un objet valide où AUCUNE face n'est cochée
  // (ex : {}) -- sinon le filtre ci-dessus renvoie une liste vide, et
  // isBlockedFromEveryAccessibleFace([].every(...)) devient vacuously true
  // pour toute paire de caisses (voir la régression documentée dans les
  // tests de ce fichier).
  if (filtered.length > 0) return filtered;
  return Object.keys(mapping)
    .filter((face) => DEFAULT_ACCESS_FACES[face])
    .map((face) => mapping[face]);
}

// Une caisse n'est réellement bloquée que si TOUTES les faces accessibles
// configurées sont obstruées — s'il en existe ne serait-ce qu'une seule
// dégagée, le joueur peut passer par là pour l'atteindre. Avec une seule face
// configurée (le cas par défaut), ce test est strictement équivalent à
// isBlocking.
function isBlockedFromEveryAccessibleFace(faceAxesList, blockerPos, blockerSize, targetPos, targetSize) {
  return faceAxesList.every(({ axis, direction }) =>
    isBlockingOnAxis(axis, direction, blockerPos, blockerSize, targetPos, targetSize)
  );
}

// Gravité d'un conflit potentiel pour une position donnée : la date de
// livraison la plus proche parmi les caisses avec lesquelles ça coincerait
// (dans un sens ou dans l'autre) — Infinity si aucun conflit. Utilisé par la
// fonction de score (voir scorePosition) pour transformer un blocage
// potentiel en pénalité : plus le conflit arrive tôt (livraison proche), plus
// il coûte cher, pour toujours préférer déplacer un blocage lointain plutôt
// qu'un blocage imminent quand aucune position n'est totalement sûre.
//
// Corrigé (Task 6bis) : un blocage n'est un risque QUE si le bloqueur (plus
// proche de l'accès) est encore présent au moment où la caisse qui doit
// sortir la première a besoin de partir — c'est-à-dire si le bloqueur part
// PLUS TARD que celle qu'il bloque (voir la boucle réelle de détection de
// conflit dans simulateRoutePacking : elle ne compte un blocage que si
// other.dropoffStop est postérieur au step de départ de la caisse bloquée).
// L'ancienne version comparait dans le sens inverse (`<` au lieu de `>`),
// ce qui pouvait faire scorer Infinity (sûr) une position réellement en
// conflit, et inversement — trouvé et confirmé lors de la Task 6 par
// exécution directe, pas seulement par lecture de code.
//
// faceAxesList est la liste des faces accessibles CONFIGURÉES POUR CE MODULE
// (voir accessibleFaceAxes) — une caisse n'est un risque que si BLOQUÉE PAR
// TOUTES les faces de cette liste (voir isBlockedFromEveryAccessibleFace) ;
// avec une seule face (le cas par défaut), ce comportement est strictement
// identique à l'ancien calcul à un seul axe.
function worstConflictDropoff(faceAxesList, activeBoxes, pos, size, dropoffStop) {
  let worst = Infinity;
  for (const other of activeBoxes) {
    if (
      isBlockedFromEveryAccessibleFace(faceAxesList, other.position, other.size, pos, size) &&
      other.dropoffStop > dropoffStop
    ) {
      worst = Math.min(worst, dropoffStop);
    }
    if (
      isBlockedFromEveryAccessibleFace(faceAxesList, pos, size, other.position, other.size) &&
      dropoffStop > other.dropoffStop
    ) {
      worst = Math.min(worst, other.dropoffStop);
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
// arbitraire. restriction, si fourni ({ axis, allowed: Set }), restreint la
// recherche sur UN axe donné à la zone réservée au contrat de cette caisse
// (voir assignMissionZones — la zone restreint désormais l'axe de VOIE, pas
// forcément l'axe de profondeur). missionId sert au niveau 4 (regroupement
// du contrat, voir isBetterPosition). idealDepth est une profondeur ABSOLUE
// déjà calculée par l'appelant (voir simulateRoutePacking) — PAS une
// fraction du module entier : dans une zone dédiée à un contrat, ce qui
// compte est le RANG relatif de cette caisse parmi les SIENNES (celles du
// même contrat), pas sa date de livraison rapportée à la longueur du trajet
// entier. Une fraction globale, une fois bornée dans une zone étroite, peut
// faire tomber deux caisses d'un même contrat sur la MÊME profondeur idéale
// alors que la zone a largement la place de les séparer selon leur ordre
// réel de sortie — observé : une caisse bloquant une autre caisse de SA
// PROPRE mission (Hydrogen bloqué par Hydrogen de la même mission M4) alors
// que rien d'un autre contrat n'était en cause.
function findBestPosition(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, idealDepth, restriction, missionId, faceAxes) {
  // Repli sur l'ancien modèle à un seul axe si l'appelant ne précise rien
  // (compatibilité stricte — aucun appel existant ne doit changer de
  // comportement sans fournir explicitement faceAxes).
  const effectiveFaceAxes = faceAxes || [{ axis: depthAxis, direction: "near" }];
  const orientations = boxOrientations(box);
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  const zIsPlaneAxis = planeAxes.includes(2);
  const outerPlaneAxis = zIsPlaneAxis ? 2 : planeAxes[0];
  const innerPlaneAxis = zIsPlaneAxis ? planeAxes.find((axis) => axis !== 2) : planeAxes[1];

  const range = (size) => Array.from({ length: size }, (_, i) => i);
  const restrictions = restriction ? (Array.isArray(restriction) ? restriction : [restriction]) : [];
  const restrict = (axis, values) => {
    const r = restrictions.find((r) => r.axis === axis);
    return r ? values.filter((v) => r.allowed.has(v)) : values;
  };
  const depths = restrict(depthAxis, range(cellDims[depthAxis]));
  const outers = restrict(outerPlaneAxis, range(cellDims[outerPlaneAxis]));
  const inners = restrict(innerPlaneAxis, range(cellDims[innerPlaneAxis]));

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
          if (!hasValidSupport(grid, pos, size, box.scu, dropoffStop)) continue;

          // Barrière dure d'un véhicule garé (brique A) : une position que
          // l'obstacle réservé bloque par TOUTES les faces accessibles est
          // refusée (l'espace derrière lui est inutilisable — décision
          // utilisateur), contrairement au score de sévérité qui ne fait que
          // classer des positions autorisées. Réutilise le prédicat d'accès
          // existant, sans le modifier.
          if (
            activeBoxes.some(
              (ab) =>
                ab.reserved &&
                isBlockedFromEveryAccessibleFace(effectiveFaceAxes, ab.position, ab.size, pos, size)
            )
          )
            continue;

          const candidate = {
            position: pos.slice(),
            size,
            severity: worstConflictDropoff(effectiveFaceAxes, activeBoxes, pos, size, dropoffStop),
            // Distance mesurée en CRANS DE CAISSE, pas en cellules. La
            // profondeur idéale avance continûment (rang i/n × profondeur du
            // module), donc bien plus finement que l'encombrement réel d'une
            // caisse : deux caisses successives visaient 0,30 et 0,61 dans un
            // module où elles occupent 2 crans chacune, et se plaçaient donc
            // à des profondeurs DÉCALÉES D'UN CRAN au lieu de s'aligner.
            // D'où un rangement en quinconce qui fragmente l'espace — mesuré :
            // 3 caisses à chacune des profondeurs 0 à 6 au lieu de 6 caisses
            // aux profondeurs 0, 2, 4 et 6, soit 84 cellules occupées sur 96.
            //
            // En comparant les rangs de caisse, toutes les positions d'un même
            // cran deviennent équivalentes pour ce critère, et ce sont les
            // critères de compacité (parois, voisins) qui départagent — sans
            // rien perdre de l'ordonnancement par date de sortie, qui reste
            // exact d'un cran à l'autre.
            depthDistance:
              idealDepth != null
                ? Math.abs(Math.floor(d / size[depthAxis]) - Math.floor(idealDepth / size[depthAxis]))
                : 0,
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
      // Même barrière dure qu'en findBestPosition : ne pas empiler à un endroit
      // que le véhicule garé rend inaccessible par toutes les faces. En
      // pratique la caisse-base a déjà passé la garde et l'empilement partage
      // son empreinte horizontale ; on la remet par cohérence/robustesse.
      if (
        m.activeBoxes.some(
          (ab) =>
            ab.reserved &&
            isBlockedFromEveryAccessibleFace(m.faceAxes, ab.position, ab.size, pos, size)
        )
      )
        continue;
      if (canPlace(m.grid, m.cellDims, pos, size) && hasValidSupport(m.grid, pos, size, box.scu, dropoffStop)) {
        markPlaced(m.grid, pos, size, { dropoffStop, scu: box.scu, missionId });
        if (m.layerUsage) bumpLayerUsage(m.layerUsage, m.depthAxis, pos, size, 1);
        return { module: m, position: pos, size };
      }
    }
  }
  return null;
}

// Réserve à chaque contrat (mission) sa/ses propre(s) zone(s) 3D AVANT même
// de commencer à ranger quoi que ce soit : le trajet entier est déjà connu
// (quantités, tailles, dates de récup/livraison de TOUTES les marchandises),
// ce n'est pas un vrai flux en ligne — voir le principe général dans
// docs/superpowers/specs/2026-07-16-cargo-packing-rewrite-design.md.
//
// Tier 1 (cette fonction, sans le tier 2 — voir Task 4) : découpe chaque
// module en VOIES le long de l'axe latéral le plus large (widthAxis), PAS le
// long de l'axe de profondeur — chaque voie garde TOUTE la profondeur ET
// TOUTE la hauteur du module pour ce contrat. Découper par tranches de
// profondeur entières gaspillait la plupart de la capacité réelle d'un
// vaisseau (un cran de profondeur ENTIER par contrat, bien plus que
// nécessaire) ; découper par largeur laisse à chaque contrat de quoi étaler
// ses propres caisses selon leur ordre de sortie (voir missionBoxRank).
//
// Renvoie une Map missionId -> [{ module, widthAxis, heightAxis, widthStart,
// widthEnd, heightStart, heightEnd, minPickupStop, maxDropoffStop }, ...]
// (une zone par tranche de largeur réservée ; plusieurs zones si le contrat
// ne tient pas dans un seul module). Prend les caisses déjà décomposées (pas
// les lignes de cargaison brutes) pour connaître la vraie empreinte de
// chacune.
function moduleAxes(cellDims, depthAxis) {
  const planeAxes = [0, 1, 2].filter((i) => i !== depthAxis);
  // Z (index 2) est toujours l'axe vertical réel — sert de hauteur, sauf
  // dans le cas rare où l'axe de profondeur choisi EST déjà Z (module plus
  // haut que long) : on retombe alors sur "le plus grand des deux axes
  // restants = largeur".
  if (depthAxis !== 2) return { widthAxis: planeAxes.find((a) => a !== 2), heightAxis: 2 };
  const [a, b] = planeAxes;
  return cellDims[a] >= cellDims[b] ? { widthAxis: a, heightAxis: b } : { widthAxis: b, heightAxis: a };
}

function assignMissionZones(boxes, modules) {
  const missionNeed = new Map();
  boxes.forEach((b) => {
    const missionId = b.entry.mission && b.entry.mission.id;
    if (missionId == null) return; // pas de contrat identifiable : pas de zone dédiée, recherche libre à l'exécution.
    const cur = missionNeed.get(missionId) || {
      mission: b.entry.mission,
      totalScu: 0,
      minFootprintNeeded: 1,
      minPickupStop: b.pickupStop,
      maxDropoffStop: b.dropoffStop,
    };
    cur.totalScu += b.box.scu;
    // Une caisse ne peut pivoter qu'à plat (voir boxOrientations) : sa PLUS
    // PETITE dimension d'empreinte est le minimum de crans qu'il lui faut
    // d'un coup sur l'axe de largeur, quelle que soit l'orientation choisie.
    const minFootprint = Math.min(b.box.footprint[0], b.box.footprint[1]);
    if (minFootprint > cur.minFootprintNeeded) cur.minFootprintNeeded = minFootprint;
    if (b.pickupStop < cur.minPickupStop) cur.minPickupStop = b.pickupStop;
    if (b.dropoffStop > cur.maxDropoffStop) cur.maxDropoffStop = b.dropoffStop;
    missionNeed.set(missionId, cur);
  });

  // loEdge/hiEdge : bornes encore libres de chaque module SUR L'AXE DE
  // LARGEUR, DES DEUX CÔTÉS (pas juste un pointeur qui avance depuis un
  // bord) — un premier contrat dans un module prend un côté (lo), le
  // suivant l'autre (hi), en alternance.
  const moduleState = modules.map((m) => {
    const { widthAxis, heightAxis } = moduleAxes(m.cellDims, m.depthAxis);
    return {
      module: m,
      widthAxis,
      heightAxis,
      laneCapacity: m.cellDims[m.depthAxis] * m.cellDims[heightAxis],
      loEdge: 0,
      hiEdge: m.cellDims[widthAxis],
      maxWidth: m.cellDims[widthAxis],
      nextSide: "lo",
    };
  });

  // Les plus gros contrats d'abord : leur donne la première chance de tenir
  // entiers dans un seul module plutôt que d'être scindés inutilement.
  const missionsSorted = [...missionNeed.values()].sort((a, b) => b.totalScu - a.totalScu);
  const zonesByMission = new Map();
  const allZones = []; // toutes les zones déjà attribuées (tier 1 et tier 2), dans l'ordre, pour servir d'hôtes potentiels au tier 2.

  missionsSorted.forEach(({ mission, totalScu, minFootprintNeeded, minPickupStop, maxDropoffStop }, missionIndex) => {
    let remaining = totalScu;
    const zones = [];
    while (remaining > 0.0001) {
      const openModules = moduleState.filter((ms) => ms.hiEdge - ms.loEdge > 0);
      if (!openModules.length) {
        // Tier 2 : plus de voie libre, cherche un hôte déjà placé (n'importe
        // quelle mission, tier 1 ou déjà empilée en tier 2) dont la fenêtre de
        // présence contient ENTIÈREMENT celle du contrat courant. Sûr
        // uniquement parce que l'hôte est garanti présent pendant tout le
        // séjour de l'invité — mais cette réservation ne garantit QUE la
        // sécurité temporelle, pas une capacité physique précise (le zonage
        // se fait avant tout placement réel de caisse, voir le principe de
        // planification statique). L'invité reprend donc EXACTEMENT
        // l'empreinte spatiale de l'hôte (même largeur, même hauteur) plutôt
        // qu'une sous-plage de hauteur découpée au-dessus : la non-collision
        // réelle est assurée plus tard, caisse par caisse, par
        // canPlace (occupation de grille) et hasValidSupport (règle de
        // taille + sécurité temporelle, voir Task 2) — une caisse de
        // l'invité ne peut occuper qu'une cellule libre, et ne peut reposer
        // que sur une caisse de l'hôte qui reste au moins aussi longtemps.
        // Si le besoin réel de l'invité ne tient finalement pas dans cette
        // empreinte partagée, il retombe sur la recherche ville-entière de
        // dernier recours (Task 6), exactement comme prévu par la conception.
        const host = allZones.find(
          (z) => z.minPickupStop <= minPickupStop && z.maxDropoffStop >= maxDropoffStop
        );
        if (!host) break; // Vraiment plus de place : le repli en recherche libre (Task 6) prendra le relais.

        const zone = {
          module: host.module,
          widthAxis: host.widthAxis,
          heightAxis: host.heightAxis,
          widthStart: host.widthStart,
          widthEnd: host.widthEnd,
          heightStart: host.heightStart,
          heightEnd: host.heightEnd,
          minPickupStop,
          maxDropoffStop,
        };
        zones.push(zone);
        allZones.push(zone);
        // On ne peut pas mesurer la capacité réellement libre dans
        // l'empreinte de l'hôte à ce stade (elle dépend du placement réel
        // des caisses, résolu par Task 5) : on considère le besoin de ce
        // contrat comme couvert par CETTE zone unique, quitte à ce que
        // Task 5/6 découvrent qu'il n'y a en réalité pas assez de place et
        // fassent remonter l'excédent vers la recherche de dernier recours.
        remaining = 0;
        continue;
      }

      const freeCapOf = (ms) => (ms.hiEdge - ms.loEdge) * ms.laneCapacity;
      const isFresh = (ms) => ms.loEdge === 0 && ms.hiEdge === ms.maxWidth;

      // PREMIÈRE soute qui convient, dans l'ordre où le vaisseau les déclare —
      // et non celle dont la capacité colle au plus juste. Le « au plus juste »
      // est optimal sur le papier mais illisible en soute : sur 900 SCU
      // d'Ironclad il remplissait front_left, sautait à rear_left parce que
      // sa capacité tombait mieux, puis revenait déposer 36 SCU dans
      // front_right. Trois soutes là où deux suffisent, dans un ordre que
      // personne ne suivrait en chargeant. On remplit donc dans l'ordre.
      let bestFit = null;
      openModules.forEach((ms) => {
        if (bestFit || !isFresh(ms)) return;
        const freeCap = freeCapOf(ms);
        if (freeCap >= remaining) bestFit = { ms, freeCap };
      });
      if (!bestFit) {
        openModules.forEach((ms) => {
          if (bestFit || isFresh(ms)) return;
          const freeCap = freeCapOf(ms);
          if (freeCap >= remaining) bestFit = { ms, freeCap };
        });
      }
      const ms =
        bestFit?.ms ||
        openModules.reduce((best, cur) => {
          const curFresh = isFresh(cur) ? 1 : 0;
          const bestFresh = isFresh(best) ? 1 : 0;
          if (curFresh !== bestFresh) return curFresh > bestFresh ? cur : best;
          return freeCapOf(cur) > freeCapOf(best) ? cur : best;
        });

      const freeWidth = ms.hiEdge - ms.loEdge;
      // La voie se compte en LARGEURS DE CAISSE, pas en cellules brutes. Une
      // caisse ne pivotant qu'à plat, il lui faut minFootprintNeeded crans
      // d'un coup sur l'axe de largeur : une voie de 5 crans pour des caisses
      // de 2 n'en accueille que 2 côte à côte, et le 5e cran est perdu sur
      // TOUTE la longueur et TOUTE la hauteur du module.
      //
      // Signalé par un joueur sur son Ironclad (soutes de 6 crans de large,
      // caisses de 32 SCU larges de 2) : ceil(515 / 120) donnait une voie de
      // 5, d'où une colonne vide contre la paroi. C'est le « il laisse
      // toujours un espace vide » — pas un défaut de placement, un défaut de
      // découpage de la zone.
      const grain = Math.max(1, minFootprintNeeded);
      const parVolume = Math.max(minFootprintNeeded, Math.ceil(remaining / ms.laneCapacity));
      const arrondi = Math.min(freeWidth, Math.ceil(parVolume / grain) * grain);
      // Arrondir prive forcément le reste du module de la largeur ajoutée :
      // on ne le fait que si ça ne vole pas à un AUTRE contrat sa dernière
      // bande utilisable. Sans ce garde-fou, le premier contrat servi rafle
      // toute la largeur et les suivants doivent s'empiler dessus — mesuré
      // sur la fixture Host/Big : 0 conflit -> 2.
      const contratsRestants = missionsSorted.length - 1 - missionIndex;
      // Plus aucun contrat à servir après celui-ci : rien ne justifie de lui
      // mesurer la largeur. Lui laisser sa voie au volume strict abandonnait
      // une colonne contre la paroi qui ne profitait à personne — signalé sur
      // un Ironclad avec un seul contrat de 452 SCU : voie de 4 crans sur 6,
      // 2 crans vides sur toute la longueur et toute la hauteur.
      const neededWidth =
        contratsRestants === 0
          ? freeWidth
          : freeWidth - arrondi >= grain
            ? arrondi
            : Math.min(freeWidth, parVolume);
      const side = ms.nextSide;
      ms.nextSide = side === "lo" ? "hi" : "lo";

      let widthStart, widthEnd;
      if (side === "lo") {
        widthStart = ms.loEdge;
        widthEnd = ms.loEdge + neededWidth;
        ms.loEdge = widthEnd;
      } else {
        widthEnd = ms.hiEdge;
        widthStart = ms.hiEdge - neededWidth;
        ms.hiEdge = widthStart;
      }
      const zone = {
        module: ms.module,
        widthAxis: ms.widthAxis,
        heightAxis: ms.heightAxis,
        widthStart,
        widthEnd,
        heightStart: 0,
        heightEnd: ms.module.cellDims[ms.heightAxis],
        minPickupStop,
        maxDropoffStop,
      };
      zones.push(zone);
      allZones.push(zone);
      remaining -= neededWidth * ms.laneCapacity;
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
// sur le premier module testé pour ce deuxième cas. idealDepthForModule(m)
// calcule la profondeur idéale ABSOLUE pour CE module précis (peut varier
// d'un module à l'autre selon leurs dimensions respectives, ou selon la zone
// du contrat dans ce module précis — voir simulateRoutePacking).
function placeInBestModule(candidateModules, box, dropoffStop, idealDepthForModule, restrictionForModule, missionId) {
  let worstCaseBest = null;
  for (const m of candidateModules) {
    const restriction = restrictionForModule ? restrictionForModule(m) : null;
    const idealDepth = idealDepthForModule ? idealDepthForModule(m) : null;
    const result = findBestPosition(m.grid, m.cellDims, box, m.depthAxis, dropoffStop, m.activeBoxes, m.layerUsage, idealDepth, restriction, missionId, m.faceAxes);
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
// Valeur sentinelle occupant une cellule réservée à un véhicule garé (brique
// A). Non nulle -> canPlace la rejette comme occupée. Sans .scu ni .dropoffStop
// (contrairement à une vraie caisse) : si elle atteignait par erreur
// canStackOn/hasValidSupport, `<= undefined` renvoie false -> refus sûr. La
// réservation étant pleine hauteur, aucune cellule n'existe au-dessus d'elle,
// donc ce cas ne se produit pas — la sentinelle est une ceinture-bretelle.
// Clé désambiguïsée d'un module — RÉPLIQUE EXACTE de moduleKey dans
// js/cargo-viewer.js (module ES, non importable ici). Les deux côtés (rendu et
// rangement) doivent la calculer identiquement pour un même `holds`, sinon une
// réservation posée sur une soute ne serait pas retrouvée par le packer. À
// garder synchronisée avec le visualiseur (duplication assumée, cf. CLAUDE.md).
function moduleKey(hold, holds) {
  const name = hold.name || "";
  const sameName = holds.filter((h) => (h.name || "") === name);
  if (sameName.length <= 1) return name;
  return `${name}#${sameName.indexOf(hold)}`;
}

const RESERVED_CELL = { reserved: true };

// Valide et normalise la LISTE de réservations d'un module (une empreinte par
// véhicule garé). Lue sous la clé désambiguïsée moduleKey (soutes homonymes
// indépendantes). Renvoie un tableau des empreintes valides ({x0,y0,sx,sy}) ;
// [] si aucune. Le packer ne fait jamais confiance à son entrée : une empreinte
// hors module, de taille nulle/négative, ou non entière, est écartée (pas de
// plantage). Une valeur non-tableau (clé absente, forme inattendue) -> [].
function resolveReservations(reservations, hold, holds, cellDims) {
  if (!reservations) return [];
  const list = reservations[moduleKey(hold, holds)];
  if (!Array.isArray(list)) return [];
  // Entier fini sans dépendre de `Number` (contexte vm restreint) : `v*0===0`
  // écarte Infinity/NaN, `Math.floor(v)===v` exige l'entier.
  const isCell = (v) => typeof v === "number" && v * 0 === 0 && Math.floor(v) === v;
  const out = [];
  for (const r of list) {
    if (!r) continue;
    const { x0, y0, sx, sy } = r;
    if (![x0, y0, sx, sy].every(isCell)) continue;
    if (sx < 1 || sy < 1 || x0 < 0 || y0 < 0) continue;
    if (x0 + sx > cellDims[0] || y0 + sy > cellDims[1]) continue;
    out.push({ x0, y0, sx, sy });
  }
  return out;
}

function simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces, reservations) {
  const modules = holds.map((h) => {
    const cellDims = cellsFromDimensions(h.dimensions);
    const depthAxis = depthAxisIndex(cellDims);
    const { widthAxis, heightAxis } = moduleAxes(cellDims, depthAxis);
    const module = {
      hold: h,
      cellDims,
      grid: createOccupancyGrid(cellDims),
      depthAxis,
      widthAxis,
      heightAxis,
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
    // Faces accessibles configurées par le joueur pour ce vaisseau (ou
    // DEFAULT_ACCESS_FACES si rien n'est configuré), traduites une seule fois
    // vers les axes réels de CE module (voir accessibleFaceAxes) — réutilisé
    // pour toutes les caisses de ce module.
    module.faceAxes = accessibleFaceAxes(accessFaces, module);
    // Sens de lecture de la profondeur. La profondeur idéale d'une caisse était
    // toujours comptée depuis le cran 0, comme si la porte se trouvait
    // forcément à l'arrière. En déclarant un accès par l'avant, l'ordre de
    // chargement se retrouvait donc inversé : les petites caisses au fond et
    // les grosses côté porte, alors qu'on charge les grosses en premier — elles
    // entrent au fond — et les petites en dernier, à portée de la porte.
    //
    // On ne bascule que si TOUTES les faces d'accès de l'axe de profondeur sont
    // à l'extrémité opposée : si le joueur déclare les deux bouts, l'un vaut
    // l'autre et l'ordre historique convient.
    const facesProfondeur = module.faceAxes.filter((f) => f.axis === module.depthAxis);
    module.depthAccessAtFar = facesProfondeur.length > 0 && facesProfondeur.every((f) => f.direction === "far");
    // Zones réservées à des véhicules garés (brique A′) : 0..N obstacles
    // permanents pleine hauteur par module. Chacun pré-marque ses cellules
    // (rien ne s'y range) ET s'injecte dans activeBoxes comme obstacle qui ne
    // part jamais (dropoffStop=Infinity), pour la garde dure d'accès de
    // findBestPosition/tryStackOnExisting (inchangée : elle fait some(reserved)).
    resolveReservations(reservations, h, holds, cellDims).forEach(({ x0, y0, sx, sy }) => {
      const size = [sx, sy, cellDims[2]];
      markPlaced(module.grid, [x0, y0, 0], size, RESERVED_CELL);
      // Pas de mise à jour de usedCells : ce compteur suit les caisses rangées,
      // pas l'espace physiquement indisponible.
      module.activeBoxes.push({
        position: [x0, y0, 0],
        size,
        dropoffStop: Infinity, // jamais retiré (aucun step === Infinity)
        reserved: true,
      });
    });
    return module;
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
  // aurait dû avoir sa propre soute. Découpe désormais par LARGEUR (voies),
  // pas par tranches de profondeur : chaque contrat garde toute la
  // profondeur du module pour étaler ses propres caisses, donc un seul
  // module peut désormais accueillir bien plus de contrats à la fois qu'avec
  // l'ancien découpage par profondeur (qui coûtait un cran de profondeur
  // ENTIER par contrat) — plus besoin de désactiver le zonage dès qu'il y a
  // plus de contrats que de modules.
  const zonesByMission = assignMissionZones(boxes, modules);

  // Rang de chaque caisse PARMI CELLES DE SON PROPRE CONTRAT, triées par date
  // de livraison (0 = part la première, 1 = part la dernière) — sert à cibler
  // une profondeur idéale À L'INTÉRIEUR de la zone réservée au contrat (voir
  // plus bas), PAS une fraction de la longueur totale du trajet. Une fraction
  // globale, une fois bornée dans une zone étroite, peut faire tomber deux
  // caisses du MÊME contrat sur la même profondeur idéale alors que leur zone
  // a largement la place de les séparer selon leur ordre réel de sortie —
  // c'était la cause des conflits observés d'une caisse contre une autre
  // caisse de SA PROPRE mission, sans qu'aucun autre contrat ne soit en cause.
  const missionBoxRank = new Map();
  const boxesByMission = new Map();
  boxes.forEach((b) => {
    const mid = b.entry.mission && b.entry.mission.id;
    if (mid == null) return;
    if (!boxesByMission.has(mid)) boxesByMission.set(mid, []);
    boxesByMission.get(mid).push(b);
  });
  boxesByMission.forEach((list) => {
    const sorted = list.slice().sort((a, b) => a.dropoffStop - b.dropoffStop || a.box.scu - b.box.scu);
    sorted.forEach((b, i) => missionBoxRank.set(b, sorted.length > 1 ? i / (sorted.length - 1) : 0));
  });

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
            isBlockedFromEveryAccessibleFace(m.faceAxes, other.placement.position, other.placement.size, b.placement.position, b.placement.size)
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
          const eligibleZones = zones.filter(
            (z) => !(z.module.hold.maxContainerSize && b.box.scu > z.module.hold.maxContainerSize)
          );
          // Profondeur idéale = rang de CETTE caisse parmi celles du MÊME
          // contrat, rapporté à TOUTE la profondeur du module (disponible en
          // entier dans sa zone — pas la fraction du trajet entier, voir
          // missionBoxRank plus haut).
          const rankFrac = missionBoxRank.get(b) ?? dropoffFrac;
          // Mesurée DEPUIS LA FACE D'ACCÈS, pas depuis le cran 0 (voir
          // depthAccessAtFar) : rang 0 = au plus près de la porte.
          const idealDepthForZone = (z) => {
            const maxDepthIdx = z.module.cellDims[z.module.depthAxis] - 1;
            if (maxDepthIdx <= 0) return 0;
            const depuisAcces = rankFrac * maxDepthIdx;
            return z.module.depthAccessAtFar ? maxDepthIdx - depuisAcces : depuisAcces;
          };
          // IMPORTANT : un contrat peut avoir PLUSIEURS zones DANS LE MÊME
          // module (une voie tier 1 partielle, puis un empilement tier 2
          // ailleurs dans ce même module une fois la voie épuisée). Fusionner
          // leurs plages largeur/hauteur dans une seule restriction (union
          // des largeurs, union des hauteurs, filtrées indépendamment par
          // findBestPosition) serait FAUX : ça autoriserait une position qui
          // combine la largeur d'une zone avec la hauteur d'une AUTRE zone,
          // un rectangle qui n'a jamais été réservé (et qui peut appartenir à
          // un autre contrat). Chaque zone est donc essayée SÉPARÉMENT — un
          // appel à findBestPosition par zone, jamais fusionnée avec une
          // autre — et seule la meilleure position parmi TOUTES les zones
          // (tous modules confondus) est retenue, via la même comparaison
          // hiérarchique `isBetterPosition` déjà utilisée partout ailleurs
          // dans ce fichier (jamais un score additif, voir son commentaire).
          // `restriction`/`restrict()` (dans findBestPosition) ne filtrent que
          // la coordonnée de DÉPART d'une caisse sur un axe donné, jamais son
          // étendue complète (les plages depths/outers/inners sont calculées
          // AVANT de savoir quelle orientation — donc quelle taille — sera
          // essayée). Une caisse dont une orientation est plus large que sa
          // propre zone sur l'axe de largeur ou de hauteur pourrait donc
          // démarrer dans la zone réservée mais déborder dans une zone
          // VOISINE (potentiellement celle d'un autre contrat) : le seul
          // rempart est alors canPlace(), qui ne rejette que les cellules
          // déjà occupées à CET instant — pas encore par le contrat voisin,
          // s'il n'a pas encore rien posé. Observé concrètement : une caisse
          // unique de 32 SCU (empreinte 2x8) dans une zone large de 2 cases
          // choisissait l'orientation large (8 de large) plutôt qu'étroite (2
          // de large) car elle touche plus de parois (critère de niveau 5 de
          // isBetterPosition), et bloquait ensuite le chargement d'un autre
          // contrat placé plus tard dans SA zone (colonnes 6-7 du même
          // module). Pour garantir un confinement réel sans toucher
          // findBestPosition, on bloque temporairement — le temps de cet
          // appel seulement — toutes les cellules du module situées EN DEHORS
          // du rectangle largeur×hauteur réservé (profondeur entière, elle,
          // toujours disponible pour ce contrat) : canPlace() rejette alors
          // naturellement toute orientation qui déborderait. Les cellules
          // déjà occupées par une vraie caisse ne sont pas touchées (elles
          // bloquent déjà canPlace de toute façon) — seules les cellules
          // libres sont temporairement marquées, puis restaurées à `null`
          // juste après l'appel.
          const confineToZone = (z) => {
            const m = z.module;
            const [dx, dy, dz] = m.cellDims;
            const touched = [];
            for (let x = 0; x < dx; x++) {
              for (let y = 0; y < dy; y++) {
                for (let zc = 0; zc < dz; zc++) {
                  const coord = [x, y, zc];
                  const insideWidth = coord[z.widthAxis] >= z.widthStart && coord[z.widthAxis] < z.widthEnd;
                  const insideHeight = coord[z.heightAxis] >= z.heightStart && coord[z.heightAxis] < z.heightEnd;
                  if (insideWidth && insideHeight) continue;
                  if (m.grid[x][y][zc] == null) {
                    m.grid[x][y][zc] = true; // marqueur temporaire (jamais interprété comme une vraie caisse ailleurs, retiré avant toute autre utilisation de la grille)
                    touched.push([x, y, zc]);
                  }
                }
              }
            }
            return () => touched.forEach(([x, y, zc]) => (m.grid[x][y][zc] = null));
          };
          let best = null; // { module, candidate } où candidate = résultat de findBestPosition (position + critères de tri)
          eligibleZones.forEach((z) => {
            const m = z.module;
            const widthValues = Array.from({ length: z.widthEnd - z.widthStart }, (_, i) => z.widthStart + i);
            const heightValues = Array.from({ length: z.heightEnd - z.heightStart }, (_, i) => z.heightStart + i);
            const restriction = [
              { axis: z.widthAxis, allowed: new Set(widthValues) },
              { axis: z.heightAxis, allowed: new Set(heightValues) },
            ];
            const restore = confineToZone(z);
            const candidate = findBestPosition(
              m.grid,
              m.cellDims,
              b.box,
              m.depthAxis,
              b.dropoffStop,
              m.activeBoxes,
              m.layerUsage,
              idealDepthForZone(z),
              restriction,
              missionId,
              m.faceAxes
            );
            restore();
            if (candidate && (!best || isBetterPosition(candidate, best.candidate))) {
              best = { module: m, candidate };
            }
          });
          if (best) {
            markPlaced(best.module.grid, best.candidate.position, best.candidate.size, {
              dropoffStop: b.dropoffStop,
              scu: b.box.scu,
              missionId,
            });
            bumpLayerUsage(best.module.layerUsage, best.module.depthAxis, best.candidate.position, best.candidate.size, 1);
            placed = { module: best.module, position: best.candidate.position, size: best.candidate.size };
          }
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
          // Un obstacle réservé (véhicule garé, missionId absent) ne rend PAS un
          // module « occupé par un autre contrat » : il est neutre vis-à-vis du
          // regroupement, d'où `a.reserved ||`. Sans ça, un module réservé mais
          // par ailleurs vide serait trié comme s'il appartenait à autrui.
          const isCompatible = (m) =>
            m.activeBoxes.length === 0 || m.activeBoxes.every((a) => a.reserved || a.missionId === missionId);
          const byFreeSpace = modules
            .slice()
            .filter((m) => !(m.hold.maxContainerSize && b.box.scu > m.hold.maxContainerSize))
            .sort((a, b2) => {
              const ac = isCompatible(a) ? 0 : 1;
              const bc = isCompatible(b2) ? 0 : 1;
              if (ac !== bc) return ac - bc;
              return a.usedCells - b2.usedCells;
            });
          const idealDepthForModule = (m) => {
            const maxDepthIdx = m.cellDims[m.depthAxis] - 1;
            if (maxDepthIdx <= 0) return 0;
            const depuisAcces = dropoffFrac * maxDepthIdx;
            return m.depthAccessAtFar ? maxDepthIdx - depuisAcces : depuisAcces;
          };
          placed = placeInBestModule(byFreeSpace, b.box, b.dropoffStop, idealDepthForModule, null, missionId);
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
