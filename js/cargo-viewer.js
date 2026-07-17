// =========================================================================
// Vue 3D interactive du rangement de cargo (module ES, contrairement au
// reste de l'appli en scripts classiques — Three.js n'est plus distribué
// qu'en modules) : un vaisseau réparti en plusieurs modules de soute (voir
// js/fleetyards.js) est affiché en caissons filaires, avec les caisses
// effectivement rangées (voir js/cargo-packing.js) dedans en solide, coloré
// par mission. Trois niveaux de disposition selon ce que FleetYards fournit
// pour ce vaisseau : (1) offsets réels et fiables (une nette majorité des
// modules ont un offset distinct, ex. Hull B) -> positions exactes ; (2)
// offsets absents ou peu fiables mais un indice latéral/vertical dans le nom
// du hardpoint (ex. Ironclad : front_left, rear_right...) -> grille
// avant/arrière × gauche/droite reconstruite (voir parsePositionHint) ; (3)
// juste une enfilade de baies (indice avant/arrière seul, ou aucun, ex. les
// 4 baies du Caterpillar) -> colonne le long de l'axe avant-arrière, ordonnée
// nez puis baies numérotées. Cette reconstruction reste une supposition, pas
// une donnée exacte : le joueur peut corriger l'étiquetage avant/arrière/
// gauche/droite (boutons "Tourner"/"Miroir", voir currentOrientation/
// currentMirror) sans que la géométrie affichée ne bouge, et sans perdre
// l'angle de vue/zoom en cours (voir buildAxisLabels).
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
// Rotation (0-3, par pas de 90°) et miroir (false/true) courants des
// étiquettes Avant/Arrière/Gauche/Droite — mémorisés ici pour que
// setCargoViewerView (déclenchée par les boutons "Vue avant/etc",
// séparément de renderCargoViewer3D) sache vers quelle direction physique
// de la scène pointer. Voir labelForPhysSlot ci-dessous : la géométrie ne
// bouge jamais, seule l'étiquette affichée à chaque coin change — c'est le
// joueur qui connaît la vraie orientation du vaisseau (aucune donnée
// FleetYards là-dessus), donc le réglage vient de js/app.js (boutons
// "Tourner"/"Miroir", state.cargoViewerOrientation/cargoViewerMirror). Les
// deux combinés couvrent les 8 symétries d'un carré (rotation seule ne
// couvre que 4 des 8 : elle ne peut pas, par exemple, échanger gauche/
// droite en laissant avant/arrière en place — un vrai miroir, pas une
// rotation).
let currentOrientation = 0;
let currentMirror = false;
// Mode « éditer la disposition » (voir js/app.js:enterCargoLayoutEdit) : le
// joueur glisse les grilles à leur vraie place. Pendant ce mode on masque les
// caisses et on ne recadre jamais la caméra, pour que la vue reste stable d'un
// glisser à l'autre. La rotation LIBRE est bloquée, mais les 6 vues préréglées
// restent disponibles : c'est par elles qu'on choisit le plan de glisser (vue
// de dessus -> le sol, vue avant/de côté -> la hauteur), et les garder franches
// est ce qui rend l'axe dominant non ambigu (voir pickDragAxes).
let editingLayout = false;
// Boîtes de collision invisibles (une par module) : les caissons sont des
// fils de fer (LineSegments), très mauvaises cibles au raycasting. Recréées
// à chaque rendu en mode édition, libérées par clearContent().
let pickMeshes = [];
// Vrai quand les écouteurs de glisser sont attachés à la scène actuelle — voir
// applyLayoutEditingToScene (le câblage doit rester idempotent, il est appelé
// à chaque rendu).
let layoutEditingWired = false;
// Métriques et repères des 4 étiquettes du dernier rendu complet (voir
// renderCargoViewer3D) : permettent à updateCargoViewerOrientation de
// reconstruire seulement le texte des étiquettes sans toucher au reste de
// la scène (caissons, caisses, caméra) — voir ce commentaire plus bas pour
// pourquoi ce découplage est nécessaire.
let lastLabelMetrics = null;

// Dernier `layout` résolu (modules + worldPos finaux) — voir
// getResolvedCargoGrid.
let lastResolvedLayout = [];
let labelMeshes = { front: null, rear: null, left: null, right: null };

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

// Grille de sol : un quadrillage de crans (1,25 m) posé à plat sur le plan
// Y=0, couvrant le rectangle du bloc (avec une marge pour avoir où glisser).
// Modélise le plancher réel — sans lui, on glissait contre une origine
// invisible (voir snapToUnit). Purement visuel, non cliquable (pas dans
// pickMeshes).
function makeFloorGrid(x0, z0, x1, z1) {
  // Marge PROPORTIONNELLE à la taille du bloc (avec un minimum) : une marge
  // fixe rendait le sol riquiqui sous un gros vaisseau. On l'étend d'une bonne
  // moitié de la plus grande dimension du bloc, pour avoir de la place où
  // glisser et un vrai plancher visible quelle que soit la taille du vaisseau.
  const span = Math.max(x1 - x0, z1 - z0);
  const pad = Math.max(UNIT * 6, span * 0.5);
  const gx0 = Math.floor((x0 - pad) / UNIT) * UNIT;
  const gz0 = Math.floor((z0 - pad) / UNIT) * UNIT;
  const gx1 = Math.ceil((x1 + pad) / UNIT) * UNIT;
  const gz1 = Math.ceil((z1 + pad) / UNIT) * UNIT;
  const positions = [];
  for (let x = gx0; x <= gx1 + 1e-6; x += UNIT) positions.push(x, 0, gz0, x, 0, gz1);
  for (let z = gz0; z <= gz1 + 1e-6; z += UNIT) positions.push(gx0, 0, z, gx1, 0, z);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(
    geom,
    new THREE.LineBasicMaterial({ color: 0x3a4152, transparent: true, opacity: 0.5 })
  );
}

// Petite étiquette texte face caméra (Sprite) pour nommer le bout d'une flèche
// d'axe. Contrairement à makeAxisLabel (couché au sol), un Sprite reste
// toujours lisible quel que soit l'angle de la caméra.
function makeAxisNameLabel(text, color, size) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 48px sans-serif";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 34);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false })
  );
  sprite.scale.set(size, size, size);
  return sprite;
}

// Repère 3 axes à la Blender : flèches colorées X (rouge), Y (vert, la
// verticale/le haut), Z (bleu), avec leur nom au bout. Aide d'auteur en mode
// édition — dans la vue de résultat normale, ce sont Avant/Arrière/Gauche/
// Droite qui parlent au joueur. Ancré au coin near du bloc (minX/minZ).
function makeAxesHelper(originX, originZ, length) {
  const group = new THREE.Group();
  const helper = new THREE.AxesHelper(length);
  helper.position.set(originX, 0, originZ);
  group.add(helper);
  const nameSize = Math.max(0.6, length * 0.18);
  const xl = makeAxisNameLabel("X", "#ff5a5a", nameSize);
  xl.position.set(originX + length + nameSize * 0.6, 0, originZ);
  const yl = makeAxisNameLabel("Y", "#5af85a", nameSize);
  yl.position.set(originX, length + nameSize * 0.6, originZ);
  const zl = makeAxisNameLabel("Z", "#5a8aff", nameSize);
  zl.position.set(originX, 0, originZ + length + nameSize * 0.6);
  group.add(xl, yl, zl);
  return group;
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

// Numéro de baie porté par un nom de hardpoint, pour ordonner les baies
// répétées et numérotées d'un vaisseau-colonne (ex. le Caterpillar) dans
// leur ordre réel plutôt qu'au hasard de l'ordre de l'API FleetYards.
// On prend le DERNIER nombre du nom, où qu'il soit, et pas seulement un
// nombre en fin de nom : les annexes d'une baie sont suffixées
// ("module_01" mais aussi "module_01_ladder", "module_01_walkway"), donc
// chercher un nombre en fin de nom les renvoyait toutes à l'infini, en vrac
// et détachées de leur baie. Avec le dernier nombre, elles partagent
// l'indice de leur baie et restent groupées avec elle.
// Un module sans aucun numéro (ex. "nose") reste à l'infini, donc après les
// numérotés dans cet ordre secondaire — mais son indice avant/arrière
// (front) le fait passer devant, à l'avant (voir le tri de la colonne de
// repli plus bas).
function moduleIndex(name) {
  const m = (name || "").match(/(\d+)(?!.*\d)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

// Clé stable d'un module pour la disposition manuelle (voir
// state.cargoViewerLayout dans js/app.js). Le nom du hardpoint suffit ; on ne
// suffixe "#<i>" que si ce nom apparaît plusieurs fois parmi TOUTES les
// soutes du vaisseau (cas théorique — les noms FleetYards observés sont
// distincts, y compris module_01..04), pour que deux homonymes ne partagent
// pas la même position mémorisée. Calculée sur l'ensemble non filtré des
// soutes (holds), pas la liste affichée à l'étape courante (displayHolds) :
// cette dernière varie d'une étape de trajet à l'autre (un module structurel
// n'apparaît que quand il porte une caisse à cette étape), ce qui ferait
// changer l'indice "#<i>" d'un même module d'une étape à l'autre.
function moduleKey(hold, holds) {
  const name = hold.name || "";
  const sameName = holds.filter((h) => (h.name || "") === name);
  if (sameName.length <= 1) return name;
  return `${name}#${sameName.indexOf(hold)}`;
}

// Les 4 étiquettes de repère à plat, dans l'ordre où elles occupent les 4
// coins de la scène à rotation nulle : indice i -> direction physique
// +Z, +X, -Z, -X respectivement (voir les positions de makeAxisLabel plus
// bas). Un joueur qui connaît le vrai vaisseau peut cliquer "Tourner" pour
// décaler cette correspondance de 1 à 3 crans de 90° (voir currentOrientation
// ci-dessus) : la géométrie affichée ne bouge pas, seule l'étiquette à
// chaque coin change, ainsi que la direction visée par les boutons "Vue
// avant/etc" (voir setCargoViewerView).
// mirror applique une vraie réflexion (échange gauche/droite en laissant
// avant/arrière fixes, avant composition avec la rotation) : combinée aux 4
// rotations, elle donne accès aux 8 symétries du carré, pas seulement aux 4
// rotations pures. Une rotation seule ne peut jamais reproduire un miroir
// (ex. "avant est en fait à droite mais arrière est resté arrière" n'est
// atteignable par aucune des 4 rotations, seulement par un miroir).
const AXIS_PHYS_SLOTS = ["front", "left", "rear", "right"];
function labelForPhysSlot(slotIndex, rotation, mirror) {
  const reflected = mirror ? (4 - slotIndex) % 4 : slotIndex;
  return AXIS_PHYS_SLOTS[(reflected + rotation) % 4];
}
function physSlotForLabel(label, rotation, mirror) {
  const base = AXIS_PHYS_SLOTS.indexOf(label);
  const target = (base - rotation + 4) % 4;
  return mirror ? (4 - target) % 4 : target;
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
  labelMeshes = { front: null, rear: null, left: null, right: null };
  pickMeshes = [];
}

function disposeLabelMesh(mesh) {
  if (!mesh) return;
  contentGroup.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.dispose();
  }
}

const AXIS_I18N_KEYS = { front: "axisFront", rear: "axisRear", left: "axisLeft", right: "axisRight" };

// (Re)construit les 4 étiquettes de repère à partir des métriques d'un
// rendu complet (voir lastLabelMetrics) et de l'orientation courante
// (currentOrientation/currentMirror) — appelée par renderCargoViewer3D
// (premier rendu) ET par updateCargoViewerOrientation (un clic sur
// "Tourner"/"Miroir", voir plus bas) : SEULES les 4 étiquettes sont
// détruites/recréées ici, jamais les caissons/caisses/la caméra, pour que
// changer l'orientation ne perturbe jamais la vue que le joueur a mise en
// place (zoom, angle) à la souris.
function buildAxisLabels() {
  if (!lastLabelMetrics) return;
  const { midX, midZ, minX, minZ, maxDz, totalWidth, margin, labelWidth } = lastLabelMetrics;
  disposeLabelMesh(labelMeshes.front);
  disposeLabelMesh(labelMeshes.rear);
  disposeLabelMesh(labelMeshes.left);
  disposeLabelMesh(labelMeshes.right);

  // Les 4 étiquettes bordent le bloc sur ses bornes RÉELLES (minX/minZ,
  // totalWidth/maxDz), pas une origine supposée à 0 : une fois les grilles
  // glissées ailleurs, "Droite"/"Arrière" restent collés au bloc au lieu de
  // rester scotchés à l'ancien coin (0,0) — c'était la cause du débordement.
  const front = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(0, currentOrientation, currentMirror)]), labelWidth);
  front.position.set(midX, 0, maxDz + margin);
  contentGroup.add(front);

  const rear = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(2, currentOrientation, currentMirror)]), labelWidth);
  rear.position.set(midX, 0, minZ - margin);
  contentGroup.add(rear);

  // Gauche/Droite sont décalées d'une DEMI-LARGEUR d'étiquette en plus de la
  // marge : posées comme Avant/Arrière (au centre, à ±margin), leur largeur —
  // dimensionnée sur le grand axe du vaisseau — mordait sur un vaisseau étroit
  // et long (ex. l'épine du Caterpillar). Avec ce décalage, leur BORD intérieur
  // affleure le bloc (à ±margin) au lieu de le chevaucher.
  const left = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(1, currentOrientation, currentMirror)]), labelWidth);
  left.position.set(totalWidth + margin + labelWidth / 2, 0, midZ);
  contentGroup.add(left);

  const right = makeAxisLabel(t(AXIS_I18N_KEYS[labelForPhysSlot(3, currentOrientation, currentMirror)]), labelWidth);
  right.position.set(minX - margin - labelWidth / 2, 0, midZ);
  contentGroup.add(right);

  labelMeshes = { front, rear, left, right };
}

// Change l'orientation (bouton "Tourner"/"Miroir", voir js/app.js) sans
// jamais toucher aux caissons/caisses affichés ni à la caméra : ne
// recalcule QUE le texte des 4 étiquettes, à partir des métriques du
// dernier rendu complet. C'est le chemin normal pour ces boutons (pas
// renderCargoViewer3D, qui vide et reconstruit toute la scène) — voir
// buildAxisLabels ci-dessus pour pourquoi ce découplage est nécessaire.
window.updateCargoViewerOrientation = function updateCargoViewerOrientation(rotation, mirror) {
  currentOrientation = ((rotation || 0) % 4 + 4) % 4;
  currentMirror = !!mirror;
  buildAxisLabels();
};

// holds : [{ name, dimensions:{x,y,z}, capacity, maxContainerSize }]
// placements : [{ module, position:[x,y,z], size:[x,y,z], box:{scu}, entry:{mission,commodity} }]
// rotation/mirror : réglage joueur (voir currentOrientation/currentMirror
// ci-dessus et state.cargoViewerOrientation/cargoViewerMirror dans
// js/app.js) — ne change aucune position de module, seulement quelle
// étiquette Avant/Arrière/Gauche/Droite tombe sur quel coin de la scène.
// savedLayout : map { [moduleKey]: {x, z} } des grilles que le joueur a
// placées à la main pour ce vaisseau (state.cargoViewerLayout, js/app.js),
// ou {}. Nommé savedLayout et pas layout : `layout` est déjà le tableau
// local des modules affichés, plus bas dans cette fonction.
window.renderCargoViewer3D = function renderCargoViewer3D(holds, placements, rotation, mirror, savedLayout) {
  const container = document.getElementById("cargo-viewer-3d");
  if (!container) return;
  currentOrientation = ((rotation || 0) % 4 + 4) % 4;
  currentMirror = !!mirror;
  ensureScene(container);
  clearContent();

  // On affiche TOUTES les soutes, sans exception : chaque entrée que
  // FleetYards renvoie a une capacité réelle, compte dans la capacité totale
  // du vaisseau, et sert effectivement au rangement (js/cargo-packing.js
  // reçoit `holds` en entier). En cacher une revient à masquer de la place
  // de cargo que le joueur a le droit d'utiliser — et où une caisse peut
  // déjà se trouver.
  //
  // Deux filtres successifs ont été essayés ici, tous deux faux :
  //  - un seuil de capacité (« au moins 25 % de la plus grosse baie ») :
  //    cachait les 5 vraies soutes sécurisées de l'Ironclad (8 SCU face à
  //    des baies de 720) ;
  //  - un filtre par nom de hardpoint (ladder/walkway/access...) : sur le
  //    Caterpillar il cachait 9 soutes sur 14, soit 132 SCU. Ces échelles et
  //    passerelles ne sont PAS de la structure décorative : les 14 soutes
  //    totalisent 576 SCU, exactement la capacité officielle du Caterpillar
  //    (voir data/ships.js) — ce sont de vraies grilles utilisables.
  //
  // La disposition reconstruite reste une supposition, mais le joueur peut
  // désormais corriger chaque grille à la main (« Éditer la disposition »),
  // ce qui est la bonne réponse à une vue chargée — pas le fait de cacher
  // des grilles réelles.
  const displayHolds = holds;

  // FleetYards.net fournit parfois la vraie position relative de chaque
  // module (offset). Pour un vaisseau comme le Hull B, les 16 modules ont
  // chacun un offset distinct qui décrit leur vraie place dans la soute ->
  // on l'utilise. Mais pour un vaisseau comme le Caterpillar, la plupart des
  // modules partagent le même offset (les 4 baies identiques, leurs échelles,
  // leurs passerelles) : c'est un offset LOCAL au préfab répété, pas une
  // position absolue. Deux modules (nez, accès nez) y ont un offset unique,
  // mais par accident — c'est aussi un offset local, pas une vraie position.
  // On ne se fie donc aux offsets que si une nette majorité des modules
  // affichés en ont un DISTINCT (Hull B : 16/16 ; Caterpillar : 1/5) ;
  // sinon on bascule tout le vaisseau sur la reconstruction par nom
  // (grille/colonne, voir plus bas), pour ne pas mal placer les quelques
  // modules aux offsets uniques-par-hasard.
  const offsetKey = (o) => (o ? `${o.x.toFixed(2)},${o.y.toFixed(2)},${o.z.toFixed(2)}` : null);
  const offsetCounts = new Map();
  displayHolds.forEach((h) => {
    const key = offsetKey(h.offset);
    if (key) offsetCounts.set(key, (offsetCounts.get(key) || 0) + 1);
  });
  const withOffset = displayHolds.filter((h) => offsetKey(h.offset) !== null);
  const uniqueOffsetCount = withOffset.filter((h) => offsetCounts.get(offsetKey(h.offset)) === 1).length;
  const offsetsReliable = withOffset.length > 0 && uniqueOffsetCount >= withOffset.length * 0.5;
  const hasReliableOffset = (h) => offsetsReliable && offsetCounts.get(offsetKey(h.offset)) === 1;

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
  // Un indice LATÉRAL (gauche/droite) ou VERTICAL (haut/bas) décrit un vrai
  // agencement en 2D/3D -> grille (ex. l'Ironclad : front_left/right,
  // rear_left/right...). Un indice seulement avant/arrière (ou aucun indice)
  // décrit une simple suite de modules le long de l'axe du vaisseau -> une
  // COLONNE avant-arrière (ex. les baies en enfilade du Caterpillar : nez +
  // module_01..04), et non plus une rangée gauche-droite comme avant, qui ne
  // ressemblait pas au vaisseau réel. L'indice avant/arrière, quand il
  // existe, sert alors juste à ordonner la colonne (le nez passe devant).
  const fallbackGrid = remaining.filter((l) => l.hint.x !== 0 || l.hint.y !== 0);
  const fallbackRow = remaining.filter((l) => l.hint.x === 0 && l.hint.y === 0);

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

  // Colonne de repli : les modules en enfilade (aucun indice latéral/vertical)
  // sont posés le long de l'axe avant-arrière (Z), pas gauche-droite (X),
  // pour lire comme la vraie enfilade de baies du vaisseau. Ordre : d'abord
  // l'avant (indice front, ex. le nez du Caterpillar), puis par numéro de
  // baie croissant (module_01, 02, 03, 04). L'avant = +Z (côté de l'étiquette
  // « Avant », voir plus bas), donc on pose du fond (Z=0) vers l'avant en
  // parcourant la colonne dans l'ordre inverse.
  const rowFrontToBack = fallbackRow
    .slice()
    .sort((a, b) => b.hint.z - a.hint.z || moduleIndex(a.hold.name) - moduleIndex(b.hold.name));
  const rowWidth = rowFrontToBack.reduce((max, l) => Math.max(max, l.dx), 0);
  let rowZ = 0;
  rowFrontToBack
    .slice()
    .reverse()
    .forEach((l) => {
      l.worldPos = [fallbackBaseX, 0, rowZ];
      rowZ += l.dz + MODULE_GAP;
    });
  if (fallbackRow.length) fallbackBaseX += rowWidth + MODULE_GAP;

  // Ramène tout à des coordonnées positives (les offsets réels peuvent
  // démarrer n'importe où) pour que les étiquettes/la caméra ci-dessous
  // restent cohérentes.
  const minX = Math.min(0, ...layout.map((l) => l.worldPos[0]));
  const minZ = Math.min(0, ...layout.map((l) => l.worldPos[2]));
  layout.forEach((l) => {
    l.worldPos[0] -= minX;
    l.worldPos[2] -= minZ;
  });

  // Surcharge manuelle du joueur (state.cargoViewerLayout, voir js/app.js) :
  // écrase x/z des grilles qu'il a glissées, par-dessus la reconstruction
  // auto. Partielle : un module absent de la map garde sa position auto.
  // Y (worldPos[1]) inchangé — v1 au sol.
  // APRÈS la normalisation ci-dessus, volontairement : la normalisation est
  // une translation de tous les modules ; appliquer la surcharge avant
  // re-décalerait au rendu suivant une position tout juste enregistrée (ce
  // qu'on mémorise ne serait pas ce qu'on récupère). Ici la valeur mémorisée
  // est exactement la valeur dessinée — aller-retour stable. Les positions
  // enregistrées sont bornées à >= 0 au glisser (voir onPointerUp), donc tout
  // reste en coordonnées positives et le calcul des bornes/étiquettes qui
  // suit (sceneBounds suppose une origine à 0) reste valide.
  const overrides = savedLayout || {};
  layout.forEach((l) => {
    const custom = overrides[moduleKey(l.hold, holds)];
    if (custom) {
      l.worldPos[0] = custom.x;
      l.worldPos[2] = custom.z;
      // Rétrocompatibilité : une entrée enregistrée par la v1 n'a pas de `y`.
      // Dans ce cas on laisse la hauteur calculée automatiquement (modules
      // empilés par la reconstruction), comportement v1 strictement
      // inchangé — pas de migration à faire.
      if (typeof custom.y === "number") l.worldPos[1] = custom.y;
    }
  });

  let maxDy = 0;
  let maxDz = 0;
  let totalWidth = 0;
  // Bornes MINIMALES réelles : depuis que X/Z ne sont plus bornés à >= 0 (voir
  // snapToUnit), le bloc ne commence plus forcément à l'origine. Repères et
  // caméra doivent suivre le bloc là où il est, pas supposer un coin à (0,0).
  let minX0 = Infinity;
  let minZ0 = Infinity;
  layout.forEach((l) => {
    maxDy = Math.max(maxDy, l.worldPos[1] + l.dy);
    maxDz = Math.max(maxDz, l.worldPos[2] + l.dz);
    totalWidth = Math.max(totalWidth, l.worldPos[0] + l.dx);
    minX0 = Math.min(minX0, l.worldPos[0]);
    minZ0 = Math.min(minZ0, l.worldPos[2]);
  });
  // Scène vide (aucun module) : bornes neutres à 0 plutôt qu'Infinity.
  if (!layout.length) {
    minX0 = 0;
    minZ0 = 0;
  }
  lastResolvedLayout = layout;

  layout.forEach(({ hold, dx, dy, dz, worldPos }) => {
    // Caisson du module : arêtes nettes + grille de crans sur les faces.
    const wireframe = makeModuleWireframe(dx, dy, dz);
    wireframe.position.set(worldPos[0], worldPos[1], worldPos[2]);
    contentGroup.add(wireframe);

    if (editingLayout) {
      // Cube invisible aux dimensions du module, centré (le caisson, lui, est
      // positionné sur son coin/origine) — c'est la cible du raycaster.
      const pick = new THREE.Mesh(
        new THREE.BoxGeometry(dx, dy, dz),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      pick.position.set(worldPos[0] + dx / 2, worldPos[1] + dy / 2, worldPos[2] + dz / 2);
      pick.userData.moduleKey = moduleKey(hold, holds);
      pick.userData.wireframe = wireframe;
      pick.userData.dims = { dx, dy, dz };
      contentGroup.add(pick);
      pickMeshes.push(pick);
    }

    // Caisses rangées dans ce module (même échange y/z que ci-dessus : les
    // caisses sont calculées par js/cargo-packing.js dans le repère natif
    // x/y/z du hold, position/size gardent donc cet ordre jusqu'ici).
    // Caisses masquées en mode édition : on place des modules, elles ne font
    // qu'encombrer la vue de dessus.
    if (!editingLayout)
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

  sceneBounds = { minX: minX0, maxX: totalWidth, minY: 0, maxY: maxDy, minZ: minZ0, maxZ: maxDz };
  const midX = (minX0 + totalWidth) / 2;
  const midY = maxDy / 2;
  const midZ = (minZ0 + maxDz) / 2;

  // Étiquettes Avant/Arrière/Gauche/Droite en bordure de la scène : les 4
  // emplacements physiques ci-dessous (coin +Z, +X, -Z, -X) sont fixes,
  // seule l'étiquette qui y est affichée dépend de currentOrientation/
  // currentMirror (voir labelForPhysSlot plus haut) — un joueur qui sait que
  // ce n'est pas la bonne orientation clique "Tourner"/"Miroir" (voir
  // js/app.js) sans que la scène ne bouge (voir buildAxisLabels). À
  // rotation nulle et sans miroir : Avant = +Z ; en repère main droite avec
  // l'axe Y vers le haut, faire face à +Z met la droite du côté -X et la
  // gauche du côté +X (règle de la main droite, pas l'inverse) — d'où
  // gauche posée du côté totalWidth+margin ci-dessous. Un essai d'inversion
  // (Avant/Droite et Arrière/Gauche) basé sur une seule comparaison visuelle
  // (Caterpillar) a été tenté puis annulé : le vrai problème du Caterpillar
  // était la rotation de module ignorée (voir rotateFlatDimensions dans
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
  lastLabelMetrics = { midX, midZ, minX: minX0, minZ: minZ0, maxDz, totalWidth, margin, labelWidth };
  buildAxisLabels();

  // Aides d'auteur, en mode édition seulement (la vue de résultat normale
  // reste épurée) : le sol pour glisser contre une référence réelle, et le
  // repère 3 axes pour lire l'orientation. Ajoutés à contentGroup, donc
  // libérés au prochain clearContent comme le reste.
  if (editingLayout) {
    const floor = makeFloorGrid(minX0, minZ0, totalWidth, maxDz);
    floor.userData.isFloor = true;
    contentGroup.add(floor);
    const axes = makeAxesHelper(minX0, minZ0, Math.max(3, sceneScale * 0.18));
    axes.userData.isAxes = true;
    contentGroup.add(axes);
  }

  // Ne recadre la caméra que si la scène a changé de taille (nouveau
  // vaisseau) — pas à chaque navigation d'étape (voir cargo-step-prev/next
  // dans js/app.js), sans quoi la rotation/le zoom du joueur seraient perdus
  // à chaque clic alors que le contenu affiché change juste d'une étape à
  // l'autre pour le même vaisseau.
  const frameKey = `${totalWidth.toFixed(2)}|${maxDy.toFixed(2)}|${maxDz.toFixed(2)}`;
  // En édition, les bornes bougent à chaque glisser : recadrer ferait sauter
  // la vue de dessus que le joueur vient de poser.
  if (!editingLayout && frameKey !== lastFrameKey) {
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

  // La scène vient peut-être de naître (ensureScene plus haut) alors que le
  // mode édition était DÉJÀ demandé : on s'y conforme maintenant que
  // renderer/controls existent et que le contenu est en place (setCargoViewerView
  // a besoin des bornes pour cadrer). Idempotent : sans changement d'état,
  // c'est un no-op.
  applyLayoutEditingToScene();
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
    const slot = physSlotForLabel(view, currentOrientation, currentMirror);
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

// Positions RÉSOLUES du dernier rendu, une entrée par module affiché.
// La disposition perso est une surcharge PARTIELLE (seuls les modules
// déplacés y figurent) : pour amorcer un brouillon d'éditeur il faut les
// positions de TOUS les modules, y compris ceux placés par la
// reconstruction automatique. Rien d'autre ne les expose.
window.getResolvedCargoGrid = function getResolvedCargoGrid() {
  const holds = lastResolvedLayout.map((l) => l.hold);
  return lastResolvedLayout.map((l) => ({
    name: l.hold.name,
    // Clé désambiguïsée IDENTIQUE à celle du packer (brique A′) : indispensable
    // pour que la réservation stockée soit retrouvée module par module.
    moduleKey: moduleKey(l.hold, holds),
    dimensions: { x: l.hold.dimensions.x, y: l.hold.dimensions.y, z: l.hold.dimensions.z },
    capacity: l.hold.capacity,
    maxContainerSize: l.hold.maxContainerSize,
    position: { x: l.worldPos[0], y: l.worldPos[1], z: l.worldPos[2] },
  }));
};

// --- Glisser-déposer d'une grille (mode édition) -------------------------
// Le curseur est projeté sur le plan du sol (Y=0) ; le module suit, aimanté
// sur 1 SCU (UNIT = 1,25 m) et borné à >= 0 pour que tous les modules restent
// en coordonnées positives (voir la surcharge dans renderCargoViewer3D).
// Le glisser se fait dans le plan qu'on REGARDE : vu de dessus on déplace au
// sol (X/Z), vu de face ou de côté on déplace en hauteur (Y) + un axe
// horizontal. Sans ça, la hauteur serait inéditable — vue de dessus, un
// changement de hauteur est invisible. La rotation libre étant désactivée en
// édition, la caméra est toujours sur l'une des 6 vues préréglées, donc
// l'axe dominant est franc et le plan jamais ambigu.
const dragPlane = new THREE.Plane();
// Axes déplacés selon la normale du plan : "y" -> X/Z, "z" -> X/Y, "x" -> Z/Y.
let dragAxes = { normal: "y", a: "x", b: "z" };

function pickDragAxes() {
  const dir = new THREE.Vector3().subVectors(controls.target, camera.position);
  const ax = Math.abs(dir.x);
  const ay = Math.abs(dir.y);
  const az = Math.abs(dir.z);
  if (ay >= ax && ay >= az) return { normal: "y", a: "x", b: "z" }; // dessus/dessous
  if (az >= ax) return { normal: "z", a: "x", b: "y" }; // avant/arrière
  return { normal: "x", a: "z", b: "y" }; // gauche/droite
}
const dragRaycaster = new THREE.Raycaster();
const dragPointerNdc = new THREE.Vector2();
const dragHitPoint = new THREE.Vector3();
let dragTarget = null;
let dragMoved = false;
let dragGrabOffsetA = 0;
let dragGrabOffsetB = 0;
// Mode « tout déplacer » (bouton de l'éditeur admin, voir js/app.js) : un
// glisser translate TOUTES les grilles ensemble en gardant leurs écarts, au
// lieu de ne bouger que celle saisie. moveAllStart mémorise, au début du
// geste, l'origine de chaque module sur les 2 axes mobiles — on applique
// ensuite à tous le même delta que celui du module saisi (l'ancre), depuis
// ces origines de départ (pas cran par cran, pour éviter toute dérive).
let layoutMoveAll = false;
let moveAllStart = null;
let moveAllAnchor = null;
window.setCargoLayoutMoveAll = function setCargoLayoutMoveAll(on) {
  layoutMoveAll = !!on;
};

// Demi-dimension d'un module le long d'un axe ("x"/"y"/"z") — l'écart entre
// le centre de la boîte de collision et l'origine (coin) du module.
function halfOnAxis(dims, axis) {
  return (axis === "x" ? dims.dx : axis === "y" ? dims.dy : dims.dz) / 2;
}

// Aimante une coordonnée sur la grille de 1,25 m, SANS borne : X et Z sont
// libres. Les borner à >= 0 (ce que faisait l'ancienne version pour les trois
// axes) créait un mur fantôme sur lequel les grilles butaient, le repère
// "droite" — posé côté origine — en tenant lieu à l'écran. Le sol est le seul
// vrai plancher : voir snapFloor, appliqué uniquement à la verticale.
function snapToUnit(v) {
  return Math.round(v / UNIT) * UNIT;
}
// Idem mais borné à >= 0 : réservé à l'axe vertical (Y), le sol. Aucune grille
// ne descend sous le plancher.
function snapFloor(v) {
  return Math.max(0, Math.round(v / UNIT) * UNIT);
}

function updateDragPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  dragPointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  dragPointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  dragRaycaster.setFromCamera(dragPointerNdc, camera);
}

function onLayoutPointerDown(event) {
  if (!editingLayout) return;
  updateDragPointer(event);
  const hits = dragRaycaster.intersectObjects(pickMeshes, false);
  if (!hits.length) return;
  dragTarget = hits[0].object;
  dragMoved = false;
  dragAxes = pickDragAxes();
  // Plan passant par la position COURANTE du module (pas par l'origine du
  // monde) : un module déjà surélevé par la reconstruction auto est loin du
  // plan Y=0, et le rayon y croiserait bien à côté — décalage de préhension
  // faussé, la grille sauterait au premier mouvement.
  const n = dragAxes.normal;
  const normalVec = new THREE.Vector3(n === "x" ? 1 : 0, n === "y" ? 1 : 0, n === "z" ? 1 : 0);
  dragPlane.setFromNormalAndCoplanarPoint(normalVec, dragTarget.position);
  if (!dragRaycaster.ray.intersectPlane(dragPlane, dragHitPoint)) {
    dragTarget = null;
    return;
  }
  const dims = dragTarget.userData.dims;
  const halfOf = { x: dims.dx / 2, y: dims.dy / 2, z: dims.dz / 2 };
  // Décalage entre le point saisi et l'origine du module, sur les 2 axes
  // mobiles seulement — pour que la grille ne saute pas sous le curseur.
  dragGrabOffsetA = dragHitPoint[dragAxes.a] - (dragTarget.position[dragAxes.a] - halfOf[dragAxes.a]);
  dragGrabOffsetB = dragHitPoint[dragAxes.b] - (dragTarget.position[dragAxes.b] - halfOf[dragAxes.b]);

  // Mode « tout déplacer » : on fige l'origine de départ de chaque module sur
  // les 2 axes mobiles, plus celle de l'ancre saisie (pour en déduire le delta).
  if (layoutMoveAll) {
    moveAllStart = pickMeshes.map((m) => ({
      mesh: m,
      wireframe: m.userData.wireframe,
      a0: m.position[dragAxes.a] - halfOnAxis(m.userData.dims, dragAxes.a),
      b0: m.position[dragAxes.b] - halfOnAxis(m.userData.dims, dragAxes.b),
    }));
    moveAllAnchor = {
      a0: dragTarget.position[dragAxes.a] - halfOf[dragAxes.a],
      b0: dragTarget.position[dragAxes.b] - halfOf[dragAxes.b],
    };
  } else {
    moveAllStart = null;
    moveAllAnchor = null;
  }

  controls.enabled = false; // le geste ne doit pas bouger la caméra
  // Prévient l'app du module visé, pour que l'éditeur admin puisse le
  // sélectionner même sans glisser (un simple clic).
  if (typeof window.onCargoModulePicked === "function") {
    window.onCargoModulePicked(dragTarget.userData.moduleKey);
  }
}

function onLayoutPointerMove(event) {
  if (!editingLayout || !dragTarget) return;
  updateDragPointer(event);
  if (!dragRaycaster.ray.intersectPlane(dragPlane, dragHitPoint)) return;
  const dims = dragTarget.userData.dims;
  const halfOf = { x: dims.dx / 2, y: dims.dy / 2, z: dims.dz / 2 };
  // Seul l'axe vertical (Y) est borné au sol ; les axes horizontaux glissent
  // librement (voir snapToUnit / snapFloor).
  const snapA = dragAxes.a === "y" ? snapFloor : snapToUnit;
  const snapB = dragAxes.b === "y" ? snapFloor : snapToUnit;
  const originA = snapA(dragHitPoint[dragAxes.a] - dragGrabOffsetA);
  const originB = snapB(dragHitPoint[dragAxes.b] - dragGrabOffsetB);
  const currentA = dragTarget.position[dragAxes.a] - halfOf[dragAxes.a];
  const currentB = dragTarget.position[dragAxes.b] - halfOf[dragAxes.b];
  if (originA !== currentA || originB !== currentB) dragMoved = true;

  if (layoutMoveAll && moveAllStart && moveAllAnchor) {
    // On aime le DELTA (pas la position de chaque module) : la reconstruction
    // auto place les modules avec un espacement de 1,5 m, non multiple de
    // 1,25 m, donc leurs origines sont hors grille. Aimanter chaque module
    // séparément les arrondirait différemment et casserait la rigidité du bloc.
    // En n'aimantant que le delta et en l'ajoutant tel quel, chaque module
    // garde exactement son écart d'origine — le bloc reste rigide.
    let deltaA = snapToUnit(dragHitPoint[dragAxes.a] - dragGrabOffsetA - moveAllAnchor.a0);
    let deltaB = snapToUnit(dragHitPoint[dragAxes.b] - dragGrabOffsetB - moveAllAnchor.b0);
    // Sur la verticale, on borne le delta pour que le module le plus bas
    // s'arrête au sol (Y=0), sans déformer le bloc. Axes horizontaux libres.
    if (dragAxes.a === "y") deltaA = Math.max(deltaA, -Math.min(...moveAllStart.map((s) => s.a0)));
    if (dragAxes.b === "y") deltaB = Math.max(deltaB, -Math.min(...moveAllStart.map((s) => s.b0)));
    if (deltaA !== 0 || deltaB !== 0) dragMoved = true;
    moveAllStart.forEach((s) => {
      const na = s.a0 + deltaA;
      const nb = s.b0 + deltaB;
      s.wireframe.position[dragAxes.a] = na;
      s.wireframe.position[dragAxes.b] = nb;
      s.mesh.position[dragAxes.a] = na + halfOnAxis(s.mesh.userData.dims, dragAxes.a);
      s.mesh.position[dragAxes.b] = nb + halfOnAxis(s.mesh.userData.dims, dragAxes.b);
    });
    return;
  }

  dragTarget.position[dragAxes.a] = originA + halfOf[dragAxes.a];
  dragTarget.position[dragAxes.b] = originB + halfOf[dragAxes.b];
  dragTarget.userData.wireframe.position[dragAxes.a] = originA;
  dragTarget.userData.wireframe.position[dragAxes.b] = originB;
}

// Enregistre l'ORIGINE (coin) d'un module — les mêmes coordonnées que
// worldPos[0]/[1]/[2] au rendu, pas le centre de la boîte de collision.
function persistDraggedMesh(mesh) {
  const { dx, dy, dz } = mesh.userData.dims;
  const originX = snapToUnit(mesh.position.x - dx / 2);
  const originY = snapFloor(mesh.position.y - dy / 2);
  const originZ = snapToUnit(mesh.position.z - dz / 2);
  if (typeof window.persistCargoModulePosition === "function") {
    window.persistCargoModulePosition(mesh.userData.moduleKey, originX, originY, originZ);
  }
}

// Enregistre l'origine EXACTE d'un module, sans ré-aimanter — pour le mode
// « tout déplacer » : le bloc a bougé d'un delta déjà aimanté, chaque module
// gardant son écart d'origine (souvent hors grille, voir la reconstruction
// auto). Re-snapper ici les désalignerait entre eux.
function persistMeshExact(mesh) {
  const { dx, dy, dz } = mesh.userData.dims;
  if (typeof window.persistCargoModulePosition === "function") {
    window.persistCargoModulePosition(
      mesh.userData.moduleKey,
      mesh.position.x - dx / 2,
      mesh.position.y - dy / 2,
      mesh.position.z - dz / 2
    );
  }
}

function onLayoutPointerUp() {
  if (editingLayout && dragTarget && dragMoved) {
    // Mode « tout déplacer » : chaque module a bougé, on les enregistre tous
    // sans ré-aimanter (rigidité). Sinon, on aimante le seul module glissé.
    if (layoutMoveAll && moveAllStart) moveAllStart.forEach((s) => persistMeshExact(s.mesh));
    else persistDraggedMesh(dragTarget);
  }
  dragTarget = null;
  dragMoved = false;
  moveAllStart = null;
  moveAllAnchor = null;
  controls.enabled = true;
}

// Sonde de test : la seule façon fiable de vérifier la SÉLECTION au clic
// depuis un test, en projetant la position réelle d'un module à l'écran.
// Cliquer « au centre du canvas » ne prouve rien — l'épine de la Caterpillar
// est étroite et le centre tombe dans le vide (ça m'a valu un faux positif).
// Lecture seule, aucun effet sur l'app.
// Sondes de test (lecture seule) : compter le sol/les axes présents dans la
// scène, et relever la position des 4 étiquettes de repère.
window.__sceneAudit = function () {
  let floor = 0;
  let axes = 0;
  if (contentGroup)
    contentGroup.children.forEach((c) => {
      if (c.userData && c.userData.isFloor) floor++;
      if (c.userData && c.userData.isAxes) axes++;
    });
  return { floor, axes };
};
window.__labelAudit = function () {
  const p = (m) => (m ? { x: m.position.x, z: m.position.z } : null);
  return { front: p(labelMeshes.front), rear: p(labelMeshes.rear), left: p(labelMeshes.left), right: p(labelMeshes.right) };
};

window.__cargoViewerTestProbe = function () {
  const mesh = pickMeshes[0];
  if (!mesh || !camera || !renderer) return null;
  const v = mesh.position.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return {
    x: rect.left + ((v.x + 1) / 2) * rect.width,
    y: rect.top + ((-v.y + 1) / 2) * rect.height,
    moduleKey: mesh.userData.moduleKey,
    pickMeshCount: pickMeshes.length,
    editingLayout,
    enableRotate: controls ? controls.enableRotate : null,
  };
};

// Câble le glisser sur la scène. Idempotent, et SÉPARÉ de setCargoLayoutEditing
// parce que la scène peut naître APRÈS que le mode édition a été demandé :
// enterAdminGridEdit (js/app.js) saute son rendu d'amorçage quand une grille
// publiée existe, donc setCargoLayoutEditing(true) tombait sur renderer/controls
// nuls, sortait sans rien attacher, et laissait enableRotate à true — le clic
// partait alors dans OrbitControls et faisait TOURNER la scène au lieu de
// sélectionner. Le drapeau editingLayout fait foi ; la scène s'y conforme dès
// qu'elle existe (appelé aussi en fin de renderCargoViewer3D).
function applyLayoutEditingToScene() {
  if (!controls || !renderer) return;
  controls.enableRotate = !editingLayout;
  const el = renderer.domElement;
  if (editingLayout) {
    if (layoutEditingWired) return;
    el.addEventListener("pointerdown", onLayoutPointerDown);
    el.addEventListener("pointermove", onLayoutPointerMove);
    window.addEventListener("pointerup", onLayoutPointerUp);
    layoutEditingWired = true;
    setCargoViewerView("top");
  } else {
    if (!layoutEditingWired) return;
    el.removeEventListener("pointerdown", onLayoutPointerDown);
    el.removeEventListener("pointermove", onLayoutPointerMove);
    window.removeEventListener("pointerup", onLayoutPointerUp);
    layoutEditingWired = false;
    dragTarget = null;
    controls.enabled = true;
  }
}

window.setCargoLayoutEditing = function setCargoLayoutEditing(on) {
  editingLayout = !!on;
  applyLayoutEditingToScene();
};

// [data-view] exclut les boutons "Tourner"/"Miroir" (js/app.js) : ils
// partagent la classe .btn-view-sm pour le style (même rangée de boutons
// compacts) mais n'ont pas de vue préréglée à cadrer -- sans ce filtre, un
// clic dessus appelait aussi setCargoViewerView(undefined), qui retombait
// dans la branche générique et déplaçait la caméra vers une position
// arbitraire (bug constaté : "Tourner" semblait réinitialiser la vue 3D).
document.querySelectorAll(".btn-view-sm[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => setCargoViewerView(btn.dataset.view));
});

window.clearCargoViewer3D = function clearCargoViewer3D() {
  clearContent();
  lastFrameKey = null;
  lastLabelMetrics = null;
};
