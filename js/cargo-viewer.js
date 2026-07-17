// =========================================================================
// Vue 3D interactive du rangement de cargo (module ES, contrairement au
// reste de l'appli en scripts classiques — Three.js n'est plus distribué
// qu'en modules) : un vaisseau réparti en plusieurs modules de soute (voir
// js/fleetyards.js) est affiché en caissons filaires, avec les caisses
// effectivement rangées (voir js/cargo-packing.js) dedans en solide, coloré
// par mission. Trois niveaux de disposition selon ce que FleetYards fournit
// pour ce vaisseau : (1) offset réel et fiable (unique parmi les modules du
// vaisseau, ex. Hull B) -> position exacte ; (2) pas d'offset fiable mais le
// nom du hardpoint donne au moins un indice avant/arrière/gauche/droite/
// haut/bas (ex. Ironclad, qui n'a AUCUN offset FleetYards du tout) -> grille
// reconstruite à partir de ces mots-clés (voir parsePositionHint) ; (3)
// vraiment aucune info -> rangée plate, comme avant. Cette reconstruction
// reste une supposition, pas une donnée exacte : le joueur peut corriger
// l'étiquetage avant/arrière/gauche/droite (bouton "Tourner", voir
// currentOrientation) sans que la géométrie affichée ne bouge.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const UNIT = 1.25; // 1 cran de grille = 1,25 m (voir js/cargo-packing.js)
const MODULE_GAP = 1.5; // espace entre modules affichés côte à côte, en mètres

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let animating = false;
let contentGroup = null;
// Volume englobant de la dernière scène rendue (repère Front/Rear/Left/Right
// ci-dessous, purement relatif à cette vue — pas l'orientation réelle du
// vaisseau, inconnue faute de donnée FleetYards à ce sujet) — utilisé pour
// caler les étiquettes et les vues préréglées (voir setCargoViewerView).
let sceneBounds = null;
// Signature de la dernière scène cadrée automatiquement (voir
// renderCargoViewer3D) : ne recadrer que quand ça change réellement de
// taille (nouveau vaisseau), pas à chaque navigation d'étape.
let lastFrameKey = null;
// Rotation courante des étiquettes Avant/Arrière/Gauche/Droite (0-3, par pas
// de 90°) — mémorisée ici pour que setCargoViewerView (déclenchée par les
// boutons "Vue avant/etc", séparément de renderCargoViewer3D) sache vers
// quelle direction physique de la scène pointer. Voir rotateForLabel/
// labelForPhysSlot ci-dessous : la géométrie ne bouge jamais, seule
// l'étiquette affichée à chaque coin tourne — c'est le joueur qui connaît la
// vraie orientation du vaisseau (aucune donnée FleetYards là-dessus), donc
// le réglage vient de js/app.js (bouton "Tourner", state.cargoViewerOrientation).
let currentOrientation = 0;

// Une couleur stable par mission (dérivée de son id) plutôt qu'aléatoire, pour
// que la même mission garde toujours la même couleur d'un rendu à l'autre.
function missionColorCss(missionId) {
  const hue = ((Number(missionId) || 0) * 47) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}
function colorForMission(missionId) {
  return new THREE.Color(missionColorCss(missionId));
}
// Exposée pour que js/app.js puisse afficher une pastille de couleur assortie
// dans la légende texte (voir renderCargoPackingLegend) — sans quoi rien ne
// relie visuellement la couleur d'une caisse dans la vue 3D à sa mission.
window.missionColorCss = missionColorCss;

// Grille de crans (1 SCU = 1,25 m) sur les 6 faces d'un module, façon
// hologramme de grille de cargo du jeu (voir la référence FleetYards) :
// plus lisible qu'un simple caisson filaire pour juger visuellement la
// taille d'une caisse par rapport au module.
function addFaceGridLines(positions, dx, dy, dz) {
  const nx = Math.round(dx / UNIT);
  const ny = Math.round(dy / UNIT);
  const nz = Math.round(dz / UNIT);
  [0, dz].forEach((z) => {
    for (let i = 0; i <= nx; i++) positions.push(i * UNIT, 0, z, i * UNIT, dy, z);
    for (let j = 0; j <= ny; j++) positions.push(0, j * UNIT, z, dx, j * UNIT, z);
  });
  [0, dy].forEach((y) => {
    for (let i = 0; i <= nx; i++) positions.push(i * UNIT, y, 0, i * UNIT, y, dz);
    for (let k = 0; k <= nz; k++) positions.push(0, y, k * UNIT, dx, y, k * UNIT);
  });
  [0, dx].forEach((x) => {
    for (let j = 0; j <= ny; j++) positions.push(x, j * UNIT, 0, x, j * UNIT, dz);
    for (let k = 0; k <= nz; k++) positions.push(x, 0, k * UNIT, x, dy, k * UNIT);
  });
}

// Caisson d'un module : arêtes extérieures nettes + grille de crans plus
// discrète sur les faces, regroupées pour être positionnées comme un seul
// objet.
function makeModuleWireframe(dx, dy, dz) {
  const group = new THREE.Group();

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(dx, dy, dz)),
    new THREE.LineBasicMaterial({ color: 0xff7a52 })
  );
  edges.position.set(dx / 2, dy / 2, dz / 2);
  group.add(edges);

  const gridPositions = [];
  addFaceGridLines(gridPositions, dx, dy, dz);
  const gridGeom = new THREE.BufferGeometry();
  gridGeom.setAttribute("position", new THREE.Float32BufferAttribute(gridPositions, 3));
  const grid = new THREE.LineSegments(
    gridGeom,
    new THREE.LineBasicMaterial({ color: 0xff7a52, transparent: true, opacity: 0.25 })
  );
  group.add(grid);

  return group;
}

// Étiquette de repère (Avant/Arrière/Gauche/Droite) affichée dans la scène :
// un plan posé à plat sur la base de la grille (comme un marquage au sol),
// visible des deux faces puisque la caméra peut passer dessous en tournant.
// width est proportionnelle à la taille de la scène affichée (voir l'appel
// dans renderCargoViewer3D) : une taille fixe écraserait un petit vaisseau
// (ex. C8 Pisces, soute de moins de 3 m) sous des étiquettes énormes.
function makeAxisLabel(text, width) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(18,20,26,0.75)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 34px sans-serif";
  ctx.fillStyle = "#dae1e7";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const geom = new THREE.PlaneGeometry(width, width / 4);
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  mesh.rotation.x = -Math.PI / 2; // couché à plat (plan XZ), face visible vers le haut
  return mesh;
}

// Quand un module n'a pas d'offset FleetYards fiable (voir hasReliableOffset
// dans renderCargoViewer3D), son nom de hardpoint encode presque toujours sa
// position ("hardpoint_cargogrid_front_left", "..._secure_rear_right"...) :
// ces mots-clés servent à reconstruire une vraie grille avant/arrière ×
// gauche/droite × haut/bas plutôt que d'aligner tous les modules en une
// rangée plate qui ne ressemble à rien pour un vaisseau comme l'Ironclad
// (aucun offset FleetYards du tout, alors qu'il a de vraies baies
// avant/arrière/gauche/droite). z/x/y valent -1/0/1 (aucun mot-clé reconnu
// pour cet axe = 0, au milieu) ; recognized est faux quand rien n'a été
// reconnu sur aucun axe, auquel cas le module retombe sur l'ancienne rangée
// plate (voir plus bas).
function parsePositionHint(name) {
  const n = (name || "").toLowerCase();
  let z = 0;
  if (n.includes("front") || n.includes("fore") || n.includes("nose")) z = 1;
  else if (n.includes("rear") || n.includes("aft") || n.includes("back")) z = -1;
  let x = 0;
  if (n.includes("left")) x = 1;
  else if (n.includes("right")) x = -1;
  let y = 0;
  if (n.includes("top") || n.includes("upper")) y = 1;
  else if (n.includes("bottom") || n.includes("lower")) y = -1;
  return { z, x, y, recognized: z !== 0 || x !== 0 || y !== 0 };
}

// Les 4 étiquettes de repère à plat, dans l'ordre où elles occupent les 4
// coins de la scène à rotation nulle : indice i -> direction physique
// +Z, +X, -Z, -X respectivement (voir les positions de makeAxisLabel plus
// bas). Un joueur qui connaît le vrai vaisseau peut cliquer "Tourner" pour
// décaler cette correspondance de 1 à 3 crans de 90° (voir currentOrientation
// ci-dessus) : la géométrie affichée ne bouge pas, seule l'étiquette à
// chaque coin change, ainsi que la direction visée par les boutons "Vue
// avant/etc" (voir setCargoViewerView).
const AXIS_PHYS_SLOTS = ["front", "left", "rear", "right"];
function labelForPhysSlot(slotIndex, rotation) {
  return AXIS_PHYS_SLOTS[(slotIndex + rotation) % 4];
}
function physSlotForLabel(label, rotation) {
  const base = AXIS_PHYS_SLOTS.indexOf(label);
  return (base - rotation + 4) % 4;
}

function ensureScene(container) {
  if (renderer) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f16);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(10, 10, 16);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  contentGroup = new THREE.Group();
  scene.add(contentGroup);

  function resize() {
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 400;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener("resize", resize);
  resize();

  if (!animating) {
    animating = true;
    (function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    })();
  }
}

function clearContent() {
  if (!contentGroup) return;
  while (contentGroup.children.length) {
    const obj = contentGroup.children.pop();
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
}

// holds : [{ name, dimensions:{x,y,z}, capacity, maxContainerSize }]
// placements : [{ module, position:[x,y,z], size:[x,y,z], box:{scu}, entry:{mission,commodity} }]
// rotation : 0-3, réglage joueur (voir currentOrientation ci-dessus et
// state.cargoViewerOrientation dans js/app.js) — ne change aucune position
// de module, seulement quelle étiquette Avant/Arrière/Gauche/Droite tombe
// sur quel coin de la scène.
window.renderCargoViewer3D = function renderCargoViewer3D(holds, placements, rotation) {
  const container = document.getElementById("cargo-viewer-3d");
  if (!container) return;
  currentOrientation = ((rotation || 0) % 4 + 4) % 4;
  ensureScene(container);
  clearContent();

  // FleetYards détaille parfois la soute d'un vaisseau en plusieurs petits
  // modules structurels annexes (échelle, passerelle, accès nez...) en plus
  // des vraies baies de cargo — tous comptent pour le rangement, mais les
  // afficher tous en rangée rend la vue illisible. On ne montre par défaut
  // que les modules d'une taille comparable à la plus grande baie du
  // vaisseau, plus ceux qui contiennent effectivement une caisse à cet
  // instant précis du trajet.
  const maxCapacity = Math.max(...holds.map((h) => h.capacity || 0), 1);
  const displayHolds = holds.filter(
    (h) => (h.capacity || 0) >= maxCapacity * 0.25 || placements.some((p) => p.module === h)
  );

  // FleetYards.net fournit parfois la vraie position relative de chaque
  // module (offset), mais seulement fiable quand elle est UNIQUE parmi tous
  // les modules du vaisseau : un même offset partagé par plusieurs modules
  // (ex. les 4 baies identiques du Caterpillar) est l'offset local au préfab
  // répété, pas une position absolue sur le vaisseau, et ne permet pas de
  // les situer les uns par rapport aux autres — dans ce cas (ou en l'absence
  // d'offset) on retombe sur une simple rangée, comme avant. Pour les
  // vaisseaux aux modules tous différents (ex. Hull B, dont les noms
  // encodent même la position : "bottom_front_left_lower"...), la vraie
  // disposition dans l'espace est utilisée.
  const offsetKey = (o) => (o ? `${o.x.toFixed(2)},${o.y.toFixed(2)},${o.z.toFixed(2)}` : null);
  const offsetCounts = new Map();
  holds.forEach((h) => {
    const key = offsetKey(h.offset);
    if (key) offsetCounts.set(key, (offsetCounts.get(key) || 0) + 1);
  });
  const hasReliableOffset = (h) => offsetCounts.get(offsetKey(h.offset)) === 1;

  // dx/dy/dz : mêmes dimensions que ci-dessous (échange y/z, repère
  // Three.js), calculées une fois par module affiché.
  const layout = displayHolds.map((hold) => ({
    hold,
    dx: hold.dimensions.x,
    dy: hold.dimensions.z,
    dz: hold.dimensions.y,
    hint: parsePositionHint(hold.name),
  }));

  const positioned = layout.filter((l) => hasReliableOffset(l.hold));
  const remaining = layout.filter((l) => !hasReliableOffset(l.hold));
  // Modules sans offset fiable mais dont le nom donne au moins un indice de
  // position (voir parsePositionHint) : reconstruits en grille. Le reste
  // (vraiment aucune info directionnelle) retombe sur l'ancienne rangée
  // plate, inchangée.
  const fallbackGrid = remaining.filter((l) => l.hint.recognized);
  const fallbackRow = remaining.filter((l) => !l.hint.recognized);

  // Modules à offset fiable : position réelle (même échange y/z que les
  // dimensions, x reste x).
  positioned.forEach((l) => {
    const o = l.hold.offset;
    l.worldPos = [o.x, o.z, o.y];
  });

  // Base commune aux deux replis : juste après l'ensemble des modules déjà
  // positionnés réellement, pour ne pas les chevaucher.
  let fallbackBaseX = positioned.reduce((max, l) => Math.max(max, l.worldPos[0] + l.dx), 0);
  if (positioned.length && (fallbackGrid.length || fallbackRow.length)) fallbackBaseX += MODULE_GAP;

  if (fallbackGrid.length) {
    // Ordre de construction avant/arrière (colonnes Z) et gauche/droite
    // (colonnes X) tel que l'avant (+Z) et la gauche (+X) se retrouvent aux
    // plus grandes coordonnées — cohérent avec les étiquettes plus bas
    // (Avant posée à maxDz+margin, Gauche à totalWidth+margin). On construit
    // donc en partant d'arrière/droite (coordonnée 0) vers avant/gauche.
    const zBuildOrder = [-1, 0, 1];
    const xBuildOrder = [-1, 0, 1];
    // Largeur de chaque colonne X et profondeur de chaque rangée Z, calculées
    // une fois sur tout le vaisseau pour une grille régulière (pas de case
    // qui déborde sur la rangée/colonne suivante).
    const colWidth = new Map();
    const rowDepth = new Map();
    fallbackGrid.forEach((l) => {
      colWidth.set(l.hint.x, Math.max(colWidth.get(l.hint.x) || 0, l.dx));
      rowDepth.set(l.hint.z, Math.max(rowDepth.get(l.hint.z) || 0, l.dz));
    });
    const colStart = new Map();
    let cx = 0;
    xBuildOrder.forEach((x) => {
      if (!colWidth.has(x)) return;
      colStart.set(x, cx);
      cx += colWidth.get(x) + MODULE_GAP;
    });
    const rowStart = new Map();
    let rz = 0;
    zBuildOrder.forEach((z) => {
      if (!rowDepth.has(z)) return;
      rowStart.set(z, rz);
      rz += rowDepth.get(z) + MODULE_GAP;
    });
    // Plusieurs modules peuvent partager exactement la même case (ex. deux
    // soutes "secure" du même côté sans indice haut/bas) : empilées à la
    // verticale, bas -> milieu -> haut, pour rester distinctes.
    const yBuildOrder = [-1, 0, 1];
    const cellStackY = new Map();
    fallbackGrid
      .slice()
      .sort((a, b) => yBuildOrder.indexOf(a.hint.y) - yBuildOrder.indexOf(b.hint.y))
      .forEach((l) => {
        const cellKey = `${l.hint.z}|${l.hint.x}`;
        const stackedY = cellStackY.get(cellKey) || 0;
        l.worldPos = [fallbackBaseX + colStart.get(l.hint.x), stackedY, rowStart.get(l.hint.z)];
        cellStackY.set(cellKey, stackedY + l.dy + MODULE_GAP);
      });
    fallbackBaseX += cx;
    if (fallbackRow.length) fallbackBaseX += MODULE_GAP;
  }

  // Modules sans aucun indice exploitable : rangée de repli, comme avant.
  fallbackRow.forEach((l) => {
    l.worldPos = [fallbackBaseX, 0, 0];
    fallbackBaseX += l.dx + MODULE_GAP;
  });

  // Ramène tout à des coordonnées positives (les offsets réels peuvent
  // démarrer n'importe où) pour que les étiquettes/la caméra ci-dessous
  // restent cohérentes.
  const minX = Math.min(0, ...layout.map((l) => l.worldPos[0]));
  const minZ = Math.min(0, ...layout.map((l) => l.worldPos[2]));
  layout.forEach((l) => {
    l.worldPos[0] -= minX;
    l.worldPos[2] -= minZ;
  });

  let maxDy = 0;
  let maxDz = 0;
  let totalWidth = 0;
  layout.forEach((l) => {
    maxDy = Math.max(maxDy, l.worldPos[1] + l.dy);
    maxDz = Math.max(maxDz, l.worldPos[2] + l.dz);
    totalWidth = Math.max(totalWidth, l.worldPos[0] + l.dx);
  });

  layout.forEach(({ hold, dx, dy, dz, worldPos }) => {
    // Caisson du module : arêtes nettes + grille de crans sur les faces.
    const wireframe = makeModuleWireframe(dx, dy, dz);
    wireframe.position.set(worldPos[0], worldPos[1], worldPos[2]);
    contentGroup.add(wireframe);

    // Caisses rangées dans ce module (même échange y/z que ci-dessus : les
    // caisses sont calculées par js/cargo-packing.js dans le repère natif
    // x/y/z du hold, position/size gardent donc cet ordre jusqu'ici).
    placements
      .filter((p) => p.module === hold)
      .forEach((p) => {
        const sx = p.size[0] * UNIT;
        const sy = p.size[2] * UNIT;
        const sz = p.size[1] * UNIT;
        const px = p.position[0];
        const py = p.position[2];
        const pz = p.position[1];
        const geom = new THREE.BoxGeometry(sx * 0.94, sy * 0.94, sz * 0.94); // léger retrait visuel entre caisses
        const mat = new THREE.MeshStandardMaterial({
          color: colorForMission(p.entry.mission ? p.entry.mission.id : 0),
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(
          worldPos[0] + px * UNIT + sx / 2,
          worldPos[1] + py * UNIT + sy / 2,
          worldPos[2] + pz * UNIT + sz / 2
        );
        contentGroup.add(mesh);

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geom),
          new THREE.LineBasicMaterial({ color: 0x0c0f16 })
        );
        edges.position.copy(mesh.position);
        contentGroup.add(edges);
      });
  });

  sceneBounds = { minX: 0, maxX: totalWidth, minY: 0, maxY: maxDy, minZ: 0, maxZ: maxDz };
  const midX = totalWidth / 2;
  const midY = maxDy / 2;
  const midZ = maxDz / 2;

  // Étiquettes Avant/Arrière/Gauche/Droite en bordure de la scène : les 4
  // emplacements physiques ci-dessous (coin +Z, +X, -Z, -X) sont fixes,
  // seule l'étiquette qui y est affichée dépend de currentOrientation (voir
  // labelForPhysSlot plus haut) — un joueur qui sait que ce n'est pas la
  // bonne orientation clique "Tourner" (voir js/app.js) sans que la scène ne
  // bouge. À rotation nulle : Avant = +Z ; en repère main droite avec l'axe Y
  // vers le haut, faire face à +Z met la droite du côté -X et la gauche du
  // côté +X (règle de la main droite, pas l'inverse) — d'où gauche posée du
  // côté totalWidth+margin ci-dessous. Un essai d'inversion (Avant/Droite et
  // Arrière/Gauche) basé sur une seule comparaison visuelle (Caterpillar) a
  // été tenté puis annulé : le vrai problème du Caterpillar était la
  // rotation de module ignorée (voir rotateFlatDimensions dans
  // js/fleetyards.js, déjà corrigé), pas cette convention — l'inversion
  // cassait l'orientation du Raft, qui n'a aucune rotation de module et
  // n'avait donc pas besoin d'y être touché.
  // Proportionnelles à la taille réelle de la scène affichée : une marge/
  // taille fixe écraserait un petit vaisseau (soute de 2-3 m) sous des
  // étiquettes démesurées, ou serait à peine visible pour un gros vaisseau
  // à plusieurs modules.
  const sceneScale = Math.max(totalWidth, maxDz, maxDy, 1);
  const margin = sceneScale * 0.12;
  const labelWidth = Math.max(0.6, sceneScale * 0.3);
  const AXIS_I18N_KEYS = { front: "axisFront", rear: "axisRear", left: "axisLeft", right: "axisRight" };
  const slotFront = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(0, currentOrientation)]), labelWidth);
  slotFront.position.set(midX, 0, maxDz + margin);
  contentGroup.add(slotFront);
  const slotRear = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(2, currentOrientation)]), labelWidth);
  slotRear.position.set(midX, 0, -margin);
  contentGroup.add(slotRear);
  const slotLeft = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(1, currentOrientation)]), labelWidth);
  slotLeft.position.set(totalWidth + margin, 0, midZ);
  contentGroup.add(slotLeft);
  const slotRight = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(3, currentOrientation)]), labelWidth);
  slotRight.position.set(-margin, 0, midZ);
  contentGroup.add(slotRight);

  // Ne recadre la caméra que si la scène a changé de taille (nouveau
  // vaisseau) — pas à chaque navigation d'étape (voir cargo-step-prev/next
  // dans js/app.js), sans quoi la rotation/le zoom du joueur seraient perdus
  // à chaque clic alors que le contenu affiché change juste d'une étape à
  // l'autre pour le même vaisseau.
  const frameKey = `${totalWidth.toFixed(2)}|${maxDy.toFixed(2)}|${maxDz.toFixed(2)}`;
  if (frameKey !== lastFrameKey) {
    // La scène n'est pas toujours une rangée longue et fine (les modules à
    // offset réel, voir plus haut, peuvent former un vrai volume 3D presque
    // cubique, ex. Hull B) : la distance de la caméra doit tenir compte des
    // 3 dimensions de la scène, pas seulement de sa largeur, sous peine de
    // se retrouver au milieu des modules plutôt qu'à bonne distance.
    const sceneScaleForCamera = Math.max(totalWidth, maxDy, maxDz, 1);
    controls.target.set(midX, midY, midZ);
    camera.position.set(midX, Math.max(6, sceneScaleForCamera * 0.6), Math.max(10, sceneScaleForCamera * 1.1));
    controls.update();
    lastFrameKey = frameKey;
  }
};

// Repositionne la caméra sur l'une des 4 vues préréglées (voir les boutons
// "Vue avant/arrière/gauche/droite" du panneau), cadrée sur l'ensemble de la
// scène actuellement affichée.
function setCargoViewerView(view) {
  if (!sceneBounds || !camera || !controls) return;
  const { minX, maxX, minY, maxY, minZ, maxZ } = sceneBounds;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const midZ = (minZ + maxZ) / 2;
  const distance = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 6) * 1.6;
  controls.target.set(midX, midY, midZ);
  // Haut/bas ne dépendent pas de la rotation (toujours autour de l'axe
  // vertical). Pour avant/arrière/gauche/droite, on cherche d'abord quel
  // emplacement physique (+Z/+X/-Z/-X) porte actuellement cette étiquette
  // (voir physSlotForLabel et currentOrientation plus haut) — un clic sur
  // "Vue avant" doit toujours regarder ce qui est affiché "Avant" à l'écran,
  // même après un clic sur "Tourner".
  if (view === "top") camera.position.set(midX, midY + distance, midZ);
  else if (view === "bottom") camera.position.set(midX, midY - distance, midZ);
  else {
    const slot = physSlotForLabel(view, currentOrientation);
    const slotCameraPos = [
      [midX, midY, midZ + distance],
      [midX + distance, midY, midZ],
      [midX, midY, midZ - distance],
      [midX - distance, midY, midZ],
    ];
    const pos = slotCameraPos[slot];
    if (pos) camera.position.set(pos[0], pos[1], pos[2]);
  }
  controls.update();
}
window.setCargoViewerView = setCargoViewerView;

document.querySelectorAll(".btn-view-sm").forEach((btn) => {
  btn.addEventListener("click", () => setCargoViewerView(btn.dataset.view));
});

window.clearCargoViewer3D = function clearCargoViewer3D() {
  clearContent();
  lastFrameKey = null;
};
