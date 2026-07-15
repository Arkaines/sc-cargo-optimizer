// =========================================================================
// Vue 3D interactive du rangement de cargo (module ES, contrairement au
// reste de l'appli en scripts classiques — Three.js n'est plus distribué
// qu'en modules) : un vaisseau réparti en plusieurs modules de soute (voir
// js/fleetyards.js) est affiché comme une rangée de caissons filaires, avec
// les caisses effectivement rangées (voir js/cargo-packing.js) dedans en
// solide, coloré par mission. Les positions/offsets bruts de FleetYards ne
// permettent pas de recomposer fidèlement l'agencement réel du vaisseau
// (plusieurs modules partagent le même offset), donc chaque module est
// affiché côte à côte plutôt que dans une disposition supposée exacte —
// honnête sur ce qu'on sait vraiment, tout en restant utile pour visualiser
// le contenu de chaque module et le faire tourner à la souris.
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

// Une couleur stable par mission (dérivée de son id) plutôt qu'aléatoire, pour
// que la même mission garde toujours la même couleur d'un rendu à l'autre.
function colorForMission(missionId) {
  const hue = ((Number(missionId) || 0) * 47) % 360;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`);
}

// Étiquette de repère (Avant/Arrière/Gauche/Droite) affichée dans la scène :
// un plan posé à plat sur la base de la grille (comme un marquage au sol),
// visible des deux faces puisque la caméra peut passer dessous en tournant.
function makeAxisLabel(text) {
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
  const geom = new THREE.PlaneGeometry(4, 1);
  const mesh = new THREE.Mesh(
    geom,
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  mesh.rotation.x = -Math.PI / 2; // couché à plat (plan XZ), face visible vers le haut
  return mesh;
}

function ensureScene(container) {
  if (renderer) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12141a);

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
window.renderCargoViewer3D = function renderCargoViewer3D(holds, placements) {
  const container = document.getElementById("cargo-viewer-3d");
  if (!container) return;
  ensureScene(container);
  clearContent();

  let offsetX = 0;
  let maxDy = 0;
  let maxDz = 0;
  holds.forEach((hold) => {
    const dx = hold.dimensions.x;
    const dy = hold.dimensions.y;
    const dz = hold.dimensions.z;
    maxDy = Math.max(maxDy, dy);
    maxDz = Math.max(maxDz, dz);

    // Caisson filaire représentant les limites du module.
    const wireGeom = new THREE.BoxGeometry(dx, dy, dz);
    const wireMesh = new THREE.LineSegments(
      new THREE.EdgesGeometry(wireGeom),
      new THREE.LineBasicMaterial({ color: 0x4dbfdd })
    );
    wireMesh.position.set(offsetX + dx / 2, dy / 2, dz / 2);
    contentGroup.add(wireMesh);

    // Caisses rangées dans ce module.
    placements
      .filter((p) => p.module === hold)
      .forEach((p) => {
        const [sx, sy, sz] = p.size.map((c) => c * UNIT);
        const [px, py, pz] = p.position;
        const geom = new THREE.BoxGeometry(sx * 0.94, sy * 0.94, sz * 0.94); // léger retrait visuel entre caisses
        const mat = new THREE.MeshStandardMaterial({
          color: colorForMission(p.entry.mission ? p.entry.mission.id : 0),
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(offsetX + px * UNIT + sx / 2, py * UNIT + sy / 2, pz * UNIT + sz / 2);
        contentGroup.add(mesh);

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geom),
          new THREE.LineBasicMaterial({ color: 0x12141a })
        );
        edges.position.copy(mesh.position);
        contentGroup.add(edges);
      });

    offsetX += dx + MODULE_GAP;
  });

  const totalWidth = offsetX - MODULE_GAP;
  sceneBounds = { minX: 0, maxX: totalWidth, minY: 0, maxY: maxDy, minZ: 0, maxZ: maxDz };
  const midX = totalWidth / 2;
  const midY = maxDy / 2;
  const midZ = maxDz / 2;

  // Étiquettes Avant/Arrière/Gauche/Droite en bordure de la scène : un simple
  // repère d'orientation pour ce rendu (pas l'avant/arrière réel du
  // vaisseau, inconnu — voir le commentaire en tête de fichier). Avant = +Z :
  // en repère main droite avec l'axe Y vers le haut, faire face à +Z met la
  // droite du côté -X et la gauche du côté +X (règle de la main droite,
  // pas l'inverse) — d'où gauche posée du côté totalWidth+margin ci-dessous.
  const margin = Math.max(2, totalWidth * 0.15);
  const front = makeAxisLabel(t("axisFront"));
  front.position.set(midX, 0, maxDz + margin);
  contentGroup.add(front);
  const rear = makeAxisLabel(t("axisRear"));
  rear.position.set(midX, 0, -margin);
  contentGroup.add(rear);
  const left = makeAxisLabel(t("axisLeft"));
  left.position.set(totalWidth + margin, 0, midZ);
  contentGroup.add(left);
  const right = makeAxisLabel(t("axisRight"));
  right.position.set(-margin, 0, midZ);
  contentGroup.add(right);

  // Recentre la caméra/les contrôles sur l'ensemble des modules affichés.
  controls.target.set(midX, midY, midZ);
  camera.position.set(midX, Math.max(6, totalWidth * 0.4), Math.max(10, totalWidth * 0.7));
  controls.update();
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
  // Cohérent avec les étiquettes ci-dessus (Avant = +Z, Gauche = +X) : la
  // "vue gauche" place la caméra du côté gauche (+X) pour regarder vers le
  // vaisseau depuis ce côté.
  if (view === "front") camera.position.set(midX, midY, midZ + distance);
  else if (view === "rear") camera.position.set(midX, midY, midZ - distance);
  else if (view === "left") camera.position.set(midX + distance, midY, midZ);
  else if (view === "right") camera.position.set(midX - distance, midY, midZ);
  controls.update();
}
window.setCargoViewerView = setCargoViewerView;

document.querySelectorAll(".btn-view-sm").forEach((btn) => {
  btn.addEventListener("click", () => setCargoViewerView(btn.dataset.view));
});

window.clearCargoViewer3D = function clearCargoViewer3D() {
  clearContent();
};
