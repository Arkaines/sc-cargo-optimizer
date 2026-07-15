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

// Une couleur stable par mission (dérivée de son id) plutôt qu'aléatoire, pour
// que la même mission garde toujours la même couleur d'un rendu à l'autre.
function colorForMission(missionId) {
  const hue = ((Number(missionId) || 0) * 47) % 360;
  return new THREE.Color(`hsl(${hue}, 65%, 55%)`);
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
  holds.forEach((hold) => {
    const dx = hold.dimensions.x;
    const dy = hold.dimensions.y;
    const dz = hold.dimensions.z;

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

  // Recentre la caméra/les contrôles sur l'ensemble des modules affichés.
  const totalWidth = offsetX - MODULE_GAP;
  controls.target.set(totalWidth / 2, 2, 2);
  camera.position.set(totalWidth / 2, Math.max(6, totalWidth * 0.4), Math.max(10, totalWidth * 0.7));
  controls.update();
};

window.clearCargoViewer3D = function clearCargoViewer3D() {
  clearContent();
};
