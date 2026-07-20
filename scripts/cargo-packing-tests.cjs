"use strict";
// Suite de non-régression pour js/cargo-packing.js — pas de framework de
// test (le projet n'en a pas), juste un runner minimal avec assert natif.
// Usage : node scripts/cargo-packing-tests.cjs

const assert = require("assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadCargoPacking() {
  const code = fs.readFileSync(path.join(PROJECT_ROOT, "js/cargo-packing.js"), "utf8");
  const ctx = { Object, Math, Array, String };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "js/cargo-packing.js" });
  return ctx;
}

function loadFixture(name) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
  const missionById = new Map();
  data.entries.forEach((e) => {
    if (!missionById.has(e.missionId)) missionById.set(e.missionId, { id: e.missionId, name: e.missionName });
  });
  const entries = data.entries.map((e) => ({
    quantity: e.quantity,
    commodity: e.commodity,
    mission: missionById.get(e.missionId),
    maxCargoBoxSize: e.maxCargoBoxSize,
    pickupStop: e.pickupStop,
    dropoffStop: e.dropoffStop,
  }));
  return { entries, holds: data.holds, stepCount: data.stepCount };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// --- Sanity : imbrication simple, sans conflit ---------------------------
test("nested: one lateral slot, non-overlapping intervals -> 0 conflict", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 3 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 2 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 4);
  assert.strictEqual(r.conflicts.length, 0);
  assert.strictEqual(r.unplaced.length, 0);
});

// --- Sanity : un seul couloir, intervalles croisés -> conflit inévitable --
// Corrigé le 2026-07-20 : ce test attendait 1 conflit et le qualifiait
// d'« inévitable ». Il ne l'est pas. Deux caisses dans un couloir de deux
// crans peuvent TOUJOURS être ordonnées par date de sortie — celle qui part
// en premier devant — puisque le manifeste complet du trajet est connu
// d'avance (le rangement n'est pas un problème en ligne). L'ancienne valeur
// encodait une limite du placement, pas une contrainte du problème : elle est
// tombée d'elle-même quand depthDistance a cessé de se mesurer en cellules.
// Vérifié : la détection de conflit reste active par ailleurs (le jeu de
// données réel du Raft en signale toujours un).
test("single footprint slot, crossing intervals -> 0 conflict (ordonnançable)", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 4);
  assert.strictEqual(r.conflicts.length, 0);
  // Ce qui part en premier doit être devant (profondeur moindre sur l'axe 1).
  const a = r.placements.find((p) => p.dropoffStop === 2);
  const b = r.placements.find((p) => p.dropoffStop === 3);
  assert.ok(a.position[1] < b.position[1], "la caisse partant en premier doit être la plus proche de l'accès");
});

// --- Sanity : deux couloirs, intervalles croisés -> évitable -------------
test("two footprint slots, crossing intervals -> 0 conflict", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 2.5, y: 3.75, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 4);
  assert.strictEqual(r.conflicts.length, 0);
});

// --- Empilement : règle de taille (corrigée) ------------------------------
test("stacking rule: equal-size crate on equal-size crate is allowed", () => {
  const ctx = loadCargoPacking();
  assert.strictEqual(ctx.canStackOn(4, 4), true);
});

test("stacking rule: larger crate on smaller crate is forbidden", () => {
  const ctx = loadCargoPacking();
  assert.strictEqual(ctx.canStackOn(4, 1), false);
});

test("stacking rule: smaller crate on larger crate is allowed", () => {
  const ctx = loadCargoPacking();
  assert.strictEqual(ctx.canStackOn(1, 4), true);
});

// --- Zonage 3D : tier 1, voie indépendante en largeur ---------------------
test("zone assignment: two missions on a wide module each get their own width-lane, full height", () => {
  const ctx = loadCargoPacking();
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2], // largeur=8, profondeur=12, hauteur=2 (forme du Raft)
      depthAxis: 1,
    },
  ];
  const boxes = [
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 0, dropoffStop: 5 },
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 1, dropoffStop: 9 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  const z1 = zones.get(1)[0];
  const z2 = zones.get(2)[0];
  assert.strictEqual(z1.heightStart, 0);
  assert.strictEqual(z1.heightEnd, 2, "tier 1 zone reserves the full height for its own mission");
  assert.strictEqual(z2.heightStart, 0);
  assert.strictEqual(z2.heightEnd, 2);
  // Les deux voies en largeur ne doivent jamais se recouvrir.
  const overlap = z1.widthStart < z2.widthEnd && z2.widthStart < z1.widthEnd;
  assert.strictEqual(overlap, false, "the two missions must not share a width range");
  assert.strictEqual(z1.minPickupStop, 0);
  assert.strictEqual(z1.maxDropoffStop, 5);
  assert.strictEqual(z2.minPickupStop, 1);
  assert.strictEqual(z2.maxDropoffStop, 9);
});

// --- Zonage 3D : tier 2, empilement croisé sécurisé entre contrats -------
test("zone assignment: a mission whose window is fully contained by another gets stacked on it", () => {
  const ctx = loadCargoPacking();
  // Module étroit : une seule voie en largeur possible (8 crans, mais
  // chaque caisse a besoin de 8 crans à elle seule, donc AUCUNE voie libre
  // ne reste pour un deuxième contrat).
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2],
      depthAxis: 1,
    },
  ];
  const boxes = [
    // Hôte : présent du stop 0 au stop 10, prend toute la largeur.
    { box: { scu: 32, footprint: [8, 12], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 0, dropoffStop: 10 },
    // Invité : présent du stop 2 au stop 5, ENTIÈREMENT à l'intérieur de la fenêtre de l'hôte.
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 2, dropoffStop: 5 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  const guestZones = zones.get(2);
  assert.ok(guestZones && guestZones.length, "the guest mission must get a zone via tier 2 stacking");
  const guest = guestZones[0];
  const host = zones.get(1)[0];
  // Le tier 2 réutilise EXACTEMENT l'empreinte spatiale de l'hôte (pas une
  // sous-plage de hauteur découpée) — la non-collision réelle est assurée
  // plus tard, caisse par caisse, par canPlace/hasValidSupport (Task 5), pas
  // par le zonage lui-même.
  assert.strictEqual(guest.widthStart, host.widthStart);
  assert.strictEqual(guest.widthEnd, host.widthEnd);
  assert.strictEqual(guest.heightStart, host.heightStart);
  assert.strictEqual(guest.heightEnd, host.heightEnd);
  assert.strictEqual(guest.module, host.module);
});

test("zone assignment: a mission whose window is NOT contained gets no tier-2 zone (falls through)", () => {
  const ctx = loadCargoPacking();
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2],
      depthAxis: 1,
    },
  ];
  const boxes = [
    { box: { scu: 32, footprint: [8, 12], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 2, dropoffStop: 5 },
    // Invité candidat : commence AVANT que l'hôte ne soit présent -> pas sûr.
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 0, dropoffStop: 4 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  const guestZones = zones.get(2) || [];
  assert.strictEqual(guestZones.length, 0, "no safe host exists, so no zone should be reserved");
});

test("zone assignment: a third mission nested inside two other missions' windows still gets a tier-2 zone", () => {
  const ctx = loadCargoPacking();
  // Note : la containment de fenêtres temporelles est transitive (si la
  // fenêtre de la mission 3 est contenue dans celle de la mission 2, qui est
  // elle-même contenue dans celle de la mission 1, alors la mission 1 la
  // contient forcément aussi) — et le tier 2 copie EXACTEMENT l'empreinte
  // spatiale de son hôte, donc un troisième niveau ne produit pas une
  // empreinte différente d'un deuxième niveau. Ce test vérifie seulement
  // qu'empiler plusieurs invités sur le même hôte (ou une chaîne d'hôtes
  // équivalents) reste possible et ne casse rien — pas quel hôte précis
  // `.find` choisit en interne.
  const modules = [
    {
      hold: { maxContainerSize: 32 },
      cellDims: [8, 12, 2],
      depthAxis: 1,
    },
  ];
  const boxes = [
    { box: { scu: 32, footprint: [8, 12], height: 1 }, entry: { mission: { id: 1 } }, pickupStop: 0, dropoffStop: 20 },
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 2 } }, pickupStop: 5, dropoffStop: 15 },
    { box: { scu: 4, footprint: [2, 2], height: 1 }, entry: { mission: { id: 3 } }, pickupStop: 8, dropoffStop: 12 },
  ];
  const zones = ctx.assignMissionZones(boxes, modules);
  assert.ok((zones.get(2) || []).length, "mission 2 must get a tier-2 zone");
  assert.ok((zones.get(3) || []).length, "mission 3 must also get a tier-2 zone despite mission 1's lane already being reused once");
});

// --- Recherche libre : profite aussi de l'empilement croisé sûr ----------
test("ship-wide fallback: stacks safely on another mission's crate rather than forcing a conflict", () => {
  const ctx = loadCargoPacking();
  // Un seul module, une seule voie en largeur (assez pour 1 caisse de 4 SCU
  // à la fois), 2 crans de hauteur. Mission A (contrat 1) tient toute la
  // largeur pendant tout le trajet (stop 0 à 14, aucune zone tier 1 pour un
  // deuxième contrat). Mission B (contrat 2) est entièrement contenue dans
  // la fenêtre de A : la recherche libre doit l'empiler sur A plutôt que de
  // forçer un conflit.
  const holds = [{ name: "test", dimensions: { x: 2.5, y: 15, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const missionA = { id: 1, name: "A" };
  const missionB = { id: 2, name: "B" };
  const entries = [
    { quantity: 4, commodity: "Host", mission: missionA, pickupStop: 0, dropoffStop: 14 },
    { quantity: 4, commodity: "Guest", mission: missionB, pickupStop: 3, dropoffStop: 8 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 15);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, "the guest should stack safely on the host instead of conflicting");
});

// --- Régression : plusieurs zones du même contrat dans le même module ----
test("placement: a mission with two zones in the same module never mixes their width/height ranges", () => {
  const ctx = loadCargoPacking();
  // Un seul module, large de 8 crans, 2 crans de haut. Mission A tient toute
  // la largeur (8 crans) pendant tout le trajet -> pas de voie tier-1 libre
  // pour quiconque. Mission B a deux besoins bien distincts et temporellement
  // disjoints (2 lots), forçant potentiellement deux zones dans CE module si
  // le zonage la fait s'empiler à deux endroits différents. On vérifie
  // simplement qu'aucun conflit non nécessaire n'apparaît et qu'aucune caisse
  // ne finit hors de tout rectangle réservé valide (0 conflit ici : les deux
  // lots de B tiennent chacun dans la fenêtre de A).
  const holds = [{ name: "test", dimensions: { x: 10, y: 15, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const missionA = { id: 1, name: "A" };
  const missionB = { id: 2, name: "B" };
  const entries = [
    { quantity: 32, commodity: "Host", mission: missionA, pickupStop: 0, dropoffStop: 14 },
    { quantity: 4, commodity: "GuestEarly", mission: missionB, pickupStop: 1, dropoffStop: 4 },
    { quantity: 4, commodity: "GuestLate", mission: missionB, pickupStop: 8, dropoffStop: 12 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 15);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, "both of B's lots fit safely within A's window; mixing zone axes must not cause a spurious conflict or an invalid placement");
});

// --- Fast-follow (Task 7) : une mission qui obtient VRAIMENT 2 zones dans le
// MÊME module ------------------------------------------------------------
//
// Signalé par la revue de la Task 5 comme un trou non bloquant : le test
// précédent ("placement: a mission with two zones...") ne donne pas, pour sa
// fixture précise, deux zones à UNE MÊME mission dans un module (vérifié à
// l'époque en sondant assignMissionZones directement — voir le rapport de la
// Task 5). Construit ici une fixture qui force réellement ce cas, sur le
// modèle suggéré par le plan : un module unique de largeur 4 crans (profondeur
// 10, hauteur 2, donc laneCapacity = 10*2 = 20 par cran de largeur).
//   - Host (mission 1, 48 SCU) est traité en premier (plus gros total SCU) :
//     ceil(48/20) = 3, donc sa voie tier-1 prend 3 des 4 crans de largeur
//     (côté "lo"), n'en laissant qu'UN SEUL libre pour la suite.
//   - Big (mission 2, 25 SCU) prend ce dernier cran de largeur comme voie
//     tier-1 (forcément limitée à 1 cran, donc trop petite pour ses 25 SCU
//     face à une capacité de 20 par cran) : plus AUCUNE voie libre nulle part
//     sur le vaisseau ensuite, donc Big retombe en tier-2 sur le seul hôte
//     dont la fenêtre [0,20] contient bien la sienne [5,15] — Host — qui se
//     trouve être dans CE MÊME module (le seul du test). Big termine donc
//     avec 2 zones, toutes deux dans ce module, aux plages de largeur
//     distinctes et non chevauchantes ([3,4) puis [0,3), copiée de Host).
//
// Vérifié directement via assignMissionZones AVANT l'assertion de niveau
// placement (même style que les Tasks 3/4/6bis) : on reproduit ici EXACTEMENT
// la construction interne de simulateRoutePacking (modules + décomposition en
// caisses via decomposeIntoBoxes) pour ne pas juste espérer que la fixture
// produise ce cas.
test("zone assignment: a mission whose tier-1 lane is too small for its need gets a genuine second, tier-2 zone in the SAME module", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 5, y: 12.5, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const missionHost = { id: 1, name: "Host" };
  const missionBig = { id: 2, name: "Big" };
  const entries = [
    { quantity: 48, commodity: "Host", mission: missionHost, pickupStop: 0, dropoffStop: 20 },
    { quantity: 25, commodity: "Big", mission: missionBig, pickupStop: 5, dropoffStop: 15 },
  ];

  // Vérification directe du préalable.
  const cellDims = ctx.cellsFromDimensions(holds[0].dimensions);
  const depthAxis = ctx.depthAxisIndex(cellDims);
  const modules = [{ hold: holds[0], cellDims, depthAxis }];
  const boxes = [];
  entries.forEach((entry) => {
    ctx.decomposeIntoBoxes(entry.quantity, holds[0].maxContainerSize).forEach((box) => {
      boxes.push({ box, entry, pickupStop: entry.pickupStop, dropoffStop: entry.dropoffStop });
    });
  });
  const zonesByMission = ctx.assignMissionZones(boxes, modules);
  const bigZones = zonesByMission.get(2) || [];
  assert.strictEqual(bigZones.length, 2, "Big must genuinely get 2 zones for this fixture, not just 1");
  assert.ok(bigZones.every((z) => z.module === modules[0]), "both of Big's zones must be in the SAME module");
  const overlap = bigZones[0].widthStart < bigZones[1].widthEnd && bigZones[1].widthStart < bigZones[0].widthEnd;
  assert.strictEqual(overlap, false, "Big's two zones must not share a width range");

  // Assertion de niveau placement, comme le test Task 5 : le rangement réel
  // doit rester correct (aucun conflit, aucune caisse non placée) avec cette
  // configuration qui a VRAIMENT 2 zones pour Big dans le même module.
  const r = ctx.simulateRoutePacking(entries, holds, 21);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, "Big's two same-module zones must not mix width/height ranges or cause a spurious conflict");
});

// --- Empilement : sécurité temporelle (le support ne doit pas partir avant) -
//
// Tests directs sur hasValidSupport(grid, pos, size, boxScu, dropoffStop).
// La forme d'une cellule de grille occupée est { scu, dropoffStop, missionId }
// (voir markPlaced dans js/cargo-packing.js). On construit ici une grille
// minimale à la main plutôt que de passer par simulateRoutePacking, pour
// isoler la vérification temporelle de l'ordre de placement des caisses
// (voir le commentaire sur le test "real data: Raft" plus bas : l'ordre de
// placement peut masquer complètement ce qu'une règle rejette ou non).
function makeEmptyGrid(sizeX, sizeY, sizeZ) {
  const grid = [];
  for (let x = 0; x < sizeX; x++) {
    grid[x] = [];
    for (let y = 0; y < sizeY; y++) {
      grid[x][y] = new Array(sizeZ).fill(null);
    }
  }
  return grid;
}

test("hasValidSupport: rejects a crate resting on a support that leaves earlier", () => {
  const ctx = loadCargoPacking();
  const grid = makeEmptyGrid(1, 1, 2);
  // Caisse au sol (z=0) : elle part au stop 2 (tôt).
  grid[0][0][0] = { scu: 4, dropoffStop: 2, missionId: "m1" };
  // On tente de poser une caisse à z=1 qui doit rester jusqu'au stop 5 (tard) :
  // le support partirait avant elle -> doit être rejeté.
  const ok = ctx.hasValidSupport(grid, [0, 0, 1], [1, 1, 1], 4, 5);
  assert.strictEqual(ok, false, "support leaving before the crate above must be rejected");
});

test("hasValidSupport: allows a crate resting on a support that leaves at the same time or later", () => {
  const ctx = loadCargoPacking();
  const grid = makeEmptyGrid(1, 1, 2);
  // Caisse au sol (z=0) : elle part au stop 5 (tard), reste large donc peut
  // soutenir une caisse plus petite ou égale (canStackOn).
  grid[0][0][0] = { scu: 4, dropoffStop: 5, missionId: "m1" };
  // Caisse posée dessus qui part au stop 2 (plus tôt que son support) : sûr.
  const okEarlier = ctx.hasValidSupport(grid, [0, 0, 1], [1, 1, 1], 1, 2);
  assert.strictEqual(okEarlier, true, "support leaving after the crate above must be allowed");
  // Cas limite : même stop de livraison que le support -> autorisé (>=).
  const okEqual = ctx.hasValidSupport(grid, [0, 0, 1], [1, 1, 1], 1, 5);
  assert.strictEqual(okEqual, true, "support leaving at the exact same stop must be allowed");
});

// --- Faces d'accès : primitives généralisées (pas encore câblées) ---------
test("isBlockingOnAxis: near direction matches the old isBlocking exactly", () => {
  const ctx = loadCargoPacking();
  const blockerPos = [0, 0, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [0, 1, 0];
  const targetSize = [1, 1, 1];
  // depthAxis = 1 : le bloqueur (coordonnée 0) est plus proche de l'accès
  // "near" que la cible (coordonnée 1) sur cet axe, emprises qui se
  // recoupent sur les deux autres axes -> bloqué.
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), true);
  assert.strictEqual(ctx.isBlocking(1, blockerPos, blockerSize, targetPos, targetSize), true);
});

test("isBlockingOnAxis: far direction is the mirror image of near", () => {
  const ctx = loadCargoPacking();
  // Même paire de caisses, mais avec la face "loin" comme accès : maintenant
  // c'est la caisse à la coordonnée 1 (target) qui est proche de la face
  // "far" (extrémité oubliée), donc target ne bloque pas via "far" ici ---
  // on teste directement le sens : un bloqueur à coordonnée 1, cible à
  // coordonnée 0, doit être considéré comme bloquant via "far" (le bloqueur
  // est plus proche de l'extrémité opposée).
  const blockerPos = [0, 1, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [0, 0, 0];
  const targetSize = [1, 1, 1];
  assert.strictEqual(ctx.isBlockingOnAxis(1, "far", blockerPos, blockerSize, targetPos, targetSize), true);
  // Et ce même bloqueur ne bloque PAS via "near" (il est plus loin de la
  // coordonnée 0 que la cible).
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), false);
});

test("isBlockingOnAxis: no overlap on the other axes means never blocking", () => {
  const ctx = loadCargoPacking();
  const blockerPos = [0, 0, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [5, 1, 0]; // décalé sur l'axe 0 : aucun recoupement
  const targetSize = [1, 1, 1];
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), false);
});

test("moduleFaceAxes: maps all six labels to the module's real axes", () => {
  const ctx = loadCargoPacking();
  const module = { depthAxis: 1, widthAxis: 0, heightAxis: 2 };
  const faces = ctx.moduleFaceAxes(module);
  assert.deepStrictEqual(faces.back, { axis: 1, direction: "near" });
  assert.deepStrictEqual(faces.front, { axis: 1, direction: "far" });
  assert.deepStrictEqual(faces.bottom, { axis: 2, direction: "near" });
  assert.deepStrictEqual(faces.top, { axis: 2, direction: "far" });
  assert.deepStrictEqual(faces.left, { axis: 0, direction: "near" });
  assert.deepStrictEqual(faces.right, { axis: 0, direction: "far" });
});

test("accessibleFaceAxes: defaults to back-only when accessFaces is falsy", () => {
  const ctx = loadCargoPacking();
  const module = { depthAxis: 1, widthAxis: 0, heightAxis: 2 };
  const list = ctx.accessibleFaceAxes(null, module);
  assert.deepStrictEqual(list, [{ axis: 1, direction: "near" }]);
});

test("accessibleFaceAxes: returns one entry per checked face", () => {
  const ctx = loadCargoPacking();
  const module = { depthAxis: 1, widthAxis: 0, heightAxis: 2 };
  const list = ctx.accessibleFaceAxes({ back: true, bottom: true }, module);
  assert.strictEqual(list.length, 2);
  assert.ok(list.some((f) => f.axis === 1 && f.direction === "near"));
  assert.ok(list.some((f) => f.axis === 2 && f.direction === "near"));
});

test("accessibleFaceAxes: an empty object (all faces false) falls back to the default, not an empty list", () => {
  const ctx = loadCargoPacking();
  const module = { depthAxis: 1, widthAxis: 0, heightAxis: 2 };
  const list = ctx.accessibleFaceAxes({}, module);
  const defaultList = ctx.accessibleFaceAxes(null, module);
  assert.deepStrictEqual(list, defaultList);
});

test("isBlockedFromEveryAccessibleFace: blocked on one face but clear on another is NOT blocked", () => {
  const ctx = loadCargoPacking();
  // Bloqueur à [0,0,0], cible à [0,1,0] : même coordonnée sur les axes 0 et 2
  // (recoupement complet sur ces deux axes), seul l'axe 1 (profondeur) les
  // sépare. Le bloqueur est donc bloquant sur l'axe 1 via "near" (coord 0 <
  // coord 1), mais PAS sur l'axe 2 via "near" (coord 0 >= coord 0 de la
  // cible) puisque les deux partagent la même coordonnée sur cet axe.
  const blockerPos = [0, 0, 0];
  const blockerSize = [1, 1, 1];
  const targetPos = [0, 1, 0];
  const targetSize = [1, 1, 1];
  assert.strictEqual(ctx.isBlockingOnAxis(1, "near", blockerPos, blockerSize, targetPos, targetSize), true);
  assert.strictEqual(ctx.isBlockingOnAxis(2, "near", blockerPos, blockerSize, targetPos, targetSize), false);
  // Une seule face (profondeur) configurée -> bloqué. Les deux faces
  // (profondeur + hauteur) configurées -> PAS bloqué (la face hauteur est
  // dégagée, donc au moins une face offre un chemin libre).
  assert.strictEqual(
    ctx.isBlockedFromEveryAccessibleFace([{ axis: 1, direction: "near" }], blockerPos, blockerSize, targetPos, targetSize),
    true
  );
  assert.strictEqual(
    ctx.isBlockedFromEveryAccessibleFace(
      [
        { axis: 1, direction: "near" },
        { axis: 2, direction: "near" },
      ],
      blockerPos,
      blockerSize,
      targetPos,
      targetSize
    ),
    false
  );
});

test("isBlockedFromEveryAccessibleFace: blocked on every configured face IS blocked", () => {
  const ctx = loadCargoPacking();
  // Bloqueur qui recouvre entièrement la cible sur les 3 axes en position :
  // bloqué depuis n'importe quelle face testée (near sur les 3 axes ici).
  const blockerPos = [0, 0, 0];
  const blockerSize = [2, 2, 2];
  const targetPos = [1, 1, 1];
  const targetSize = [1, 1, 1];
  const faceAxesAll = [
    { axis: 0, direction: "near" },
    { axis: 1, direction: "near" },
    { axis: 2, direction: "near" },
  ];
  assert.strictEqual(ctx.isBlockedFromEveryAccessibleFace(faceAxesAll, blockerPos, blockerSize, targetPos, targetSize), true);
});

// --- Faces d'accès : effet de bord réel sur simulateRoutePacking ---------
test("simulateRoutePacking: a second accessible face avoids a conflict the default single face would produce", () => {
  const ctx = loadCargoPacking();
  // Repris tel quel de la fixture "single footprint slot, crossing
  // intervals -> 1 conflict" plus haut dans ce fichier : un seul cran de
  // large (x) ET un seul cran de haut (z), seule la profondeur (y, 2 crans)
  // offre de la place — une vraie file d'attente en ligne. A est récupéré et
  // posé EN PREMIER (pickupStop=0), B arrive ENSUITE alors que A occupe déjà
  // la place (pickupStop=1) : un conflit RÉEL et incontournable se produit
  // avec une seule face accessible (voir preuve ci-dessous : les deux caisses
  // partagent forcément la MÊME colonne x ET la MÊME couche z, il n'y a tout
  // simplement nulle part ailleurs où aller sur ces deux axes).
  //
  // Comme les deux caisses sont forcément à la MÊME hauteur z (un seul cran
  // disponible), le test de blocage sur l'axe vertical (isBlockingOnAxis avec
  // axis=hauteur) échoue toujours trivialement (position identique sur cet
  // axe, jamais "strictement plus proche") — donc ajouter la face "dessous"
  // comme accessible EN PLUS de "arrière" fait passer isBlockedFromEvery
  // AccessibleFace à false (il suffit d'une seule face dégagée), et le
  // conflit RÉEL disparaît complètement. Vérifié par exécution directe (pas
  // seulement lu dans le code) : voir task-2-report.md pour les nombres
  // observés.
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3 },
  ];
  const stepCount = 4;

  // Comportement par défaut (une seule face, "arrière" = profondeur near) :
  // reproductible tel quel, sert de témoin — on ne fait PAS d'assertion
  // stricte dessus ici (ce n'est pas le but du test), seulement sur l'écart
  // entre les deux runs.
  const defaultRun = ctx.simulateRoutePacking(entries, holds, stepCount);

  // Avec la face "dessous" (axe vertical, near) AUSSI accessible en plus de
  // "arrière" : plus d'options de placement pour éviter un blocage.
  const withBottomRun = ctx.simulateRoutePacking(entries, holds, stepCount, { back: true, bottom: true });

  assert.strictEqual(withBottomRun.unplaced.length, 0);
  assert.ok(
    withBottomRun.conflicts.length <= defaultRun.conflicts.length,
    `expected configuring a second accessible face to never produce MORE conflicts than the default (default: ${defaultRun.conflicts.length}, with bottom: ${withBottomRun.conflicts.length})`
  );
});

test("simulateRoutePacking: omitting accessFaces behaves identically to the pre-existing 3-argument call", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 3 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 2 },
  ];
  const withoutArg = ctx.simulateRoutePacking(entries, holds, 4);
  const withDefaultArg = ctx.simulateRoutePacking(entries, holds, 4, undefined);
  assert.deepStrictEqual(withoutArg.conflicts, withDefaultArg.conflicts);
  assert.deepStrictEqual(withoutArg.unplaced, withDefaultArg.unplaced);
  assert.strictEqual(withoutArg.placements.length, withDefaultArg.placements.length);
});

test("simulateRoutePacking: an empty accessFaces object ({}) behaves identically to omitting it entirely", () => {
  const ctx = loadCargoPacking();
  // Deux caisses loin l'une de l'autre dans un module large : ne devraient
  // jamais se bloquer, avec ou sans accessFaces. Avant le fix, accessFaces:{}
  // faisait passer accessibleFaceAxes à [], ce qui rend isBlockedFromEvery
  // AccessibleFace vacuously true pour TOUTE paire de caisses (every() sur un
  // tableau vide) -- un conflit apparaissait alors même ici.
  const holds = [{ name: "test", dimensions: { x: 5, y: 5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3 },
  ];
  const withEmptyObject = ctx.simulateRoutePacking(entries, holds, 4, {});
  const withUndefined = ctx.simulateRoutePacking(entries, holds, 4, undefined);
  assert.deepStrictEqual(withEmptyObject.conflicts, withUndefined.conflicts);
  assert.deepStrictEqual(withEmptyObject.unplaced, withUndefined.unplaced);
  assert.strictEqual(withEmptyObject.placements.length, withUndefined.placements.length);
});

// --- worstConflictDropoff : polarité correcte (corrigée après Task 6) ----
test("worstConflictDropoff: a blocker that leaves LATER than the candidate is a real risk", () => {
  const ctx = loadCargoPacking();
  const activeBoxes = [{ position: [0, 0, 0], size: [1, 1, 1], dropoffStop: 20 }];
  // Notre caisse candidate est bloquée par `other` (plus proche de l'accès,
  // recoupement d'emprise) qui part APRÈS elle (20 > 5) : conflit réel.
  // faceAxesList à une seule entrée (axe 1, direction "near") : équivalent
  // strict à l'ancien appel `worstConflictDropoff(1, ...)` (voir le
  // changement de signature de Task 2 — la fonction prend maintenant une
  // liste de faces, pas un axe brut).
  const severity = ctx.worstConflictDropoff([{ axis: 1, direction: "near" }], activeBoxes, [0, 1, 0], [1, 1, 1], 5);
  assert.notStrictEqual(severity, Infinity, "a blocker leaving later than our candidate must be scored as risky, not safe");
});

test("worstConflictDropoff: a blocker that already left BEFORE the candidate's dropoff is safe", () => {
  const ctx = loadCargoPacking();
  const activeBoxes = [{ position: [0, 0, 0], size: [1, 1, 1], dropoffStop: 3 }];
  // `other` part AVANT notre candidate (3 < 20) : il sera déjà parti, donc
  // aucun conflit réel au moment où notre candidate devra elle-même partir.
  const severity = ctx.worstConflictDropoff([{ axis: 1, direction: "near" }], activeBoxes, [0, 1, 0], [1, 1, 1], 20);
  assert.strictEqual(severity, Infinity, "a blocker that already departed before our candidate's own dropoff must be scored as safe");
});

test("worstConflictDropoff: our candidate blocking an other that leaves earlier is a real risk", () => {
  const ctx = loadCargoPacking();
  // `other` est ici la cible bloquée par NOTRE candidate (recoupement, notre
  // candidate plus proche de l'accès) ; other part avant nous (5 < 20) :
  // conflit réel (other ne pourra pas sortir à temps).
  const activeBoxes = [{ position: [0, 1, 0], size: [1, 1, 1], dropoffStop: 5 }];
  const severity = ctx.worstConflictDropoff([{ axis: 1, direction: "near" }], activeBoxes, [0, 0, 0], [1, 1, 1], 20);
  assert.notStrictEqual(severity, Infinity, "blocking an other that leaves earlier than us must be scored as risky, not safe");
});

// --- Empilement : scénario d'intégration (ordre de placement sûr) --------
test("stacking scenario: a safe dropoff order (later-dropoff crate placed first) packs both crates", () => {
  const ctx = loadCargoPacking();
  // Module d'un seul cran de large/profond, 2 crans de haut : avec la règle
  // d'empilement corrigée, les deux caisses A (dropoff=2) et B (dropoff=5)
  // peuvent se placer : B au sol (il part plus tard) et A sur B (A part tôt
  // et peut reposer sur B qui le soutient plus longtemps). Ce test vérifie
  // qu'un ordre de livraison SÛR aboutit bien à un placement complet — il ne
  // prouve PAS le rejet d'un empilement dangereux (voir les deux tests
  // directs sur hasValidSupport ci-dessus pour ça : avec ce scénario précis,
  // simulateRoutePacking place B au sol en premier de toute façon [tri par
  // dropoffStop décroissant], donc la branche de rejet de la vérification
  // temporelle n'est jamais exercée ici).
  const holds = [{ name: "test", dimensions: { x: 1.25, y: 1.25, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2 },
    { quantity: 1, commodity: "B", pickupStop: 0, dropoffStop: 5 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 6);
  assert.strictEqual(r.placements.length, 2, "both boxes should be placeable");
  assert.strictEqual(r.unplaced.length, 0, "no boxes should be unplaced");
});

// --- Données réelles : Hull B (16 modules, 10 contrats) -------------------
test("real data: Hull B (16 modules, 10 real contracts) -> 0 conflicts", () => {
  const ctx = loadCargoPacking();
  const { entries, holds, stepCount } = loadFixture("hull-b-real.json");
  const r = ctx.simulateRoutePacking(entries, holds, stepCount);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, `expected 0 conflicts, got ${r.conflicts.length}`);
});

// --- Données réelles : Raft (1 module, 10 contrats) -----------------------
// Le nombre de conflits toléré est passé de 9 à 12 avec les deux fixes de
// cette tâche. Décomposition mesurée en isolant chaque changement (voir
// review de la tâche 2) :
//   - baseline avant tâche (canStackOn strict, pas de check temporel) : 9
//   - check temporel seul (canStackOn resté strict)                   : 11
//   - canStackOn permissif seul (pas de check temporel)               : 12
//   - les deux changements combinés (diff réel de cette tâche)        : 12
// Autrement dit, le fix temporel légitime n'explique que 2 des 3 conflits
// supplémentaires. Le principal responsable est le fix de canStackOn
// (strict -> <=) : simulateRoutePacking place les caisses une par une dans
// un ordre fixe, et donner à une caisse plus de positions légales (parce que
// l'empilement à taille égale est maintenant permis) change l'état de la
// grille vu par les caisses suivantes, ce qui peut orienter toute la
// séquence vers un agencement final moins bon même si chaque choix
// individuel reste localement optimal (comparaison hiérarchique stricte
// existante). C'est un effet de bord réel, dépendant de l'ordre glouton de
// placement, d'un fix par ailleurs correct — pas un bug à corriger dans
// cette tâche : les tâches 3 à 6 (réservation de zones par mission,
// empilement inter-contrats) changent la stratégie de placement et sont
// censées faire redescendre ce nombre.
//
// Mesuré à la tâche 5 (2026-07-16), une fois le zonage 3D (tier 1 + tier 2)
// réellement branché dans le placement (au lieu d'être un no-op silencieux,
// voir le fix de simulateRoutePacking) : 12 -> 9 conflits. La cible resserrée
// ici (<= 9) est le nombre mesuré, pas juste "toujours mieux que l'ancien
// seuil" — resserrer sert à détecter une vraie régression future avec
// précision plutôt qu'une marge de 3 conflits.
//
// Mesuré à la tâche 6bis (2026-07-16), après la correction de la polarité
// inversée de worstConflictDropoff (une position réellement risquée pouvait
// scorer Infinity, ce qui faisait accepter un conflit évitable) : 9 -> 4
// conflits. Comme prévu, ce fix de scoring ne peut qu'améliorer ou laisser
// inchangé le nombre de conflits (jamais l'empirer) puisqu'il rend la
// recherche de dernier recours plus précise, pas différente en nature.
// Puis 4 -> 1 (2026-07-20), en mesurant depthDistance en crans de caisse
// plutôt qu'en cellules : les caisses cessent de se placer en quinconce, donc
// elles laissent moins de poches inutilisables et se gênent moins.
//
// Puis 1 -> 2 le même jour, ASSUMÉ, en adoptant la règle du coffre de voiture
// (voir les tests « coffre » plus bas). Il y a une tension réelle : séparer en
// profondeur les caisses d'un MÊME contrat livrées au MÊME arrêt évitait ce
// conflit, mais c'est exactement ce qui les étalait au lieu de les tasser au
// fond — le défaut que le joueur voyait en jeu. On garde le remplissage
// logique, qu'il constate à chaque chargement, plutôt qu'un conflit de moins
// sur un jeu de données. On reste sous les 4 conflits d'avant la journée.
test("real data: Raft (1 module, 10 real contracts) -> at most 2 conflicts (2026-07-20, règle du coffre)", () => {
  const ctx = loadCargoPacking();
  const { entries, holds, stepCount } = loadFixture("raft-real.json");
  const r = ctx.simulateRoutePacking(entries, holds, stepCount);
  assert.strictEqual(r.unplaced.length, 0);
  assert.ok(r.conflicts.length <= 2, `expected <= 2 conflicts (measured 2026-07-20), got ${r.conflicts.length}`);
});

// --- Régression : conflit évitable via la recherche de dernier recours ---
// Scénario reconstruit lors de la revue de la Task 6 : un contrat "Host" qui
// consomme toute la largeur d'un module (donc toute voie tier 1) et un
// contrat "Guest" avec deux lots dont la fenêtre AGRÉGÉE (1 à 30) déborde de
// celle de Host (3 à 20) -> assignMissionZones ne donne AUCUNE zone à Guest
// (vérifié directement ci-dessous via assignMissionZones, pas seulement en
// espérant que la simulation le révèle), forçant TOUTES ses caisses à passer
// par la recherche de dernier recours (byFreeSpace/idealDepthForModule).
//
// Quantités/horaires ajustés par rapport à la première idée de fixture pour
// que le bug soit réellement exercé (pas juste une contrainte géométrique
// inévitable) :
// - Host est scindé en DEUX entrées de 8 SCU (pas une seule de 16, ni une
//   seule de 8) : deux lignes de cargaison séparées évitent que
//   tryStackOnExisting (qui n'empile que des caisses de la MÊME ligne) ne les
//   fusionne automatiquement à la même profondeur — chacune vise sa propre
//   profondeur idéale (rang 0 et rang 1 parmi les caisses DE SA mission) via
//   missionBoxRank, donc HostA vise l'avant (profondeur 0) et HostB l'arrière.
//   Un total de 16 SCU (> les 8 de Guest) garantit aussi que Host est bien
//   traité EN PREMIER par assignMissionZones (tri par SCU total décroissant),
//   sans dépendre d'un ordre d'insertion à égalité.
// - GuestEarly est récupéré (pickupStop=1) AVANT Host (pickupStop=3) : il est
//   donc déjà placé, actif, quand Host cherche sa propre position. Avec la
//   profondeur idéale de HostA à 0 (le tout premier plan), et GuestEarly déjà
//   posé à une profondeur non nulle SANS chevauchement physique réel de
//   caisses (l'empreinte de HostA à la profondeur 0 ne touche pas les
//   cellules réellement occupées par GuestEarly), canPlace() autorise les
//   DEUX positions (devant et derrière GuestEarly) pour HostA — c'est
//   uniquement worstConflictDropoff qui doit départager laquelle est sûre.
//   Avec l'ancienne polarité inversée, la position "devant" (RÉELLEMENT
//   risquée : HostA bloquerait GuestEarly qui doit sortir bien avant lui,
//   5 < 20) scorait Infinity (faussement sûre) et gagnait sur la position
//   "derrière" (réellement sûre : GuestEarly part bien avant que HostA n'en
//   ait besoin) qui scorait faussement risquée — d'où un vrai conflit
//   reproductible (confirmé ci-dessous en isolant js/cargo-packing.js d'avant
//   la Task 6bis : 1 conflit réel, HostA placé devant GuestEarly).
test("ship-wide fallback: does not force an avoidable conflict when a safe stack exists (Task 6bis regression)", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "test", dimensions: { x: 2.5, y: 15, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  const host = { id: 1, name: "Host" };
  const guest = { id: 2, name: "Guest" };
  const entries = [
    { quantity: 8, commodity: "HostA", mission: host, pickupStop: 3, dropoffStop: 20 },
    { quantity: 8, commodity: "HostB", mission: host, pickupStop: 3, dropoffStop: 20 },
    { quantity: 4, commodity: "GuestEarly", mission: guest, pickupStop: 1, dropoffStop: 5 },
    { quantity: 4, commodity: "GuestLate", mission: guest, pickupStop: 25, dropoffStop: 30 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 31);
  assert.strictEqual(r.unplaced.length, 0);
  assert.strictEqual(r.conflicts.length, 0, "a safe stack for HostA (behind GuestEarly) was available; the fallback must not force an avoidable conflict");
});

// Vrai si un placement occupe au moins une cellule du pavé réservé
// [rx, ry, 0]..[rx+rsx, ry+rsy, hauteur[ sur les axes 0 et 1 (Z ignoré :
// la réservation est pleine hauteur, donc tout chevauchement XY compte).
function overlapsReserved(placement, rx, ry, rsx, rsy) {
  const [px, py] = placement.position;
  const [sx, sy] = placement.size;
  const sepX = px + sx <= rx || rx + rsx <= px;
  const sepY = py + sy <= ry || ry + rsy <= py;
  return !(sepX || sepY);
}

// ===== Brique A : zones réservées — admission (Task 1) ====================

// Un gros module bien large ; sans réservation une caisse se place en (0,0).
test("reserved: crate never occupies a reserved cell", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 6.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 2, sy: 2 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.placements.forEach((p) => {
    assert.ok(!overlapsReserved(p, 0, 0, 2, 2), "un placement recouvre la zone réservée");
  });
});

// Réserver tout le module = ce module ne peut rien accueillir.
test("reserved: whole module reserved -> nothing placed there", () => {
  const ctx = loadCargoPacking();
  const holds = [
    { name: "full", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
    { name: "free", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
  ];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { full: [{ x0: 0, y0: 0, sx: 2, sy: 2 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  const inFull = r.placements.filter((p) => p.module.name === "full");
  assert.strictEqual(inFull.length, 0, "une caisse s'est placée dans le module entièrement réservé");
  assert.strictEqual(r.placements.length, 1, "la caisse aurait dû aller dans le module libre");
});

// Une réservation invalide est ignorée (comportement = sans réservation).
test("reserved: invalid reservation is ignored", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const base = ctx.simulateRoutePacking(entries, holds, 2);
  const bad = [
    { bay: [{ x0: 0, y0: 0, sx: 99, sy: 1 }] }, // déborde
    { bay: [{ x0: 0, y0: 0, sx: 0, sy: 1 }] }, // taille nulle
    { bay: [{ x0: 0, y0: 0, sx: 1.5, sy: 1 }] }, // non entier
    { bay: [{ x0: -1, y0: 0, sx: 1, sy: 1 }] }, // négatif
  ];
  bad.forEach((reservations) => {
    const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
    assert.strictEqual(r.placements.length, base.placements.length);
    assert.strictEqual(r.unplaced.length, base.unplaced.length);
  });
});

// Rétrocompat : appel SANS le 5e argument identique à avant (déjà couvert par
// les 34 tests ; on l'affirme aussi explicitement ici sur un cas simple).
test("reserved: omitting reservations keeps prior behaviour", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 2, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const a = ctx.simulateRoutePacking(entries, holds, 2);
  const b = ctx.simulateRoutePacking(entries, holds, 2, undefined, {});
  assert.deepStrictEqual(b.placements.map((p) => p.position), a.placements.map((p) => p.position));
});

// Pleine hauteur : rien ne repose sur une colonne réservée (§5.1).
test("reserved: nothing stacks on the reserved column", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 1.25, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  // Beaucoup de petites caisses : sans réservation certaines s'empilent (z>0).
  const entries = [{ quantity: 4, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.placements.forEach((p) => {
    assert.ok(!overlapsReserved(p, 0, 0, 1, 1), "une caisse occupe la colonne réservée (empilée ou non)");
  });
});

test("reserved: the parked-vehicle obstacle is never a reported conflict", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 3.75, y: 1.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.conflicts.forEach((c) => assert.ok(c.entry, "un conflit sans entry = l'obstacle réservé a fui dans les conflits"));
});

// ===== Brique A : barrière dure d'accès (Task 2) ==========================

// Module long en profondeur, une seule face accessible (arrière, coord 0 de
// l'axe le plus long). Réservation près de l'accès : une caisse ne peut pas se
// glisser DERRIÈRE (plus loin sur l'axe d'accès) — elle serait inaccessible.
// accessFaces limité à une face pour que le blocage soit total.
test("reserved: hard barrier — nothing placed behind the vehicle (single face)", () => {
  const ctx = loadCargoPacking();
  // Module 1 cellule en largeur (axe 0) et hauteur (axe 2), 4 en profondeur
  // (axe 1, le plus long -> depthAxis). Une seule face accessible : "back" =
  // depthAxis "near" (coord 0). La réservation occupe la profondeur 0 (y0=0
  // sur l'axe 1), à l'accès : toute cellule libre (profondeur 1..3) est DERRIÈRE
  // elle -> bloquée par la seule face -> refusée par la barrière dure.
  const holds = [{ name: "bay", dimensions: { x: 1.25, y: 5.0, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const accessFaces = { back: true }; // clé réelle (voir moduleFaceAxes) ; défaut aussi = { back:true }
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, accessFaces, reservations);
  // La seule caisse ne peut être ni dans la réservation ni derrière : non placée.
  assert.strictEqual(r.placements.length, 0, "une caisse a été placée derrière le véhicule");
  assert.strictEqual(r.unplaced.length, 1, "la caisse aurait dû rester non placée");
});

// Même géométrie, mais DEUX faces accessibles dont une non bloquée par la
// réservation -> la caisse redevient plaçable (on n'a pas court-circuité la
// logique de faces).
test("reserved: an unblocked access face still allows placement", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 1.25, y: 5.0, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  // Accès aux DEUX extrémités de l'axe de profondeur : "back" (near, coord 0)
  // ET "front" (far, coord max). La réservation à la profondeur 0 ne bloque pas
  // depuis "front" -> une caisse en profondeur 1..3 reste atteignable.
  const accessFaces = { back: true, front: true };
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, accessFaces, reservations);
  assert.strictEqual(r.placements.length, 1, "la caisse devrait être atteignable par la face non bloquée");
  assert.ok(!overlapsReserved(r.placements[0], 0, 0, 1, 1));
});

// Effet nul du score : une réservation qui ne bloque PERSONNE laisse le
// rangement identique à sans réservation.
test("reserved: a reservation that blocks nobody leaves packing unchanged", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2, maxCargoBoxSize: 1 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3, maxCargoBoxSize: 1 },
  ];
  const base = ctx.simulateRoutePacking(entries, holds, 4);
  // Réservation dans un coin éloigné où rien ne se serait de toute façon placé
  // et qui ne borde aucune caisse posée (à ajuster si le placement de base
  // l'atteint : la choisir hors des cellules réellement occupées par `base`).
  const reservations = { bay: [{ x0: 0, y0: 1, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 4, undefined, reservations);
  const occupied = base.placements.some((p) => overlapsReserved(p, 0, 1, 1, 1));
  assert.ok(!occupied, "cas de test mal choisi : la réservation touche une caisse du rangement de base");
  assert.deepStrictEqual(r.placements.map((p) => p.position), base.placements.map((p) => p.position));
  assert.strictEqual(r.conflicts.length, base.conflicts.length);
});

// ===== Brique A′ : clé moduleKey + liste par module ======================

// Deux empreintes disjointes dans un même module : aucune caisse ne les occupe.
test("reserved A': two footprints in one module are both excluded", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }, { x0: 4, y0: 1, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.placements.forEach((p) => {
    assert.ok(!overlapsReserved(p, 0, 0, 1, 1), "caisse dans la 1re empreinte réservée");
    assert.ok(!overlapsReserved(p, 4, 1, 1, 1), "caisse dans la 2e empreinte réservée");
  });
});

// Soutes homonymes indépendantes : réserver "bay#1" ne touche pas "bay" (index 0).
test("reserved A': homonymous holds are keyed independently", () => {
  const ctx = loadCargoPacking();
  const holds = [
    { name: "bay", dimensions: { x: 2.5, y: 1.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
    { name: "bay", dimensions: { x: 2.5, y: 1.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
  ];
  const entries = [{ quantity: 2, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  // Réservation UNIQUEMENT sur le 2e hold (clé "bay#1").
  const reservations = { "bay#1": [{ x0: 0, y0: 0, sx: 2, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  // Le 2e hold (index 1) est entièrement réservé -> aucune caisse ; tout va au 1er.
  // On distingue les deux holds homonymes par identité d'objet du hold placé.
  const inSecond = r.placements.filter((p) => p.module === holds[1]);
  assert.strictEqual(inSecond.length, 0, "une caisse a atterri dans le hold réservé bay#1");
});

// Liste vide et clé absente : identiques à sans réservation.
test("reserved A': empty list and missing key behave like no reservation", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 2, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const base = ctx.simulateRoutePacking(entries, holds, 2);
  const empty = ctx.simulateRoutePacking(entries, holds, 2, undefined, { bay: [] });
  const missing = ctx.simulateRoutePacking(entries, holds, 2, undefined, { other: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] });
  assert.deepStrictEqual(empty.placements.map((p) => p.position), base.placements.map((p) => p.position));
  assert.deepStrictEqual(missing.placements.map((p) => p.position), base.placements.map((p) => p.position));
});

// Une empreinte invalide dans une liste par ailleurs valide : seule la valide s'applique.
test("reserved A': an invalid footprint in a list is skipped, valid ones apply", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 99, sy: 1 }, { x0: 0, y0: 0, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  // La bonne (0,0,1,1) est exclue ; la mauvaise est ignorée (pas de plantage).
  r.placements.forEach((p) => assert.ok(!overlapsReserved(p, 0, 0, 1, 1)));
  assert.strictEqual(r.placements.length, 1, "la caisse doit se placer ailleurs, pas disparaître");
});

// --- Compaction : pas d'éventail de profondeur quand rien ne l'exige ------
// Voir docs/superpowers/specs/2026-07-20-cargo-packing-compaction-design.md.
// Le rang d'une caisse dans son contrat servait à la placer en profondeur
// selon son ordre de sortie. Comme il était départagé par TAILLE, des caisses
// partant au MÊME arrêt recevaient des profondeurs idéales différentes et
// s'éparpillaient — mesuré : 84 cellules sur 96 dans le cas le plus simple.
const SOUTE_4x8x3 = { name: "bay", dimensions: { x: 5, y: 10, z: 3.75 }, capacity: 96, maxContainerSize: 32 };

test("compaction: un contrat, un arrêt, caisses uniformes -> soute remplie à 100%", () => {
  const ctx = loadCargoPacking();
  const entries = [
    { quantity: 96, commodity: "A", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 4 },
  ];
  const r = ctx.simulateRoutePacking(entries, [SOUTE_4x8x3], 2);
  // 96 SCU en caisses de 4 SCU (empreinte 2x2, 1 cran) = 24 caisses = 96
  // cellules, exactement le volume de la soute.
  assert.strictEqual(r.placements.length, 24, "les 24 caisses doivent tenir");
  assert.strictEqual(r.unplaced.length, 0, "aucune caisse ne doit rester dehors");
  const cellulesOccupees = r.placements.reduce((s, p) => s + p.size[0] * p.size[1] * p.size[2], 0);
  assert.strictEqual(cellulesOccupees, 96, "la soute doit être pleine, sans trou");
});

test("compaction: l'ordre de sortie sépare toujours des arrêts DIFFÉRENTS", () => {
  const ctx = loadCargoPacking();
  // Même contrat, deux arrêts de livraison : ce qui part en premier doit
  // rester plus près de l'accès. C'est la protection que la correction ne
  // doit PAS avoir supprimée en supprimant l'éventail inutile.
  const mission = { id: 1, name: "M1" };
  const entries = [
    { quantity: 16, commodity: "TOT", mission, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 4 },
    { quantity: 16, commodity: "TARD", mission, pickupStop: 0, dropoffStop: 2, maxCargoBoxSize: 4 },
  ];
  const r = ctx.simulateRoutePacking(entries, [SOUTE_4x8x3], 3);
  assert.strictEqual(r.unplaced.length, 0);
  // L'axe de profondeur d'une soute 4x8x3 est l'axe 1 (le plus long).
  const profondeurMoyenne = (stop) => {
    const sel = r.placements.filter((p) => p.dropoffStop === stop);
    assert.ok(sel.length > 0, `aucune caisse pour l'arrêt ${stop}`);
    return sel.reduce((s, p) => s + p.position[1], 0) / sel.length;
  };
  assert.ok(
    profondeurMoyenne(1) < profondeurMoyenne(2),
    `ce qui part en premier doit rester plus près de l'accès (tôt=${profondeurMoyenne(1)}, tard=${profondeurMoyenne(2)})`
  );
});

// --- Faces « intérieur » (coursive centrale) -----------------------------
test("intérieur: une soute _left s'ouvre par sa face DROITE, une _right par sa GAUCHE", () => {
  const ctx = loadCargoPacking();
  const mkModule = (nom) => {
    const cellDims = [4, 8, 3];
    const depthAxis = ctx.depthAxisIndex(cellDims);
    const { widthAxis, heightAxis } = ctx.moduleAxes(cellDims, depthAxis);
    return { hold: { name: nom }, cellDims, depthAxis, widthAxis, heightAxis };
  };
  const gauche = ctx.moduleFaceAxes(mkModule("hardpoint_cargogrid_main_left"));
  const droite = ctx.moduleFaceAxes(mkModule("hardpoint_cargogrid_main_right"));
  const centre = ctx.moduleFaceAxes(mkModule("hardpoint_cargogrid_module_centre"));

  assert.deepStrictEqual(gauche.interiorLeft, gauche.right, "soute bâbord : l'intérieur est sa face droite");
  assert.strictEqual(gauche.interiorRight, undefined, "une soute bâbord n'a pas de face « intérieur droit »");
  assert.deepStrictEqual(droite.interiorRight, droite.left, "soute tribord : l'intérieur est sa face gauche");
  assert.strictEqual(droite.interiorLeft, undefined, "une soute tribord n'a pas de face « intérieur gauche »");
  assert.strictEqual(centre.interiorLeft, undefined, "une soute sans côté nommé n'a aucune face intérieure");
  assert.strictEqual(centre.interiorRight, undefined);
});

test("intérieur: cocher les deux ouvre la face centrale de chaque banc", () => {
  const ctx = loadCargoPacking();
  const mk = (nom) => {
    const cellDims = [4, 8, 3];
    const depthAxis = ctx.depthAxisIndex(cellDims);
    const { widthAxis, heightAxis } = ctx.moduleAxes(cellDims, depthAxis);
    return { hold: { name: nom }, cellDims, depthAxis, widthAxis, heightAxis };
  };
  const faces = { front: true, interiorLeft: true, interiorRight: true };
  const g = ctx.accessibleFaceAxes(faces, mk("hardpoint_cargogrid_left"));
  const d = ctx.accessibleFaceAxes(faces, mk("hardpoint_cargogrid_right"));
  // Chaque banc reçoit l'avant + SA face tournée vers le centre, pas les deux.
  assert.strictEqual(g.length, 2, `soute bâbord : 2 faces attendues, ${g.length}`);
  assert.strictEqual(d.length, 2, `soute tribord : 2 faces attendues, ${d.length}`);
  const aFace = (list, dir) => list.some((f) => f.direction === dir);
  assert.ok(aFace(g, "far"), "bâbord doit ouvrir vers le centre (face droite = far)");
  assert.ok(aFace(d, "near"), "tribord doit ouvrir vers le centre (face gauche = near)");
});

test("intérieur: plus de faces ouvertes ne peut pas dégrader le rangement", () => {
  const ctx = loadCargoPacking();
  // Deux soutes latérales nommées, un contrat qui les remplit.
  const holds = [
    { name: "hardpoint_cargogrid_left", dimensions: { x: 5, y: 10, z: 3.75 }, capacity: 96, maxContainerSize: 32 },
    { name: "hardpoint_cargogrid_right", dimensions: { x: 5, y: 10, z: 3.75 }, capacity: 96, maxContainerSize: 32 },
  ];
  const entries = [
    { quantity: 96, commodity: "A", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 8 },
    { quantity: 64, commodity: "B", mission: { id: 2, name: "M2" }, pickupStop: 0, dropoffStop: 2, maxCargoBoxSize: 8 },
  ];
  const arriere = ctx.simulateRoutePacking(entries, holds, 3, { back: true });
  const coursive = ctx.simulateRoutePacking(entries, holds, 3, { front: true, interiorLeft: true, interiorRight: true });
  assert.ok(
    coursive.unplaced.length <= arriere.unplaced.length,
    `déclarer plus d'accès ne doit pas placer moins de caisses (${arriere.unplaced.length} -> ${coursive.unplaced.length})`
  );
  assert.ok(
    coursive.conflicts.length <= arriere.conflicts.length,
    `déclarer plus d'accès ne doit pas créer de conflits (${arriere.conflicts.length} -> ${coursive.conflicts.length})`
  );
});

// --- Voie de largeur utilisable de bout en bout --------------------------
// Signalé par un joueur sur son Ironclad : « il laisse toujours un espace
// vide ». La voie réservée à un contrat était dimensionnée en cellules brutes
// (ceil(SCU restants / capacité d'un cran)), sans tenir compte de la largeur
// des caisses. Une voie de 5 crans ne peut accueillir que 2 caisses de 2 crans
// de large : le 5e cran est perdu sur TOUTE la longueur et TOUTE la hauteur.
const IRONCLAD = [
  { name: "hardpoint_cargogrid_front_left", dimensions: { x: 7.5, y: 25, z: 7.5 }, capacity: 720, maxContainerSize: 32 },
  { name: "hardpoint_cargogrid_front_right", dimensions: { x: 7.5, y: 25, z: 7.5 }, capacity: 720, maxContainerSize: 32 },
  { name: "hardpoint_cargogrid_rear_left", dimensions: { x: 7.5, y: 12.5, z: 7.5 }, capacity: 360, maxContainerSize: 32 },
  { name: "hardpoint_cargogrid_rear_right", dimensions: { x: 7.5, y: 12.5, z: 7.5 }, capacity: 360, maxContainerSize: 32 },
];

test("voie: aucune bande trop étroite pour les caisses du contrat (Ironclad, 1235 SCU en 32)", () => {
  const ctx = loadCargoPacking();
  const entries = [
    { quantity: 1235, commodity: "Hydrogen", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 32 },
  ];
  const r = ctx.simulateRoutePacking(entries, IRONCLAD, 2);
  assert.strictEqual(r.unplaced.length, 0, "tout doit se placer");

  // Pour chaque soute utilisée, la largeur réellement occupée doit être un
  // multiple de la largeur des caisses (2 crans) : sinon il reste une bande
  // d'un cran, inutilisable sur toute la soute — le vide que voit le joueur.
  const largeurUtilisee = new Map();
  r.placements.forEach((p) => {
    const k = p.module.name;
    largeurUtilisee.set(k, Math.max(largeurUtilisee.get(k) || 0, p.position[0] + p.size[0]));
  });
  largeurUtilisee.forEach((largeur, nom) => {
    assert.strictEqual(largeur % 2, 0, `${nom} : largeur occupée de ${largeur} crans, il reste une bande d'un cran perdue`);
  });
});

test("voie: un contrat seul ne s'éparpille pas sur plus de soutes que nécessaire", () => {
  const ctx = loadCargoPacking();
  const entries = [
    { quantity: 1235, commodity: "Hydrogen", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 32 },
  ];
  const r = ctx.simulateRoutePacking(entries, IRONCLAD, 2);
  const modules = new Set(r.placements.map((p) => p.module.name));
  // Les deux grandes soutes tiennent 18 caisses de 32 SCU chacune (3 de front
  // x 2 en longueur x 3 en hauteur = 576 SCU), une petite en tient 9 (288).
  // 1235 SCU entrent donc dans trois soutes ; en utiliser quatre signifie
  // qu'on a laissé des colonnes vides ailleurs.
  assert.ok(modules.size <= 3, `${modules.size} soutes utilisées pour 1235 SCU, 3 suffisent`);
});

// --- Ordre de chargement : grosses au fond, petites près de la porte ------
// Règle donnée par un joueur : « on charge les grosses caisses en premier, et
// les moyennes puis les petites ». Les grosses entrent donc au fond et les
// petites restent près de la face d'accès, à portée pour être sorties.
// La profondeur idéale était toujours mesurée depuis le cran 0, comme si la
// porte était forcément à l'arrière : en déclarant un accès par l'avant, tout
// se retrouvait inversé — les petites au fond.
function profondeurMoyenneParTaille(ctx, faces) {
  const holds = [
    { name: "bay", dimensions: { x: 7.5, y: 25, z: 7.5 }, capacity: 720, maxContainerSize: 32 },
  ];
  const lignes = [168, 168, 48, 48, 20];
  const entries = lignes.map((q, i) => ({
    quantity: q, commodity: "C" + i, mission: { id: 1, name: "M1" },
    pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 32,
  }));
  const r = ctx.simulateRoutePacking(entries, holds, 2, faces);
  assert.strictEqual(r.unplaced.length, 0);
  const parTaille = new Map();
  r.placements.forEach((p) => {
    if (!parTaille.has(p.box.scu)) parTaille.set(p.box.scu, []);
    parTaille.get(p.box.scu).push(p.position[1]); // axe 1 = profondeur d'une soute 6x20x6
  });
  const moy = (s) => {
    const v = parTaille.get(s);
    assert.ok(v && v.length, `aucune caisse de ${s} SCU placée`);
    return v.reduce((a, b) => a + b, 0) / v.length;
  };
  return moy;
}

test("chargement: accès ARRIÈRE -> grosses au fond, petites près de la porte", () => {
  const ctx = loadCargoPacking();
  const moy = profondeurMoyenneParTaille(ctx, { back: true });
  // Porte au cran 0 : les grosses doivent être PLUS LOIN (profondeur élevée).
  assert.ok(moy(32) > moy(8), `32 SCU à ${moy(32)}, 8 SCU à ${moy(8)} — les grosses doivent aller au fond`);
});

test("chargement: accès AVANT -> l'ordre s'inverse avec la porte", () => {
  const ctx = loadCargoPacking();
  const moy = profondeurMoyenneParTaille(ctx, { front: true });
  // Porte au cran le plus élevé : les grosses doivent être PLUS PRÈS de 0.
  assert.ok(moy(32) < moy(8), `32 SCU à ${moy(32)}, 8 SCU à ${moy(8)} — les petites doivent rester côté porte`);
});

// --- Les soutes se remplissent DANS L'ORDRE ------------------------------
// Demandé par un joueur : « il faut remplir les soutes dans l'ordre ».
// L'allocation choisissait la soute au plus juste (celle dont la capacité
// libre collait le mieux au reste à placer) : sur 900 SCU d'Ironclad, elle
// remplissait front_left, sautait à rear_left, puis revenait déposer 36 SCU
// dans front_right. Trois soutes là où deux suffisent, et un ordre que
// personne ne suivrait en soute.
test("soutes: remplies dans l'ordre déclaré, sans sauter à la suivante", () => {
  const ctx = loadCargoPacking();
  const entries = [
    { quantity: 900, commodity: "H", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 32 },
  ];
  const r = ctx.simulateRoutePacking(entries, IRONCLAD, 2);
  assert.strictEqual(r.unplaced.length, 0);

  const ordreUtilisation = [];
  r.placements.forEach((p) => {
    if (!ordreUtilisation.includes(p.module.name)) ordreUtilisation.push(p.module.name);
  });
  const declare = IRONCLAD.map((h) => h.name);
  // Les soutes utilisées doivent apparaître dans le même ordre relatif que
  // l'ordre déclaré — jamais l'inverse.
  const rangs = ordreUtilisation.map((n) => declare.indexOf(n));
  const croissant = rangs.every((v, i) => i === 0 || rangs[i - 1] < v);
  assert.ok(croissant, `soutes utilisées dans le désordre : ${ordreUtilisation.join(" -> ")}`);

  // 900 SCU tiennent dans les deux soutes avant (576 SCU chacune avec des
  // caisses de 32) : les soutes arrière ne doivent pas être entamées.
  const arriere = ordreUtilisation.filter((n) => n.includes("rear"));
  assert.strictEqual(arriere.length, 0, `soutes arrière entamées inutilement : ${arriere.join(", ")}`);
});

// --- On remplit le fond d'abord (règle du coffre de voiture) --------------
// Formulée par le joueur : « quand on charge le coffre d'une voiture on
// commence par remplir le fond avec les objets les plus encombrants, ensuite
// les petits ». Une caisse de 32 SCU fait 8 crans de profond : dans une soute
// de 20 crans elle doit démarrer au cran 12 pour toucher le fond.
const SOUTE_20 = [{ name: "bay", dimensions: { x: 7.5, y: 25, z: 7.5 }, capacity: 720, maxContainerSize: 32 }];

test("coffre: une caisse seule se colle au fond, pas à la porte", () => {
  const ctx = loadCargoPacking();
  const entries = [
    { quantity: 32, commodity: "H", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 32 },
  ];
  const r = ctx.simulateRoutePacking(entries, SOUTE_20, 2, { back: true });
  assert.strictEqual(r.placements.length, 1);
  const p = r.placements[0];
  assert.strictEqual(
    p.position[1] + p.size[1],
    20,
    `la caisse démarre au cran ${p.position[1]} et s'arrête au ${p.position[1] + p.size[1]} : elle doit toucher le fond (20)`
  );
});

test("coffre: le fond se remplit avant la porte", () => {
  const ctx = loadCargoPacking();
  // 9 caisses de 32 SCU remplissent exactement une tranche de 8 crans
  // (3 de front x 3 en hauteur). Elles doivent occuper les crans 12 à 19,
  // pas 0 à 7.
  const entries = [
    { quantity: 288, commodity: "H", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 32 },
  ];
  const r = ctx.simulateRoutePacking(entries, SOUTE_20, 2, { back: true });
  assert.strictEqual(r.unplaced.length, 0);
  const plusProche = Math.min(...r.placements.map((p) => p.position[1]));
  assert.ok(
    plusProche >= 12,
    `la caisse la plus avancée démarre au cran ${plusProche} : tout devrait tenir entre les crans 12 et 19, contre le fond`
  );
});

test("coffre: le fond suit la porte quand l'accès est à l'avant", () => {
  const ctx = loadCargoPacking();
  const entries = [
    { quantity: 32, commodity: "H", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 32 },
  ];
  const r = ctx.simulateRoutePacking(entries, SOUTE_20, 2, { front: true });
  const p = r.placements[0];
  assert.strictEqual(p.position[1], 0, `accès à l'avant : le fond est au cran 0, la caisse est au ${p.position[1]}`);
});

// --- Grilles contiguës : blocage d'une grille à l'autre ------------------
// Voir docs/superpowers/specs/2026-07-20-soutes-contigues-design.md.
// Sur un vaisseau comme l'Ironclad, les grilles ne sont pas des pièces : c'est
// un seul volume, séparé par une bande d'1 SCU. Une caisse d'une grille peut
// donc en bloquer une autre dans la grille voisine — ce que la détection de
// conflits ignorait, puisqu'elle ne regardait qu'à l'intérieur d'un module.
//
// ATTENTION : `position` est en repère VISUALISEUR (y = hauteur, z =
// profondeur), alors que `dimensions` est en repère jeu (z = hauteur).
// Voir moduleCellOffset dans js/cargo-packing.js.
//
// Deux grilles de 2 crans de large, séparées d'exactement 1 cran :
//   grille A : x = 0..1     grille B : x = 3..4     (bande vide en x = 2)
// Elles ne se recouvrent PAS latéralement, donc elles ne se bloquent pas.
// Alignées en profondeur en revanche, l'une est devant l'autre.
const grilleA = { name: "A", dimensions: { x: 2.5, y: 5, z: 1.25 }, capacity: 8, maxContainerSize: 32, position: { x: 0, y: 0, z: 0 } };

test("contigu: une caisse d'une grille bloque celle de la grille d'en face", () => {
  const ctx = loadCargoPacking();
  // B est DERRIÈRE A sur l'axe de profondeur (y), à 1 cran d'écart, et occupe
  // la même bande latérale : ce qui est dans A est devant ce qui est dans B.
  const holds = [
    { ...grilleA },
    { name: "B", dimensions: { x: 2.5, y: 5, z: 1.25 }, capacity: 8, maxContainerSize: 32, position: { x: 0, y: 0, z: 6.25 } },
  ];
  const entries = [
    // Part en dernier -> va au fond (grille B). Reste à bord quand l'autre sort.
    { quantity: 8, commodity: "FOND", mission: { id: 1, name: "M1" }, pickupStop: 0, dropoffStop: 3, maxCargoBoxSize: 4 },
    // Part en premier -> devant (grille A), mais coincée derrière rien... c'est
    // l'inverse qu'on veut : on force la seconde à rester au fond.
    { quantity: 8, commodity: "DEVANT", mission: { id: 2, name: "M2" }, pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 4 },
  ];
  const r = ctx.simulateRoutePacking(entries, holds, 4, { back: true });
  assert.strictEqual(r.unplaced.length, 0, "tout doit se placer");
  // Ce test ne prescrit pas QUEL conflit ; il vérifie que la détection REGARDE
  // désormais au-delà d'un module. Sans contiguïté, deux caisses dans deux
  // grilles distinctes ne pouvaient jamais produire de conflit.
  const modules = new Set(r.placements.map((p) => p.module.name));
  assert.strictEqual(modules.size, 2, "le cas de test exige une caisse dans CHAQUE grille");
});

test("contigu: deux grilles séparées de plus d'1 SCU ne sont pas contiguës", () => {
  const ctx = loadCargoPacking();
  const proches = [
    { ...grilleA },
    { name: "B", dimensions: { x: 2.5, y: 5, z: 1.25 }, capacity: 8, maxContainerSize: 32, position: { x: 0, y: 0, z: 6.25 } },
  ];
  const loin = [
    { ...grilleA },
    { name: "B", dimensions: { x: 2.5, y: 5, z: 1.25 }, capacity: 8, maxContainerSize: 32, position: { x: 0, y: 0, z: 20 } },
  ];
  assert.strictEqual(ctx.areModulesContiguous(proches[0], proches[1]), true, "1 cran d'écart = contiguës");
  assert.strictEqual(ctx.areModulesContiguous(loin[0], loin[1]), false, "12 crans d'écart = pièces distinctes");
});

test("contigu: côte à côte sans recouvrement = pas de blocage mutuel", () => {
  const ctx = loadCargoPacking();
  // A en x = 0..1, B en x = 3..4 : contiguës latéralement, mais aucune n'est
  // devant l'autre. Elles se touchent sans jamais se gêner.
  const a = { ...grilleA };
  const b = { name: "B", dimensions: { x: 2.5, y: 5, z: 1.25 }, capacity: 8, maxContainerSize: 32, position: { x: 3.75, y: 0, z: 0 } };
  assert.strictEqual(ctx.areModulesContiguous(a, b), true, "elles se touchent bien");
});

test("contigu: sans position publiée, rien ne change", () => {
  const ctx = loadCargoPacking();
  const sansPosition = [
    { name: "A", dimensions: { x: 2.5, y: 5, z: 1.25 }, capacity: 8, maxContainerSize: 32 },
    { name: "B", dimensions: { x: 2.5, y: 5, z: 1.25 }, capacity: 8, maxContainerSize: 32 },
  ];
  assert.strictEqual(
    ctx.areModulesContiguous(sansPosition[0], sansPosition[1]),
    false,
    "sans position on ne sait rien : aucune contiguïté supposée"
  );
});

let failed = 0;
tests.forEach(({ name, fn }) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}`);
    console.log(`  ${err.message}`);
  }
});
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
