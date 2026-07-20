"use strict";

// =========================================================================
// Persistance (localStorage)
// =========================================================================
const STORAGE_KEY = "sc-cargo-optimizer-v1";
const DEFAULT_DISTANCE = 100; // valeur de repli quand une distance n'a pas été renseignée
const UNIT_M = 1.25; // 1 cellule SCU = 1,25 m (doit rester égal à UNIT dans js/cargo-viewer.js)

// Bumper à chaque changement de la logique de synchro elle-même (filtre
// syncUexShips, mapping FleetYards...) — indépendant de l'ancienneté de la
// dernière synchro (voir maybeAutoSync plus bas) : sans ça, un joueur dont le
// cache local a moins de 6h ne récupère jamais un correctif de logique de
// synchro tant que ce délai n'est pas écoulé, même après un rechargement
// complet (cache navigateur vidé ou non), ce qui a caché le correctif du
// filtre syncUexShips (Ironclad Assault et 35 autres vaisseaux) le temps que
// l'ancienne synchro expire. Un changement de valeur ici force une
// resynchronisation complète au prochain chargement, quel que soit l'âge de
// la dernière synchro.
const DATA_SCHEMA_VERSION = 3;

function defaultState() {
  return {
    missions: [],
    customLocations: [],
    distances: {},
    nextMissionId: 1,
    uexLocations: [],
    uexSyncedAt: null,
    selectedShip: "",
    customShipCapacity: null,
    uexCommodities: [],
    uexCompanies: [],
    uexShips: [],
    scwikiLocations: [],
    scwikiSyncedAt: null,
    reputationOverrides: {},
    fleetyardsCargoHolds: {},
    fleetyardsSyncedAt: null,
    shipAccessFaces: {},
    cargoViewerOrientation: {},
    cargoViewerMirror: {},
    cargoViewerLayout: {},
    // Emplacements réservés à des véhicules garés, PAR JOUEUR (jamais publié) :
    // { [ship]: { [moduleKey]: [ {x0,y0,sx,sy,vid}, ... ] } }, en cellules du
    // repère packing. Passé tel quel à simulateRoutePacking (brique A′), qui
    // ignore vid. Voir getShipReservations.
    cargoReservations: {},
    // Vaisseaux dont le joueur a DÉVERROUILLÉ localement la grille publiée pour
    // en proposer une correction (brique 2b) : { [ship]: true }. Local à ce
    // joueur — ne change rien pour les autres tant que le mainteneur n'a pas
    // validé sa proposition.
    cargoViewerUnlocked: {},
    // Grilles publiées (Supabase, table ship_layouts) : { [ship]: {grid, orientation, mirror} }.
    // Cache local relu à chaque synchro, comme fleetyardsCargoHolds.
    approvedShipGrids: {},
    dataSchemaVersion: DATA_SCHEMA_VERSION,
  };
}

// Format actuel : mission.cargoItems, un tableau {commodity, quantity,
// pickupId, dropoffId} — chaque marchandise porte SON PROPRE lieu de
// récupération et de dépôt (plus de liste de lieux séparée au niveau de la
// mission, ce qui créait des doublons de dépose quand il y avait plusieurs
// lieux et qu'on ne savait pas quelle marchandise allait où).
function migrateMission(m) {
  if (m.cargoItems && m.cargoItems.length && m.cargoItems[0].pickupId !== undefined) {
    return {
      ...m,
      completed: m.completed || false,
      cargoItems: m.cargoItems.map((item) => ({ ...item, plannedQuantity: item.plannedQuantity ?? item.quantity })),
    };
  }

  const oldPickupIds = m.pickupIds || (m.pickupId ? [m.pickupId] : []);
  const oldDropoffIds = m.dropoffIds || (m.dropoffId ? [m.dropoffId] : []);
  const oldItems =
    m.cargoItems || (m.commodity || m.cargo ? [{ commodity: m.commodity || "", quantity: m.cargo || "" }] : []);

  // Au mieux : associe chaque marchandise au premier lieu de récupération et
  // premier lieu de dépôt connus. Une mission migrée qui avait plusieurs
  // lieux devra être vérifiée : l'ancien format ne permettait pas de savoir
  // quelle marchandise allait où.
  const cargoItems = oldItems.map((item) => ({
    commodity: item.commodity || "",
    quantity: item.quantity || "",
    plannedQuantity: item.plannedQuantity ?? item.quantity ?? "",
    pickupId: oldPickupIds[0] || "",
    dropoffId: oldDropoffIds[0] || "",
  }));

  const { pickupIds, dropoffIds, pickupId, dropoffId, commodity, cargo, ...rest } = m;
  return { ...rest, cargoItems, completed: m.completed || false };
}

// Complète le planetHint des lieux personnalisés créés avant l'introduction de
// ce champ (voir addCustomLocation), en recoupant leur nom avec un jeu de
// données Star Citizen Wiki (celui déjà synchronisé si disponible, sinon les
// données par défaut). N'écrase jamais un planetHint déjà présent.
function migrateCustomLocation(loc, scwikiEntries) {
  if (loc.planetHint) return loc;
  const scwiki = scwikiEntries.find((e) => e.name.toLowerCase() === loc.name.toLowerCase());
  if (scwiki && scwiki.parent) return { ...loc, planetHint: scwiki.parent };
  return loc;
}

// Repasse sur tous les lieux personnalisés pour compléter ceux dont le
// planetHint manque encore, avec les données les plus fraîches (utilisé après
// "Tout synchroniser" pour rattraper d'éventuels lieux créés avant un premier
// import du jeu de données Star Citizen Wiki).
function backfillCustomLocationPlanetHints() {
  const scwikiEntries = allScwikiLocations();
  state.customLocations = state.customLocations.map((loc) => migrateCustomLocation(loc, scwikiEntries));
  planetAnchorCache = null;
}

// Repasse les migrations de forme sur l'état EN PLACE. Nécessaire après avoir
// injecté un état venu du cloud (voir reconcileOnSignIn dans js/cloud.js) : un
// autre appareil resté sur une ancienne version du site peut avoir poussé des
// missions à l'ancien format, et loadState ne migre qu'au chargement local —
// jamais ce qui arrive du cloud en cours de session. Sans ça, l'ancien format
// vivrait tel quel jusqu'au prochain rechargement de la page.
function migratePlayerDataInPlace() {
  state.missions = (state.missions || []).map(migrateMission);
  const scwikiEntries = allScwikiLocations();
  state.customLocations = (state.customLocations || []).map((loc) => migrateCustomLocation(loc, scwikiEntries));
  planetAnchorCache = null;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    // Pas encore de `state` global à ce stade : on utilise les données déjà
    // synchronisées si ce blob en contient, sinon les données par défaut.
    const scwikiEntries =
      parsed.scwikiLocations && parsed.scwikiLocations.length ? parsed.scwikiLocations : DEFAULT_SCWIKI_LOCATIONS;
    return {
      missions: (parsed.missions || []).map(migrateMission),
      customLocations: (parsed.customLocations || []).map((loc) => migrateCustomLocation(loc, scwikiEntries)),
      distances: parsed.distances || {},
      nextMissionId: parsed.nextMissionId || 1,
      uexLocations: parsed.uexLocations || [],
      uexSyncedAt: parsed.uexSyncedAt || null,
      selectedShip: parsed.selectedShip || "",
      customShipCapacity: parsed.customShipCapacity || null,
      uexCommodities: parsed.uexCommodities || [],
      uexCompanies: parsed.uexCompanies || [],
      uexShips: parsed.uexShips || [],
      scwikiLocations: parsed.scwikiLocations || [],
      scwikiSyncedAt: parsed.scwikiSyncedAt || null,
      reputationOverrides: parsed.reputationOverrides || {},
      fleetyardsCargoHolds: parsed.fleetyardsCargoHolds || {},
      fleetyardsSyncedAt: parsed.fleetyardsSyncedAt || null,
      shipAccessFaces: parsed.shipAccessFaces || {},
      cargoViewerOrientation: parsed.cargoViewerOrientation || {},
      cargoViewerMirror: parsed.cargoViewerMirror || {},
      cargoViewerLayout: parsed.cargoViewerLayout || {},
      cargoReservations: parsed.cargoReservations || {},
      cargoViewerUnlocked: parsed.cargoViewerUnlocked || {},
      approvedShipGrids: parsed.approvedShipGrids || {},
      dataSchemaVersion: parsed.dataSchemaVersion || 0,
    };
  } catch (e) {
    return defaultState();
  }
}

let state = loadState();

// Id de la mission en cours de modification via le formulaire "Nouvelle
// mission" (null quand le formulaire sert à en créer une nouvelle) — voir
// startEditMission/cancelEditMission.
let editingMissionId = null;
// Rempli au chargement depuis Supabase (voir fetchIsAdmin) — jamais persisté :
// un cache local ne doit pas pouvoir accorder l'admin. Ne sert qu'à afficher
// l'éditeur ; l'autorité reste la RLS côté base.
let isAdminUser = false;
// Taille maximum de caisse reconnue par le dernier import OCR passé en revue
// dans le formulaire "Nouvelle mission" (pas de champ de formulaire dédié :
// portée jusqu'à la soumission via cette variable, comme editingMissionId).
let pendingOcrMaxCargoBoxSize = null;
// Dernier trajet optimisé calculé avec succès (voir runOptimize), réutilisé
// par l'onglet Optimisation du cargo pour ranger les marchandises dans
// l'ordre réel de récupération/livraison plutôt qu'en vrac.
let lastRouteResult = null;

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (typeof scheduleCloudSync === "function") scheduleCloudSync(state);
}

// =========================================================================
// Lieux
// =========================================================================
function allLocations() {
  const base = state.uexLocations.length ? state.uexLocations : DEFAULT_LOCATIONS;
  return [...base, ...state.customLocations];
}

function getLocationById(id) {
  return allLocations().find((l) => l.id === id) || null;
}

const DIACRITICS_RE = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);

function slugify(str) {
  return str
    .toString()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// planetHint (optionnel) : nom de la planète/lune parente (champ "parent" de
// l'API Star Citizen Wiki) pour les lieux créés via ce secours — permet
// d'estimer une distance plus juste que la valeur par défaut générique (voir
// planetAnchorLocationId et getDistance).
function addCustomLocation(name, category, planetHint) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  let id = slugify(trimmed) || "lieu";
  const existingIds = new Set(allLocations().map((l) => l.id));
  let candidate = id;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${id}-${suffix}`;
    suffix++;
  }
  const loc = { id: candidate, name: trimmed, category: category || "Personnalisé" };
  if (planetHint) loc.planetHint = planetHint;
  state.customLocations.push(loc);
  saveState();
  return loc;
}

function distanceKey(aId, bId) {
  return [aId, bId].sort().join("|");
}

// Distances de base dérivées du graphe d'orbites UEX Corp (voir distances.js),
// indexées une fois au chargement avec la même clé normalisée que les distances manuelles.
const DEFAULT_DISTANCE_MAP = {};
DEFAULT_DISTANCE_TRIPLETS.forEach(([a, b, d]) => {
  DEFAULT_DISTANCE_MAP[distanceKey(a, b)] = d;
});

function hasCustomDistance(aId, bId) {
  return distanceKey(aId, bId) in state.distances;
}

// Planète/lune d'un lieu : soit stockée directement dessus (lieu personnalisé
// créé via le secours Star Citizen Wiki), soit issue du recoupement local
// UEX <-> Star Citizen Wiki précalculé (voir data/location-planets.js) — utile
// notamment pour les lieux UEX à l'orbite non résolue (orbitId: 0), pour
// lesquels UEX lui-même ne sait pas situer une distance.
function getPlanetHint(loc) {
  if (!loc) return null;
  return loc.planetHint || DEFAULT_LOCATION_PLANETS[loc.id] || null;
}

// Un lieu de notre propre base UEX qui se trouve sur la planète/lune donnée,
// utilisé comme ancre pour estimer une distance à un lieu dont on ne connaît
// que la planète parente. Recalculé à la demande, invalidé après synchro.
let planetAnchorCache = null;
function planetAnchorLocationId(planetName) {
  if (!planetName) return null;
  if (!planetAnchorCache) {
    planetAnchorCache = new Map();
    Object.entries(DEFAULT_LOCATION_PLANETS).forEach(([id, planet]) => {
      if (planetAnchorCache.has(planet)) return;
      // Une orbite non résolue (orbitId 0, ex. Covalex Distribution Centre
      // S4DC05) ne sert à rien comme ancre : UEX lui-même n'a aucune distance
      // fiable depuis ce lieu-là, donc l'utiliser comme référence ne ferait
      // que retomber sur la valeur par défaut pour tout le monde.
      const loc = getLocationById(id);
      if (loc && loc.orbitId === 0) return;
      planetAnchorCache.set(planet, id);
    });
  }
  return planetAnchorCache.get(planetName) || null;
}

// Distance connue (manuelle ou UEX) entre deux lieux, sans repli — null si
// aucune des deux n'est renseignée.
function knownDistance(aId, bId) {
  if (aId === bId) return 0;
  const key = distanceKey(aId, bId);
  const manual = state.distances[key];
  if (typeof manual === "number" && !isNaN(manual)) return manual;
  const baked = DEFAULT_DISTANCE_MAP[key];
  if (typeof baked === "number" && !isNaN(baked)) return baked;
  return null;
}

// Volontairement non récursif (une ancre peut se résoudre à un lieu qui n'a,
// lui non plus, pas de distance connue vers l'autre bout, ce qui bouclerait
// indéfiniment avec un appel récursif à getDistance) : on tente une poignée
// de candidats concrets dans l'ordre, et seul le dernier retombe sur la
// valeur par défaut générique.
function getDistance(aId, bId) {
  const direct = knownDistance(aId, bId);
  if (direct !== null) return direct;

  const planetA = getPlanetHint(getLocationById(aId));
  const planetB = getPlanetHint(getLocationById(bId));
  if (planetA && planetA === planetB) return 0;

  const anchorA = planetA ? planetAnchorLocationId(planetA) : null;
  if (anchorA && anchorA !== aId) {
    if (anchorA === bId) return 0;
    const viaA = knownDistance(anchorA, bId);
    if (viaA !== null) return viaA;
  }

  const anchorB = planetB ? planetAnchorLocationId(planetB) : null;
  if (anchorB && anchorB !== bId) {
    if (anchorB === aId) return 0;
    const viaB = knownDistance(aId, anchorB);
    if (viaB !== null) return viaB;
  }

  if (anchorA && anchorB && anchorA !== anchorB) {
    const viaBoth = knownDistance(anchorA, anchorB);
    if (viaBoth !== null) return viaBoth;
  }

  return DEFAULT_DISTANCE;
}

function setDistance(aId, bId, value) {
  const key = distanceKey(aId, bId);
  if (value === null || value === "" || isNaN(value)) {
    delete state.distances[key];
  } else {
    state.distances[key] = Number(value);
  }
  saveState();
}

// =========================================================================
// Missions
// =========================================================================
function addMission(mission) {
  const m = {
    id: state.nextMissionId++,
    name: mission.name || `Mission ${state.nextMissionId - 1}`,
    giver: mission.giver || "",
    // plannedQuantity garde la quantité d'origine du contrat, jamais modifiée
    // par la suite : sert de référence dans l'onglet Suivi cargo quand la
    // quantité réellement récupérée (quantity) est corrigée après coup.
    cargoItems: (mission.cargoItems || []).map((item) => ({
      ...item,
      plannedQuantity: item.plannedQuantity ?? item.quantity,
    })),
    reward: mission.reward,
    // Taille maximum de caisse annoncée par le contrat ("Taille maximum du
    // cargo : X SCU", voir js/ocr.js:extractMaxCargoBoxSize) — utilisée pour
    // décomposer la cargaison en caisses réalistes plutôt qu'en supposant
    // arbitrairement la plus grosse caisse standard (voir js/cargo-packing.js).
    maxCargoBoxSize: mission.maxCargoBoxSize || null,
    included: true,
    completed: false,
  };
  state.missions.push(m);
  saveState();
  return m;
}

function activeMissions() {
  return state.missions.filter((m) => !m.completed);
}

function historyMissions() {
  return state.missions.filter((m) => m.completed);
}

function missionPickupIds(m) {
  return Array.from(new Set((m.cargoItems || []).map((i) => i.pickupId).filter(Boolean)));
}

function missionDropoffIds(m) {
  return Array.from(new Set((m.cargoItems || []).map((i) => i.dropoffId).filter(Boolean)));
}

// Signature d'une mission qui ignore volontairement son nom : deux missions
// avec les mêmes marchandises/lieux/donneur/récompense mais un nom différent
// (ou vice versa) comptent comme la même mission "répétée".
function missionSignature(m) {
  const items = (m.cargoItems || [])
    .map((item) => `${item.commodity}|${item.quantity}|${item.pickupId}|${item.dropoffId}`)
    .sort()
    .join(";");
  return `${m.giver || ""}::${items}::${m.reward || ""}`;
}

// Plusieurs missions peuvent porter exactement le même nom (ex : titres
// génériques comme "JUNIOR - PETIT - STELLAIRE") — sur la feuille de route,
// où seul le nom est affiché à chaque étape, ça rend impossible de savoir à
// quelle mission précise se rapporte une ligne de ramassage/dépôt. On calcule
// donc un tag "(n/total)" par mission, uniquement quand son nom est dupliqué
// parmi les missions du trajet en cours, numéroté selon l'ordre de première
// apparition dans le trajet (plus lisible que l'ordre de création).
function collectRouteMissionsInOrder(result) {
  const seen = new Set();
  const missions = [];
  result.steps.forEach((step) => {
    step.actions.forEach((a) => {
      if (!seen.has(a.mission.id)) {
        seen.add(a.mission.id);
        missions.push(a.mission);
      }
    });
  });
  return missions;
}

function buildMissionRouteTags(missions) {
  const counts = new Map();
  missions.forEach((m) => counts.set(m.name, (counts.get(m.name) || 0) + 1));
  const seenIndex = new Map();
  const tags = new Map();
  missions.forEach((m) => {
    const total = counts.get(m.name);
    if (total > 1) {
      const idx = (seenIndex.get(m.name) || 0) + 1;
      seenIndex.set(m.name, idx);
      tags.set(m.id, `${idx}/${total}`);
    }
  });
  return tags;
}

function missionRouteLabel(mission, tags) {
  const tag = tags.get(mission.id);
  return tag ? `${mission.name} (${tag})` : mission.name;
}

// Rend une fonction de restauration, qui remet la mission à SA place d'origine
// dans la liste. Le bouton « Supprimer » est à 0,4 rem du bouton « Terminer »,
// et une mission importée par OCR peut porter six lignes de cargaison saisies
// à la main : le mauvais clic finit par arriver. Plutôt qu'un dialogue de
// confirmation à chaque suppression (friction sur une action fréquente), on
// laisse le geste passer et on offre l'annulation dans le toast.
function removeMission(id) {
  const index = state.missions.findIndex((m) => m.id === id);
  if (index === -1) return () => {};
  const [removed] = state.missions.splice(index, 1);
  saveState();
  return () => {
    state.missions.splice(Math.min(index, state.missions.length), 0, removed);
    saveState();
  };
}

function setMissionIncluded(id, included) {
  const m = state.missions.find((m) => m.id === id);
  if (m) {
    m.included = included;
    saveState();
  }
}

// =========================================================================
// Optimisation (TSP avec contraintes de précédence pickup -> dropoff)
// =========================================================================

// Lieux dont l'ascenseur de fret est signalé HS par le joueur : aucun
// ramassage ni dépôt n'y est possible tant que ce n'est pas réactivé.
// Volontairement PAS dans `state` (donc pas persisté ni synchronisé) : un
// ascenseur HS est un état serveur temporaire propre à la session de jeu en
// cours, qui ne veut plus rien dire à la prochaine connexion.
const brokenElevatorLocationIds = new Set();

function isElevatorBroken(locId) {
  return brokenElevatorLocationIds.has(locId);
}

function toggleElevatorBroken(locId) {
  if (brokenElevatorLocationIds.has(locId)) brokenElevatorLocationIds.delete(locId);
  else brokenElevatorLocationIds.add(locId);
  renderBrokenElevatorsList();
  runOptimize();
}

function renderBrokenElevatorsList() {
  const container = document.getElementById("broken-elevators");
  if (!container) return;
  container.innerHTML = "";
  if (!brokenElevatorLocationIds.size) return;

  const label = document.createElement("span");
  label.className = "hint";
  label.textContent = t("brokenElevatorsLabel");
  container.appendChild(label);

  Array.from(brokenElevatorLocationIds).forEach((locId) => {
    const loc = getLocationById(locId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "broken-elevator-chip";
    chip.textContent = t("elevatorReactivateBtn", { location: loc ? loc.name : locId });
    chip.addEventListener("click", () => toggleElevatorBroken(locId));
    container.appendChild(chip);
  });
}

function computeUniqueLocationIds(missions, broken) {
  const skip = broken || new Set();
  const set = new Set();
  missions.forEach((m) => {
    (m.cargoItems || []).forEach((item) => {
      if (skip.has(item.pickupId) || skip.has(item.dropoffId)) return;
      if (item.pickupId) set.add(item.pickupId);
      if (item.dropoffId) set.add(item.dropoffId);
    });
  });
  return Array.from(set);
}

function isValidMask(mask, constraints) {
  for (let i = 0; i < constraints.length; i++) {
    const p = constraints[i][0];
    const d = constraints[i][1];
    if (mask & (1 << d) && !(mask & (1 << p))) return false;
  }
  return true;
}

// Programmation dynamique bitmask (Held-Karp) exacte, avec contraintes de précédence.
function solveExactDP(n, dist, constraints, startIdx) {
  const size = 1 << n;
  const dp = new Array(size);
  const parent = new Array(size);
  for (let m = 0; m < size; m++) {
    dp[m] = new Float64Array(n).fill(Infinity);
    parent[m] = new Int16Array(n).fill(-1);
  }

  for (let v = 0; v < n; v++) {
    if (startIdx !== null && v !== startIdx) continue;
    const mask = 1 << v;
    if (!isValidMask(mask, constraints)) continue;
    dp[mask][v] = 0;
  }

  for (let mask = 1; mask < size; mask++) {
    if (!isValidMask(mask, constraints)) continue;
    for (let last = 0; last < n; last++) {
      if (!(mask & (1 << last))) continue;
      const cur = dp[mask][last];
      if (!isFinite(cur)) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nmask = mask | (1 << next);
        if (!isValidMask(nmask, constraints)) continue;
        const ncost = cur + dist[last][next];
        if (ncost < dp[nmask][next]) {
          dp[nmask][next] = ncost;
          parent[nmask][next] = last;
        }
      }
    }
  }

  const full = size - 1;
  let best = Infinity;
  let bestLast = -1;
  for (let last = 0; last < n; last++) {
    if (dp[full][last] < best) {
      best = dp[full][last];
      bestLast = last;
    }
  }
  if (bestLast === -1) return null;

  const order = [];
  let mask = full;
  let cur = bestLast;
  while (cur !== -1) {
    order.push(cur);
    const p = parent[mask][cur];
    mask ^= 1 << cur;
    cur = p;
  }
  order.reverse();
  return order;
}

function orderIsValid(order, constraints) {
  const pos = new Array(order.length);
  order.forEach((idx, i) => (pos[idx] = i));
  for (let i = 0; i < constraints.length; i++) {
    if (pos[constraints[i][0]] > pos[constraints[i][1]]) return false;
  }
  return true;
}

function routeLength(order, dist) {
  let total = 0;
  for (let i = 1; i < order.length; i++) total += dist[order[i - 1]][order[i]];
  return total;
}

function improve2opt(order, dist, constraints) {
  let improved = true;
  let guard = 0;
  while (improved && guard < 200) {
    improved = false;
    guard++;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const newOrder = order
          .slice(0, i)
          .concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        if (!orderIsValid(newOrder, constraints)) continue;
        if (routeLength(newOrder, dist) < routeLength(order, dist) - 1e-9) {
          for (let k = 0; k < order.length; k++) order[k] = newOrder[k];
          improved = true;
        }
      }
    }
  }
}

// Heuristique (plus proche voisin + amélioration 2-opt) pour les grands cas.
function solveHeuristic(n, dist, constraints, startIdx) {
  const visited = new Array(n).fill(false);
  const order = [];

  function canVisit(idx) {
    for (let i = 0; i < constraints.length; i++) {
      if (constraints[i][1] === idx && !visited[constraints[i][0]]) return false;
    }
    return true;
  }

  let current;
  if (startIdx !== null) {
    if (!canVisit(startIdx)) return null;
    current = startIdx;
  } else {
    current = -1;
    for (let i = 0; i < n; i++) {
      if (canVisit(i)) {
        current = i;
        break;
      }
    }
    if (current === -1) return null;
  }
  visited[current] = true;
  order.push(current);

  while (order.length < n) {
    let bestNext = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited[i] || !canVisit(i)) continue;
      const d = dist[current][i];
      if (d < bestDist) {
        bestDist = d;
        bestNext = i;
      }
    }
    if (bestNext === -1) return null; // contraintes cycliques impossibles à satisfaire
    visited[bestNext] = true;
    order.push(bestNext);
    current = bestNext;
  }

  improve2opt(order, dist, constraints);
  return order;
}

const EXACT_DP_MAX_LOCATIONS = 16;

// Arrondit à 2 décimales pour l'affichage : évite les artefacts de virgule
// flottante (ex : 2.6700000000000017) qui apparaissent après des divisions
// (répartition du cargo entre plusieurs lieux) suivies de soustractions.
function roundScu(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Repère un cycle direct entre deux lieux (A doit être visité avant B pour
// une mission, B avant A pour une autre) : la contradiction la plus simple
// et la plus fréquente rendant un trajet impossible. Ne détecte que les
// cycles à deux lieux (le cas courant) — un cycle plus long (A avant B avant
// C avant A) reste signalé par le message générique.
function findDirectConstraintCycle(constraints, locIds) {
  const seen = new Set(constraints.map(([a, b]) => `${a}>${b}`));
  for (const [a, b] of constraints) {
    if (!seen.has(`${b}>${a}`)) continue;
    const locA = getLocationById(locIds[a]);
    const locB = getLocationById(locIds[b]);
    if (locA && locB) return { a: locA, b: locB };
  }
  return null;
}

// Regroupe les lignes de cargaison par couple (ramassage, dépôt). Deux lignes
// qui partent du même endroit vers le même endroit sont indiscernables pour le
// calcul du trajet : elles seront toujours embarquées puis déposées ensemble.
// Les traiter comme UNE tâche fait chuter l'espace d'états de 3^(lignes) à
// 3^(couples distincts) — en pratique une poignée, même avec dix missions.
function buildRevisitTasks(missions, broken) {
  const isUsable = (item) => !broken.has(item.pickupId) && !broken.has(item.dropoffId);
  const byPair = new Map();
  missions.forEach((m) => {
    (m.cargoItems || []).forEach((item, index) => {
      if (!isUsable(item)) return;
      if (!item.pickupId || !item.dropoffId || item.pickupId === item.dropoffId) return;
      const key = `${item.pickupId}>${item.dropoffId}`;
      let task = byPair.get(key);
      if (!task) {
        task = { pickupId: item.pickupId, dropoffId: item.dropoffId, entries: [] };
        byPair.set(key, task);
      }
      task.entries.push({ mission: m, item, index });
    });
  });
  return Array.from(byPair.values());
}

// Plafond de l'espace d'états du calcul exact avec revisites (3^tâches × lieux).
// Au-delà on repasse sur le glouton. 10 couples ramassage/dépôt distincts font
// 59 049 codes : très au-delà de ce qu'on voit sur un vrai run.
const EXACT_REVISIT_MAX_STATES = 1e6;

// Trajet avec revisites, résolu de façon EXACTE.
//
// Pourquoi un second solveur : solveExactDP raisonne sur "quels lieux ai-je
// déjà visités", ce qui suppose un lieu = une visite. Dès que deux missions
// imposent l'ordre inverse entre les deux mêmes stations (livrer A->B et
// récupérer B->A dans le même run — cas très courant du hauling), il ne peut
// RIEN produire. Il faut alors changer d'état : plus "où suis-je passé" mais
// "où en est chaque chargement".
//
// Chaque tâche a trois états (à prendre / à bord / livrée), d'où un code en
// base 3. Une transition fait avancer UNE tâche d'un cran, donc le code croît
// STRICTEMENT : les parcourir dans l'ordre croissant est un tri topologique
// valide, sans file de priorité ni détection de cycle.
//
// Critère, dans cet ordre : distance, puis nombre d'arrêts, puis pic de charge.
// Ce dernier n'est pas cosmétique — à distance et arrêts égaux, deux ordres
// peuvent différer de plusieurs centaines de SCU au plus chargé, et donc tenir
// ou non dans la soute. Départager au hasard reviendrait à proposer parfois la
// version qui déborde alors qu'une équivalente passe.
//
// Le pic reste un critère valide malgré le max (et non une somme) : la charge
// à un instant donné ne dépend que de l'état, donc à état égal un préfixe de
// pic plus bas domine — le pic final vaut max(préfixe, suffixe) et le suffixe
// est identique.
//
// Renvoie null si l'instance est trop grosse ou si aucun trajet n'existe.
function solveRevisitExact(tasks, startId) {
  const k = tasks.length;
  if (!k) return null;

  const locIds = [];
  const idxOf = new Map();
  const addLoc = (id) => {
    if (!idxOf.has(id)) {
      idxOf.set(id, locIds.length);
      locIds.push(id);
    }
    return idxOf.get(id);
  };
  if (startId) addLoc(startId);
  const from = new Int32Array(k);
  const to = new Int32Array(k);
  tasks.forEach((t, i) => {
    from[i] = addLoc(t.pickupId);
    to[i] = addLoc(t.dropoffId);
  });
  const n = locIds.length;

  const pow3 = new Array(k + 1);
  pow3[0] = 1;
  for (let i = 1; i <= k; i++) pow3[i] = pow3[i - 1] * 3;
  const P = pow3[k];
  if (n * P > EXACT_REVISIT_MAX_STATES) return null;

  const d = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n);
    for (let j = 0; j < n; j++) row[j] = i === j ? 0 : getDistance(locIds[i], locIds[j]);
    d.push(row);
  }

  // Charge à bord pour chaque code d'état : somme des quantités des tâches au
  // statut "à bord" (chiffre 1). Ne dépend que du code, jamais du chemin.
  const qty = new Float64Array(k);
  tasks.forEach((t, i) => {
    qty[i] = t.entries.reduce((s, e) => s + (Number(e.item.quantity) || 0), 0);
  });
  const loadOfCode = new Float64Array(P);
  for (let code = 0; code < P; code++) {
    let load = 0;
    for (let t = 0; t < k; t++) if (Math.floor(code / pow3[t]) % 3 === 1) load += qty[t];
    loadOfCode[code] = load;
  }

  const size = n * P;
  const best = new Float64Array(size).fill(Infinity);
  const stops = new Int32Array(size).fill(0x7fffffff);
  const peak = new Float64Array(size).fill(Infinity);
  const prevState = new Int32Array(size).fill(-1);
  const prevTask = new Int8Array(size).fill(-1);

  // Le lieu de départ compte déjà pour un arrêt (il est affiché comme tel).
  if (startId) {
    const s = idxOf.get(startId) * P;
    best[s] = 0;
    stops[s] = 1;
    peak[s] = 0;
  } else {
    // Sans départ imposé, le trajet peut commencer à n'importe quel lieu de
    // ramassage — le premier arrêt est alors la première action.
    for (let i = 0; i < k; i++) {
      const s = from[i] * P;
      if (best[s] === Infinity) {
        best[s] = 0;
        stops[s] = 1;
        peak[s] = 0;
      }
    }
  }

  const EPS = 1e-9;
  for (let code = 0; code < P; code++) {
    for (let loc = 0; loc < n; loc++) {
      const s = loc * P + code;
      const cur = best[s];
      if (cur === Infinity) continue;
      for (let t = 0; t < k; t++) {
        const st = Math.floor(code / pow3[t]) % 3;
        if (st === 2) continue; // déjà livrée
        const target = st === 0 ? from[t] : to[t];
        const ncode = code + pow3[t];
        const ns = target * P + ncode;
        const nd = cur + d[loc][target];
        const nstops = stops[s] + (target === loc ? 0 : 1);
        const npeak = Math.max(peak[s], loadOfCode[ncode]);
        const tie = nd <= best[ns] + EPS && nd >= best[ns] - EPS;
        if (
          nd < best[ns] - EPS ||
          (tie && nstops < stops[ns]) ||
          (tie && nstops === stops[ns] && npeak < peak[ns])
        ) {
          best[ns] = nd;
          stops[ns] = nstops;
          peak[ns] = npeak;
          prevState[ns] = s;
          prevTask[ns] = t;
        }
      }
    }
  }

  // État final : toutes les tâches livrées, soit le code dont tous les
  // chiffres valent 2 (= 3^k - 1).
  const goal = P - 1;
  let bestEnd = -1;
  for (let loc = 0; loc < n; loc++) {
    const s = loc * P + goal;
    if (best[s] === Infinity) continue;
    if (bestEnd === -1) {
      bestEnd = s;
      continue;
    }
    const tie = best[s] <= best[bestEnd] + EPS && best[s] >= best[bestEnd] - EPS;
    if (
      best[s] < best[bestEnd] - EPS ||
      (tie && stops[s] < stops[bestEnd]) ||
      (tie && stops[s] === stops[bestEnd] && peak[s] < peak[bestEnd])
    ) {
      bestEnd = s;
    }
  }
  if (bestEnd === -1) return null;

  const seq = [];
  let s = bestEnd;
  while (prevState[s] !== -1) {
    const t = prevTask[s];
    const ps = prevState[s];
    const st = Math.floor((ps % P) / pow3[t]) % 3;
    seq.push({ locId: locIds[Math.floor(s / P)], task: tasks[t], type: st === 0 ? "pickup" : "dropoff" });
    s = ps;
  }
  seq.reverse();
  return { seq, startLocId: locIds[Math.floor(s / P)] };
}

// Assemble la suite d'actions (ramasser/déposer) en arrêts : deux actions
// consécutives au même lieu forment UN arrêt, et les lignes sont regroupées
// par mission — une même tâche peut porter des lignes de plusieurs missions.
function buildRevisitSteps(seq, startLocId, startId) {
  const steps = [];
  let current = startId || startLocId;
  // Le lieu de départ choisi apparaît comme premier arrêt même sans action,
  // comme dans le calcul strict.
  if (startId) steps.push({ locId: startId, actions: [], legDistance: 0 });

  seq.forEach((a) => {
    let step = steps[steps.length - 1];
    if (!step || step.locId !== a.locId) {
      step = {
        locId: a.locId,
        actions: [],
        legDistance: steps.length ? getDistance(current, a.locId) : 0,
      };
      steps.push(step);
      current = a.locId;
    }
    a.task.entries.forEach((e) => {
      let action = step.actions.find((x) => x.type === a.type && x.mission === e.mission);
      if (!action) {
        action = { type: a.type, mission: e.mission, items: [] };
        step.actions.push(action);
      }
      action.items.push({ ...e.item, index: e.index });
    });
  });
  return steps;
}

// Charge de cargo réellement à bord à chaque arrêt (ajoutée au retrait,
// retirée au dépôt), et pic sur l'ensemble du trajet.
function annotateCargoLoad(steps) {
  let load = 0;
  let maxLoad = 0;
  steps.forEach((step) => {
    step.actions.forEach((a) => {
      const sum = a.items.reduce((s, item) => s + (Number(item.quantity) || 0), 0);
      load += a.type === "pickup" ? sum : -sum;
    });
    step.cargoLoad = roundScu(load);
    if (step.cargoLoad > maxLoad) maxLoad = step.cargoLoad;
  });
  return maxLoad;
}

// Point d'entrée du trajet avec revisites : exact si l'instance tient dans le
// plafond d'états, glouton sinon (voir solveRevisitGreedy).
function solveRouteWithRevisits(missions, startId, broken) {
  const tasks = buildRevisitTasks(missions, broken);
  if (!tasks.length) return { error: t("selectMissionError") };

  const solved = solveRevisitExact(tasks, startId);
  if (!solved) return solveRevisitGreedy(missions, startId, broken);

  const steps = buildRevisitSteps(solved.seq, solved.startLocId, startId);
  const maxLoad = annotateCargoLoad(steps);
  const total = steps.reduce((s, step) => s + step.legDistance, 0);
  const distinct = new Set(steps.map((s) => s.locId)).size;

  return {
    steps,
    total: roundScu(total),
    approximate: false,
    revisited: steps.length > distinct,
    stopCount: steps.length,
    maxCargoLoad: maxLoad,
  };
}

// Repli de dernier recours, quand l'instance dépasse le plafond d'états du
// calcul exact : parcours glouton "plus proche voisin" parmi les actions
// encore à faire. Volontairement simple et NON optimal — d'où le marquage du
// résultat en approximate, qui déclenche l'avertissement dédié dans l'UI.
function solveRevisitGreedy(missions, startId, broken) {
  const isUsable = (item) => !broken.has(item.pickupId) && !broken.has(item.dropoffId);

  const entries = [];
  missions.forEach((m) => {
    (m.cargoItems || []).forEach((item, index) => {
      if (!isUsable(item)) return;
      if (!item.pickupId || !item.dropoffId || item.pickupId === item.dropoffId) return;
      entries.push({ mission: m, item, index, pickedUp: false, droppedOff: false });
    });
  });
  if (!entries.length) return { error: t("selectMissionError") };

  let current = startId || entries[0].item.pickupId;
  const steps = [];
  let total = 0;

  function currentStep(legDistance) {
    if (steps.length && steps[steps.length - 1].locId === current) return steps[steps.length - 1];
    const step = { locId: current, actions: [], legDistance: steps.length ? legDistance : 0 };
    steps.push(step);
    return step;
  }

  function addAction(type, mission, item, index) {
    const step = currentStep(0);
    let action = step.actions.find((a) => a.type === type && a.mission === mission);
    if (!action) {
      action = { type, mission, items: [] };
      step.actions.push(action);
    }
    action.items.push({ ...item, index });
  }

  // Le lieu de départ choisi (même sans action) apparaît comme premier
  // arrêt, comme dans le calcul strict.
  if (startId) currentStep(0);

  let guard = entries.length * 2;
  while (entries.some((e) => !e.droppedOff) && guard-- > 0) {
    const candidates = [];
    entries.forEach((e) => {
      if (!e.pickedUp) candidates.push({ locId: e.item.pickupId, type: "pickup", entry: e });
      else if (!e.droppedOff) candidates.push({ locId: e.item.dropoffId, type: "dropoff", entry: e });
    });

    let best = null;
    let bestDist = Infinity;
    candidates.forEach((c) => {
      const d = c.locId === current ? 0 : getDistance(current, c.locId);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    });
    if (!best) break;

    total += bestDist;
    current = best.locId;
    currentStep(bestDist);
    if (best.type === "pickup") {
      best.entry.pickedUp = true;
      addAction("pickup", best.entry.mission, best.entry.item, best.entry.index);
    } else {
      best.entry.droppedOff = true;
      addAction("dropoff", best.entry.mission, best.entry.item, best.entry.index);
    }
  }

  const maxLoad = annotateCargoLoad(steps);

  return {
    steps,
    total: roundScu(total),
    approximate: true,
    revisited: true,
    stopCount: steps.length,
    maxCargoLoad: maxLoad,
  };
}

function optimizeRoute(missions, startId, brokenLocationIds, allowRevisits) {
  if (missions.length === 0) return { error: t("selectMissionError") };

  // Un ascenseur de fret HS rend son lieu inutilisable pour le ramassage
  // COMME le dépôt : toute ligne de cargaison qui s'appuie dessus (d'un côté
  // ou de l'autre) est ignorée pour ce calcul, comme si elle n'existait pas.
  const broken = brokenLocationIds || new Set();
  const isUsable = (item) => !broken.has(item.pickupId) && !broken.has(item.dropoffId);

  const locIds = computeUniqueLocationIds(missions, broken);
  // Le lieu de départ choisi n'est pas forcément un lieu de ramassage/dépôt
  // d'une mission en cours (ex : le joueur part d'une station où il se
  // trouve déjà) : on l'ajoute comme arrêt supplémentaire sans action, pour
  // que son trajet jusqu'au premier vrai arrêt compte dans le calcul.
  if (startId && !locIds.includes(startId)) locIds.unshift(startId);
  const n = locIds.length;
  const idxOf = {};
  locIds.forEach((id, i) => (idxOf[id] = i));

  const dist = [];
  for (let i = 0; i < n; i++) dist.push(new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) dist[i][j] = getDistance(locIds[i], locIds[j]);
    }
  }

  // Le lieu de récupération de chaque marchandise doit être visité avant son
  // propre lieu de dépôt (chaque ligne de cargaison porte ses deux lieux).
  const constraints = [];
  missions.forEach((m) => {
    (m.cargoItems || []).forEach((item) => {
      if (!isUsable(item)) return;
      if (item.pickupId && item.dropoffId && item.pickupId !== item.dropoffId) {
        constraints.push([idxOf[item.pickupId], idxOf[item.dropoffId]]);
      }
    });
  });

  const startIdx = startId ? idxOf[startId] ?? null : null;

  let order;
  let approximate = false;
  if (n <= EXACT_DP_MAX_LOCATIONS) {
    order = solveExactDP(n, dist, constraints, startIdx);
  } else {
    order = solveHeuristic(n, dist, constraints, startIdx);
    approximate = true;
  }

  if (!order) {
    // Si le joueur a explicitement coché "autoriser à revisiter un lieu",
    // on retombe sur le parcours glouton (voir solveRouteWithRevisits) qui
    // peut repasser par un même lieu pour débloquer la situation, plutôt
    // que de simplement échouer.
    if (allowRevisits) return solveRouteWithRevisits(missions, startId, broken);

    // Cause la plus fréquente d'un trajet impossible : deux missions
    // imposent l'ordre inverse l'une de l'autre entre les deux mêmes lieux
    // (A avant B pour l'une, B avant A pour l'autre) — un cycle direct,
    // bien plus parlant à nommer que le message générique de repli.
    const cycle = findDirectConstraintCycle(constraints, locIds);
    if (cycle) {
      return {
        error: t("noValidOrderCycleError", { a: cycle.a.name, b: cycle.b.name, allowRevisitsBtn: t("allowRevisitsBtn") }),
      };
    }
    return { error: t("noValidOrderError") };
  }

  // Chaque action ne porte que les lignes de cargaison réellement concernées
  // par ce lieu précis (une marchandise donnée n'apparaît qu'à SON lieu de
  // récupération et SON lieu de dépôt, plus de doublon sur les autres arrêts
  // de la même mission).
  let total = 0;
  const steps = order.map((idx, i) => {
    if (i > 0) total += dist[order[i - 1]][idx];
    const locId = locIds[idx];
    const actions = [];
    missions.forEach((m) => {
      // L'index d'origine dans mission.cargoItems est conservé (pas juste la
      // copie filtrée) pour pouvoir corriger la bonne ligne depuis le suivi
      // interactif du trajet (quantité réelle, case à cocher).
      const withIndex = (m.cargoItems || []).map((item, index) => ({ ...item, index })).filter(isUsable);
      const pickupItems = withIndex.filter((item) => item.pickupId === locId);
      if (pickupItems.length) actions.push({ type: "pickup", mission: m, items: pickupItems });
      const dropoffItems = withIndex.filter((item) => item.dropoffId === locId);
      if (dropoffItems.length) actions.push({ type: "dropoff", mission: m, items: dropoffItems });
    });
    return { locId, actions, legDistance: i > 0 ? dist[order[i - 1]][idx] : 0 };
  });

  // Charge de cargo réellement présente sur le vaisseau à chaque arrêt : on
  // ajoute au retrait, on retire au dépôt. C'est cette charge cumulée le long
  // du trajet qui compte pour la capacité, pas la somme brute de toutes les
  // missions (on décharge en cours de route, ce qui libère de la place).
  let load = 0;
  let maxLoad = 0;
  steps.forEach((step) => {
    step.actions.forEach((a) => {
      const sum = a.items.reduce((s, item) => s + (Number(item.quantity) || 0), 0);
      load += a.type === "pickup" ? sum : -sum;
    });
    step.cargoLoad = roundScu(load);
    if (step.cargoLoad > maxLoad) maxLoad = step.cargoLoad;
  });

  return { steps, total, approximate, stopCount: n, maxCargoLoad: maxLoad };
}

// Repère les missions ramassées à l'arrêt précis où la capacité est dépassée
// pour la première fois le long du trajet (celles qui font basculer la charge
// au-dessus du maximum) — pas les autres missions déjà à bord avant ce point.
function computeOverloadCulprits(result, capacity) {
  if (!capacity) return [];
  const overloadIndex = result.steps.findIndex((s) => s.cargoLoad > capacity);
  if (overloadIndex === -1) return [];
  return result.steps[overloadIndex].actions
    .filter((a) => a.type === "pickup")
    .map((a) => a.mission);
}

// =========================================================================
// Rendu DOM
// =========================================================================
// Ajoute la planète/lune entre parenthèses quand elle est connue (voir
// getPlanetHint) — utile pour les lieux dont le nom ne l'indique pas
// explicitement (ex. "HDPC-Cassillo", "Covalex Distribution Centre S4DC05").
function locationLabel(loc) {
  if (!loc) return "?";
  const planet = getPlanetHint(loc);
  return planet ? `${loc.name} (${loc.category} - ${planet})` : `${loc.name} (${loc.category})`;
}

function locationSearchLabel(loc) {
  const planet = getPlanetHint(loc);
  return planet ? `${loc.name} (${loc.category} - ${planet})` : `${loc.name} (${loc.category})`;
}

function findLocationByLabel(text) {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  return allLocations().find((loc) => locationSearchLabel(loc).toLowerCase() === needle) || null;
}

function renderLocationDatalist() {
  const datalist = document.getElementById("locations-datalist");
  const locs = allLocations().slice().sort((a, b) => a.name.localeCompare(b.name));
  datalist.innerHTML = "";
  locs.forEach((loc) => {
    const opt = document.createElement("option");
    opt.value = locationSearchLabel(loc);
    datalist.appendChild(opt);
  });
}

function allCommodities() {
  return state.uexCommodities.length ? state.uexCommodities : DEFAULT_COMMODITIES;
}

function allCompanies() {
  return state.uexCompanies.length ? state.uexCompanies : DEFAULT_COMPANIES;
}

function allShips() {
  return state.uexShips.length ? state.uexShips : DEFAULT_SHIPS;
}

function renderCommodityDatalist() {
  const datalist = document.getElementById("commodities-datalist");
  datalist.innerHTML = "";
  allCommodities().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    datalist.appendChild(opt);
  });
}

function renderCompanyDatalist() {
  const datalist = document.getElementById("companies-datalist");
  datalist.innerHTML = "";
  allCompanies().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    datalist.appendChild(opt);
  });
}

function refreshAllLocationSelects() {
  renderLocationDatalist();
  renderCommodityDatalist();
  renderCompanyDatalist();
  renderStartLocationOptions();
}

function getSelectedShip() {
  if (!state.selectedShip) return null;
  return allShips().find((s) => s.name === state.selectedShip) || null;
}

// Certains joueurs arrivent à charger davantage de SCU que la capacité
// officielle du vaisseau (grilles de cargaison bien remplies, astuces de
// chargement...) : une capacité personnalisée, si renseignée, remplace la
// valeur du catalogue pour tous les calculs de surcharge — sans modifier le
// catalogue lui-même (qui reste affiché tel quel dans le menu déroulant).
function getEffectiveShipCapacity() {
  const custom = Number(state.customShipCapacity);
  if (custom > 0) return custom;
  const ship = getSelectedShip();
  return ship ? ship.scu : null;
}

function renderShipOptions() {
  const sel = document.getElementById("ship-select");
  const prev = state.selectedShip;
  sel.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = t("noneOption");
  sel.appendChild(none);
  allShips()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((ship) => {
      const opt = document.createElement("option");
      opt.value = ship.name;
      opt.textContent = `${ship.name} (${ship.scu} SCU)`;
      if (ship.name === prev) opt.selected = true;
      sel.appendChild(opt);
    });
}

function renderShipCapacity() {
  const el = document.getElementById("ship-capacity");
  const capacity = getEffectiveShipCapacity();
  el.textContent = capacity ? t("shipCapacityPrefix", { scu: capacity }) : t("shipCapacityNone");

  const customInput = document.getElementById("custom-ship-capacity");
  if (document.activeElement !== customInput) customInput.value = state.customShipCapacity || "";
}

const ACCESS_FACE_KEYS = ["back", "front", "left", "right", "top", "bottom"];

function getShipAccessFaces(shipName) {
  return (shipName && state.shipAccessFaces[shipName]) || null;
}

// Emplacements réservés à des véhicules garés pour ce vaisseau, PAR JOUEUR :
// { [moduleKey]: [ {x0,y0,sx,sy,vid}, ... ] }. Passé tel quel comme 5e argument
// de simulateRoutePacking (brique A′), qui indexe par moduleKey et ignore vid.
// {} si aucun -> le rangement se comporte comme avant (rétrocompat brique A′).
// Jamais publié (donnée perso, pas une grille officielle) — synchronisé via
// CLOUD_SYNCED_KEYS comme cargoViewerLayout.
function getShipReservations(shipName) {
  return (shipName && state.cargoReservations[shipName]) || {};
}

// Convertit une grille virtuelle (véhicule) posée LIBREMENT dans la vue 3D en
// réservations par module, dans le repère du packer. Le piège est l'échange
// Y/Z du visualiseur (voir renderCargoViewer3D) : le SOL de la vue est le plan
// (viewer-X, viewer-Z) = (packing-x axe 0, packing-y axe 1). On calcule
// l'intersection de l'empreinte monde du véhicule avec le rectangle de sol de
// CHAQUE module, puis on la ramène en cellules locales de ce module. Un module
// n'est pas forcément aligné sur la grille (MODULE_GAP=1.5), d'où l'arrondi.
// vx, vz : coin monde du véhicule sur viewer-X / viewer-Z (mètres).
// sxCells, syCells : taille du véhicule en cellules (axe 0, axe 1).
// resolvedGrid : sortie de getResolvedCargoGrid() (avec moduleKey).
// Retour : [ { moduleKey, x0, y0, sx, sy } ] par module réellement recouvert.
function resolveVehicleReservations(vx, vz, sxCells, syCells, resolvedGrid) {
  const U = UNIT_M;
  const vx1 = vx + sxCells * U;
  const vz1 = vz + syCells * U;
  const out = [];
  (resolvedGrid || []).forEach((m) => {
    const wx = m.position.x;
    const wz = m.position.z;
    const wx1 = wx + m.dimensions.x; // dim.x le long de viewer-X
    const wz1 = wz + m.dimensions.y; // dim.y le long de viewer-Z
    const ix0 = Math.max(vx, wx);
    const ix1 = Math.min(vx1, wx1);
    const iz0 = Math.max(vz, wz);
    const iz1 = Math.min(vz1, wz1);
    if (ix1 - ix0 <= 1e-6 || iz1 - iz0 <= 1e-6) return; // pas d'intersection réelle
    const cellsX = Math.max(1, Math.round(m.dimensions.x / U));
    const cellsY = Math.max(1, Math.round(m.dimensions.y / U));
    let x0 = Math.round((ix0 - wx) / U);
    let y0 = Math.round((iz0 - wz) / U);
    let sx = Math.round((ix1 - ix0) / U);
    let sy = Math.round((iz1 - iz0) / U);
    // Borne dans la grille du module ; un chevauchement < 1 cellule après
    // arrondi (le véhicule n'effleure qu'un liseré) est ignoré.
    x0 = Math.max(0, Math.min(x0, cellsX - 1));
    y0 = Math.max(0, Math.min(y0, cellsY - 1));
    sx = Math.min(Math.max(sx, 0), cellsX - x0);
    sy = Math.min(Math.max(sy, 0), cellsY - y0);
    if (sx < 1 || sy < 1) return;
    out.push({ moduleKey: m.moduleKey, x0, y0, sx, sy });
  });
  return out;
}

// Re-rend la vue 3D en gardant le mode réservation actif (les overlays de
// réservation se redessinent alors, voir js/cargo-viewer.js). Utilisé après une
// dépose ou un effacement.
function rerenderCargoReservationView() {
  const ship = getCargoViewerShipName();
  if (!ship || typeof renderCargoViewer3D !== "function") return;
  const holds = getShipHolds(ship) || [];
  renderCargoViewer3D(
    holds,
    [],
    getCargoViewerOrientation(ship),
    getCargoViewerMirror(ship),
    getCargoViewerLayout(ship)
  );
}

// Hook lu par le visualiseur pour dessiner les réservations déjà posées du
// vaisseau affiché : { [moduleKey]: [ {x0,y0,sx,sy,vid} ] }.
window.getReservationOverlays = function getReservationOverlays() {
  const ship = getCargoViewerShipName();
  return (ship && state.cargoReservations[ship]) || {};
};

// Hook appelé par le visualiseur quand le joueur lâche sa grille virtuelle
// (véhicule) : coin monde (viewer X/Z) + taille en cellules. On résout
// l'intersection avec les modules (fonction pure) et on stocke une empreinte
// par module couvert, toutes marquées du même vid (un véhicule). Lâché hors de
// toute soute -> rien (la grille virtuelle reste, le joueur peut réessayer).
window.onReservationVehicleDropped = function onReservationVehicleDropped(vx, vz, sx, sy) {
  const ship = getCargoViewerShipName();
  if (!ship) return;
  const fps = resolveVehicleReservations(vx, vz, sx, sy, getResolvedCargoGrid());
  if (!fps.length) return;
  // Identifiant de véhicule unique même pour deux déposes dans la même
  // milliseconde (Date.now() seul collait, voir revue brique B #6) : suffixe
  // aléatoire. Sert au regroupement et à « Effacer ».
  const vid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!state.cargoReservations[ship]) state.cargoReservations[ship] = {};
  fps.forEach((f) => {
    if (!state.cargoReservations[ship][f.moduleKey]) state.cargoReservations[ship][f.moduleKey] = [];
    // vl/vw = taille du véhicule d'origine (label de la liste) ; le packer les
    // ignore. sx/sy = empreinte réelle dans CE module (peut être plus petite si
    // le véhicule est à cheval).
    state.cargoReservations[ship][f.moduleKey].push({ x0: f.x0, y0: f.y0, sx: f.sx, sy: f.sy, vid, vl: sx, vw: sy });
  });
  saveState();
  rerenderCargoReservationView();
  if (typeof renderReservationList === "function") renderReservationList();
};

// Retire toutes les empreintes d'un véhicule (par vid) sur toutes les soutes du
// vaisseau, supprime les listes/soutes vidées, et rafraîchit.
function removeReservationVehicle(ship, vid) {
  const byModule = state.cargoReservations[ship];
  if (!byModule) return;
  Object.keys(byModule).forEach((key) => {
    byModule[key] = byModule[key].filter((f) => f.vid !== vid);
    if (!byModule[key].length) delete byModule[key];
  });
  if (!Object.keys(byModule).length) delete state.cargoReservations[ship];
  saveState();
  rerenderCargoReservationView();
  renderReservationList();
  if (cargoPackState) runCargoPacking(); // relance le rangement si un est affiché
}

// Total SCU réservés sur ce vaisseau = Σ (sx·sy·hauteur-du-module en cellules).
// La hauteur (pleine, axe 2) vient des soutes résolues, par moduleKey.
function reservedScuForShip(ship) {
  const byModule = (ship && state.cargoReservations[ship]) || {};
  const heightByKey = {};
  (getResolvedCargoGrid && getResolvedCargoGrid() || []).forEach((m) => {
    heightByKey[m.moduleKey] = Math.max(1, Math.round(m.dimensions.z / UNIT_M));
  });
  let total = 0;
  Object.keys(byModule).forEach((key) => {
    const h = heightByKey[key] || 1;
    byModule[key].forEach((f) => (total += f.sx * f.sy * h));
  });
  return total;
}

// Panneau réservation : mode exclusif + entrée/sortie.
function setReservationEditUI(on) {
  document.getElementById("reservation-panel").style.display = on ? "" : "none";
  document.getElementById("reservation-edit-btn").style.display = on ? "none" : "";
  // Un seul mode d'édition à la fois : masquer les autres entrées pendant, y
  // compris celle de l'éditeur admin (voir revue brique B, finding #4 — sinon
  // ouvrir l'éditeur admin en mode réservation laisse un éditeur bloqué, les
  // modules n'étant pas cliquables tant que reservationMode est actif).
  ["cargo-viewer-edit-btn", "cargo-viewer-rotate-btn", "cargo-viewer-mirror-btn", "admin-grid-edit-btn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && on) el.style.display = "none";
  });
}

function enterReservationEdit() {
  const ship = getCargoViewerShipName() || (getSelectedShip() && getSelectedShip().name);
  if (!ship) return;
  document.getElementById("cargo-viewer-panel").style.display = "";
  if (typeof setCargoReservationMode === "function") setCargoReservationMode(true);
  if (typeof setCargoLayoutEditing === "function") setCargoLayoutEditing(true);
  setReservationEditUI(true);
  rerenderCargoReservationView();
  renderReservationList();
}

// =========================================================================
// Onglet de modération des propositions (brique 2b). N'est qu'un confort
// d'affichage : la RLS refuse toute écriture d'un non-admin même s'il forçait
// l'onglet à s'afficher.
// =========================================================================

// L'onglet n'apparaît que pour un admin. Appelé quand isAdminUser est posé
// (voir fetchIsAdmin) et au rendu général.
function renderSubmissionsEntry() {
  const btn = document.getElementById("submissions-tab-btn");
  if (btn) btn.style.display = isAdminUser ? "" : "none";
}

// Aperçu 3D d'une proposition : ses modules, ZÉRO caisse, ses positions et son
// orientation — c'est ce qui permet de juger une grille au lieu de valider du
// JSON en aveugle.
function previewSubmission(sub) {
  if (typeof renderCargoViewer3D !== "function" || !sub || !Array.isArray(sub.grid)) return;
  // Le visualiseur 3D vit dans l'onglet « Optimisation du cargo ». Rendre dedans
  // depuis l'onglet Propositions dessinait dans un conteneur dont le PARENT est
  // masqué : le clic semblait ne rien faire (constaté à l'usage). On bascule
  // donc sur l'onglet qui l'affiche réellement.
  if (typeof activateTab === "function") activateTab("cargo-tab");
  document.getElementById("cargo-viewer-panel").style.display = "";
  const holds = sub.grid.map((m) => ({
    name: m.name,
    dimensions: m.dimensions,
    capacity: m.capacity,
    maxContainerSize: m.maxContainerSize,
  }));
  const positions = {};
  sub.grid.forEach((m) => {
    if (m.position) positions[m.name] = { x: m.position.x, y: m.position.y, z: m.position.z };
  });
  renderCargoViewer3D(holds, [], sub.orientation || 0, !!sub.mirror, positions);
}

// Liste des propositions en attente, avec aperçu / valider / rejeter.
async function renderSubmissionsTab() {
  const box = document.getElementById("submissions-list");
  if (!box) return;
  box.textContent = t("submissionsLoading");
  const subs = await fetchPendingSubmissions();
  box.innerHTML = "";
  if (!subs.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t("submissionsEmpty");
    box.appendChild(p);
    return;
  }
  subs.forEach((sub) => {
    const row = document.createElement("div");
    row.className = "admin-grid-row";
    const label = document.createElement("span");
    label.className = "hint";
    const when = sub.created_at ? new Date(sub.created_at).toLocaleString() : "";
    label.textContent = `${sub.ship_name} — ${sub.submitter_name || "?"} ${when}`;
    row.appendChild(label);

    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "btn-secondary btn-view-sm";
    preview.textContent = t("submissionPreview");
    preview.addEventListener("click", () => previewSubmission(sub));
    row.appendChild(preview);

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "btn-primary btn-view-sm";
    ok.textContent = t("submissionApprove");
    ok.addEventListener("click", async () => {
      if (!(await approveSubmission(sub.id))) return;
      // La grille validée devient celle de tout le monde : on rafraîchit le
      // cache local pour la voir tout de suite, sans attendre la prochaine synchro.
      state.approvedShipGrids[sub.ship_name] = {
        grid: sub.grid,
        orientation: sub.orientation || 0,
        mirror: !!sub.mirror,
      };
      saveState();
      renderSubmissionsTab();
    });
    row.appendChild(ok);

    const no = document.createElement("button");
    no.type = "button";
    no.className = "btn-danger btn-view-sm";
    no.textContent = t("submissionReject");
    no.addEventListener("click", async () => {
      if (await rejectSubmission(sub.id)) renderSubmissionsTab();
    });
    row.appendChild(no);

    box.appendChild(row);
  });
}

// Une proposition ne vaut que si la disposition a RÉELLEMENT été modifiée :
// sans ça on proposerait une grille identique à l'existante — du bruit à
// modérer. Piège : « Corriger cette disposition » AMORCE cargoViewerLayout
// depuis la grille publiée, donc « non vide » ne signifie PAS « modifié ». On
// compare donc à la référence plutôt que de se fier à sa présence.
function hasLayoutChanges(shipName) {
  const layout = shipName && state.cargoViewerLayout[shipName];
  if (!layout || !Object.keys(layout).length) return false;
  const published = getPublishedGridPositions(shipName);
  // Pas de grille publiée : la seule façon d'avoir une entrée est un glisser.
  if (!published) return true;
  return Object.keys(layout).some((k) => {
    const a = layout[k];
    const b = published[k];
    return !b || a.x !== b.x || a.y !== b.y || a.z !== b.z;
  });
}

// Visibilité de « Proposer cette disposition ». Extrait de renderCargoStepView
// pour pouvoir être rappelé après CHAQUE glisser sans reconstruire la scène 3D
// — un re-rendu complet couperait le geste et ferait clignoter la vue.
function updateProposeButton() {
  const btn = document.getElementById("propose-layout-btn");
  if (!btn) return;
  const ship = getCargoViewerShipName();
  const connected = typeof cloudUserId !== "undefined" && !!cloudUserId;
  const published = ship ? state.approvedShipGrids[ship] : null;
  const unlocked = !!(ship && state.cargoViewerUnlocked[ship]);
  const editable = !published || unlocked || isAdminUser;
  btn.style.display = ship && connected && editable && hasLayoutChanges(ship) ? "" : "none";
}

// Pseudo affiché du compte connecté (posé par updateAuthUI dans js/cloud.js) —
// joint à la proposition pour que le mainteneur sache qui propose.
function getConnectedUserName() {
  const el = document.getElementById("user-name");
  return (el && el.textContent && el.textContent.trim()) || null;
}

// « Proposer cette disposition » : envoie la grille RÉSOLUE (tous les modules
// avec leurs positions, pas la surcharge partielle) à la modération.
async function proposeCurrentLayout() {
  // Aucun échec SILENCIEUX ici : un clic qui ne produit ni effet ni message est
  // indébogable (constaté à l'usage — « je n'ai rien reçu » alors que rien
  // n'avait même été envoyé). Chaque sortie dit pourquoi.
  const ship = getCargoViewerShipName();
  if (!ship) {
    showToast(t("proposalNoShip"), "error");
    return;
  }
  const grid = typeof getResolvedCargoGrid === "function" ? getResolvedCargoGrid() : [];
  if (!grid.length) {
    showToast(t("proposalNoGrid"), "error");
    return;
  }
  // submitLayoutProposal renvoie false sans rien dire si la session a expiré
  // (le bouton, lui, n'est affiché qu'aux connectés) : on le signale ici.
  if (typeof cloudUserId === "undefined" || !cloudUserId) {
    showToast(t("proposalNeedsLogin"), "error");
    return;
  }
  const ok = await submitLayoutProposal(
    ship,
    grid,
    getCargoViewerOrientation(ship),
    getCargoViewerMirror(ship),
    getConnectedUserName()
  );
  if (ok) showToast(t("proposalSent"), "success");
}

// « Proposer une correction » : déverrouille LOCALEMENT la grille publiée et
// amorce la disposition perso À PARTIR d'elle — le joueur corrige l'existant
// au lieu de repartir de la reconstruction automatique. Ne change rien pour
// les autres joueurs.
function proposeCorrection() {
  const ship = getCargoViewerShipName();
  if (!ship) return;
  const positions = getPublishedGridPositions(ship);
  if (positions) state.cargoViewerLayout[ship] = { ...positions };
  state.cargoViewerUnlocked[ship] = true;
  saveState();
  renderCargoStepView();
}

function exitReservationEdit() {
  if (typeof setCargoReservationMode === "function") setCargoReservationMode(false);
  if (typeof setCargoLayoutEditing === "function") setCargoLayoutEditing(false);
  setReservationEditUI(false);
  renderCargoStepView();
  // Restaure l'entrée de l'éditeur admin, masquée pendant la réservation (elle
  // n'est réaffichée que pour un admin avec un vaisseau, voir renderAdminGridEntry).
  renderAdminGridEntry();
}

// Crée la grille virtuelle à glisser depuis les champs Longueur/Largeur.
function placeReservationVehicle() {
  const l = Math.max(1, Math.round(Number(document.getElementById("reservation-len").value) || 1));
  const w = Math.max(1, Math.round(Number(document.getElementById("reservation-wid").value) || 1));
  if (typeof setReservationVehicleSize === "function") setReservationVehicleSize(l, w);
}

// Liste des véhicules réservés (regroupés par vid) + « Effacer », + total SCU.
function renderReservationList() {
  const box = document.getElementById("reservation-list");
  if (!box) return;
  box.innerHTML = "";
  const ship = getCargoViewerShipName();
  const byModule = (ship && state.cargoReservations[ship]) || {};
  // Regroupe les empreintes par vid (un véhicule = un vid).
  const byVid = new Map();
  Object.keys(byModule).forEach((key) => {
    byModule[key].forEach((f) => {
      if (!byVid.has(f.vid)) byVid.set(f.vid, f);
    });
  });
  byVid.forEach((f, vid) => {
    const row = document.createElement("div");
    row.className = "admin-grid-row";
    const label = document.createElement("span");
    label.className = "hint";
    label.textContent = t("reservationVehicleLabel", { l: f.vl || f.sx, w: f.vw || f.sy });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-danger btn-view-sm";
    del.textContent = t("reservationClearBtn");
    del.addEventListener("click", () => removeReservationVehicle(ship, vid));
    row.appendChild(label);
    row.appendChild(del);
    box.appendChild(row);
  });
  const total = reservedScuForShip(ship);
  if (total > 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t("reservedScu", { n: total });
    box.appendChild(p);
  }
}

// Orientation Avant/Arrière/Gauche/Droite de la vue 3D : rotation (0-3, par
// pas de 90°) + miroir (voir js/cargo-viewer.js:currentOrientation/
// currentMirror) — FleetYards ne donne parfois aucune position réelle pour
// les modules de soute (ex. Ironclad), la disposition affichée est alors
// une reconstruction à partir des noms de hardpoint — une supposition que
// seul le joueur peut confirmer ou corriger. La rotation seule ne couvre
// que 4 des 8 façons dont l'étiquetage peut être faux (elle ne peut pas
// échanger gauche/droite en laissant avant/arrière fixes, par exemple) —
// le miroir couvre les 4 autres. Mémorisées par vaisseau (comme
// shipAccessFaces ci-dessus) : un vaisseau mal orienté une fois reste
// corrigé pour les prochaines fois.
function getCargoViewerOrientation(shipName) {
  return (shipName && state.cargoViewerOrientation[shipName]) || 0;
}

function getCargoViewerMirror(shipName) {
  return !!(shipName && state.cargoViewerMirror[shipName]);
}

// N'appelle jamais renderCargoStepView()/renderCargoViewer3D (qui vide et
// reconstruit toute la scène, caméra comprise) : seule
// window.updateCargoViewerOrientation touche à l'étiquetage, pour que
// tourner/mirer ne fasse jamais sauter l'angle de vue ou le zoom que le
// joueur a mis en place à la souris (voir js/cargo-viewer.js:
// buildAxisLabels pour le détail de ce découplage).
function applyCargoViewerOrientation(shipName) {
  if (typeof updateCargoViewerOrientation !== "function") return;
  updateCargoViewerOrientation(getCargoViewerOrientation(shipName), getCargoViewerMirror(shipName));
}

function rotateCargoViewerOrientation() {
  const shipName = getCargoViewerShipName();
  if (!shipName) return;
  const current = getCargoViewerOrientation(shipName);
  state.cargoViewerOrientation[shipName] = (current + 1) % 4;
  saveState();
  applyCargoViewerOrientation(shipName);
}

function mirrorCargoViewerOrientation() {
  const shipName = getCargoViewerShipName();
  if (!shipName) return;
  state.cargoViewerMirror[shipName] = !getCargoViewerMirror(shipName);
  saveState();
  applyCargoViewerOrientation(shipName);
}

// Disposition manuelle des grilles de cargo, par vaisseau (voir
// docs/superpowers/specs/2026-07-17-manual-cargo-grid-placement-design.md).
// FleetYards ne donne pas les positions réelles des soutes : le joueur peut
// glisser chaque grille à sa vraie place (mode édition, js/cargo-viewer.js).
// Surcharge PARTIELLE : seuls les modules déplacés sont mémorisés, les autres
// gardent la reconstruction auto. La clé de module est opaque ici — c'est le
// visualiseur qui la produit (moduleKey), app.js ne fait que la stocker.
function getCargoViewerLayout(shipName) {
  return (shipName && state.cargoViewerLayout[shipName]) || {};
}

// Le vaisseau auquel appartient la scène 3D actuellement affichée — pas
// forcément getSelectedShip() : changer le sélecteur de vaisseau ne
// recalcule pas le rangement (cargoPackState garde l'ancien vaisseau tant
// qu'on n'a pas relancé « Calculer le rangement »). Passer par
// getSelectedShip() écrirait les réglages du vaisseau AFFICHÉ dans ceux du
// vaisseau SÉLECTIONNÉ, et corromprait la disposition de ce dernier.
function getCargoViewerShipName() {
  if (cargoPackState && cargoPackState.shipName) return cargoPackState.shipName;
  const ship = getSelectedShip();
  return ship ? ship.name : null;
}

// Appelée par js/cargo-viewer.js au relâchement d'un glisser. x/y/z sont
// l'origine (coin) du module, chacun déjà aimanté sur 1,25 m et borné à >= 0
// côté visualiseur.
window.persistCargoModulePosition = function persistCargoModulePosition(moduleKey, x, y, z) {
  // En édition admin, un glisser modifie le BROUILLON (rien n'est publié tant
  // que Publier n'est pas cliqué), pas la disposition perso du joueur.
  if (adminGridDraft) {
    const mod = adminGridDraft.find((m) => m.name === moduleKey);
    if (mod) {
      mod.position = { x, y, z };
      adminGridSelected = moduleKey;
      renderAdminGridSelection();
    }
    return;
  }
  const shipName = getCargoViewerShipName();
  if (!shipName || !moduleKey) return;
  if (!state.cargoViewerLayout[shipName]) state.cargoViewerLayout[shipName] = {};
  state.cargoViewerLayout[shipName][moduleKey] = { x, y, z };
  saveState();
  // « Proposer » n'apparaît qu'une fois la grille réellement modifiée : c'est
  // ici, et seulement ici, qu'on sait qu'un déplacement vient d'avoir lieu. On
  // ne met à jour QUE le bouton — re-rendre la scène couperait le glisser.
  updateProposeButton();
};

window.onCargoModulePicked = function onCargoModulePicked(moduleKey) {
  if (!adminGridDraft) return;
  adminGridSelected = moduleKey;
  renderAdminGridSelection();
};

// Bouton « Réinitialiser la disposition » : ce vaisseau repart à 100 % auto.
window.resetCargoViewerLayout = function resetCargoViewerLayout() {
  const shipName = getCargoViewerShipName();
  if (!shipName) return;
  delete state.cargoViewerLayout[shipName];
  saveState();
  renderCargoStepView();
};

// Bascule l'interface du visualiseur entre usage normal et mode édition de
// la disposition : en édition, seuls « Terminer » et « Réinitialiser » ont
// du sens (rotation/miroir sont masqués ; les boutons de vue préréglée
// restent visibles, c'est ainsi qu'on choisit le plan de glisser-déposer).
function setCargoLayoutEditUI(editing) {
  document.getElementById("cargo-viewer-edit-btn").style.display = editing ? "none" : "";
  document.getElementById("cargo-viewer-edit-done-btn").style.display = editing ? "" : "none";
  document.getElementById("cargo-viewer-reset-layout-btn").style.display = editing ? "" : "none";
  document.getElementById("cargo-edit-hint").style.display = editing ? "" : "none";
  document.getElementById("cargo-viewer-rotate-btn").style.display = editing ? "none" : "";
  document.getElementById("cargo-viewer-mirror-btn").style.display = editing ? "none" : "";
  // Exclusivité des modes : « Réserver » ne doit pas être cliquable pendant
  // l'édition de disposition (un seul mode d'édition à la fois).
  const resBtn = document.getElementById("reservation-edit-btn");
  if (resBtn) resBtn.style.display = editing ? "none" : "";
}

// Équivalent de setCargoLayoutEditUI, mais pour L'ÉDITEUR ADMIN — ne doit
// JAMAIS LAISSER VISIBLES #cargo-viewer-edit-done-btn, #cargo-viewer-reset-layout-btn
// ni #cargo-edit-hint pendant l'édition admin : ces trois éléments pilotent
// la disposition PERSO du joueur (state.cargoViewerLayout / exitCargoLayoutEdit /
// resetCargoViewerLayout), sans aucun rapport avec adminGridDraft. Les
// emprunter à setCargoLayoutEditUI (comme avant) laissait « Terminer » sortir
// de l'édition sans fermer #admin-grid-panel (état bâtard) et « Réinitialiser »
// effacer silencieusement la disposition perso de l'admin — voir revue
// finale 2a, finding #4. Un simple "ne jamais les AFFICHER" ne suffit pas :
// si le joueur était déjà en cours d'édition perso (les trois visibles) au
// moment où il ouvre l'éditeur admin — #admin-grid-edit-btn reste visible
// pendant l'édition perso, rien ne l'empêche — il faut aussi les MASQUER en
// entrant, sans quoi ils restent visibles par-dessus l'éditeur admin et
// #pack-cargo-btn reste bloqué (désactivé par enterAdminGridEdit) tant que
// l'admin n'a pas trouvé « Fermer sans publier » — voir revue finale 2a,
// finding A. À la sortie, on rend la main à l'état NON éditant, sans mémoriser
// si le joueur était en édition perso en entrant : exitAdminGridEdit appelle
// déjà setCargoLayoutEditing(false) (le glisser est coupé) et renderCargoStepView()
// juste après réaffiche « Éditer »/« Tourner »/« Miroir ». Restaurer l'UI
// d'édition perso ici afficherait « Terminer » et « Réinitialiser » à côté
// d'« Éditer » alors que plus rien ne glisse — voir revue finale 2a. Re-cliquer
// « Éditer la disposition » coûte un clic et repart d'un état cohérent.
// #admin-grid-close-btn (« Fermer sans publier ») est l'unique sortie de
// l'éditeur admin.
function setAdminGridEditUI(editing) {
  if (editing) {
    document.getElementById("cargo-viewer-edit-btn").style.display = "none";
    document.getElementById("cargo-viewer-rotate-btn").style.display = "none";
    document.getElementById("cargo-viewer-mirror-btn").style.display = "none";
    document.getElementById("cargo-viewer-edit-done-btn").style.display = "none";
    document.getElementById("cargo-viewer-reset-layout-btn").style.display = "none";
    document.getElementById("cargo-edit-hint").style.display = "none";
    // Exclusivité : « Réserver » ne doit pas rester cliquable pendant l'édition
    // admin — sinon on lancerait le mode réservation par-dessus un brouillon
    // admin en cours (voir revue brique B, finding #4).
    const resBtn = document.getElementById("reservation-edit-btn");
    if (resBtn) resBtn.style.display = "none";
  } else {
    setCargoLayoutEditUI(false);
  }
}

function enterCargoLayoutEdit() {
  if (typeof setCargoLayoutEditing !== "function") return;
  setCargoLayoutEditing(true);
  setCargoLayoutEditUI(true);
  renderCargoStepView();
}

function exitCargoLayoutEdit() {
  if (typeof setCargoLayoutEditing !== "function") return;
  setCargoLayoutEditing(false);
  setCargoLayoutEditUI(false);
  renderCargoStepView();
}

function renderShipAccessFaces() {
  const ship = getSelectedShip();
  const faces = (ship && getShipAccessFaces(ship.name)) || DEFAULT_ACCESS_FACES;
  ACCESS_FACE_KEYS.forEach((face) => {
    const el = document.getElementById(`access-face-${face}`);
    el.checked = !!faces[face];
    el.disabled = !ship;
  });
}

function renderStartLocationOptions() {
  const sel = document.getElementById("start-location");
  const prev = sel.value;
  const usedIds = computeUniqueLocationIds(activeMissions().filter((m) => m.included));
  sel.innerHTML = "";
  const free = document.createElement("option");
  free.value = "";
  free.textContent = t("freeStart");
  sel.appendChild(free);
  usedIds
    .map((id) => getLocationById(id))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((loc) => {
      const opt = document.createElement("option");
      opt.value = loc.id;
      opt.textContent = loc.name;
      if (loc.id === prev) opt.selected = true;
      sel.appendChild(opt);
    });
}

// =========================================================================
// Réputation (estimation), issue de l'API Star Citizen Wiki. Deux catalogues
// baked, essayés dans l'ordre :
// 1. data/mission-reputation-by-title.js — indexé par titre EXACT de contrat
//    (ex. "Junior Hauler Needed for Small Shipment"). Vérifié empiriquement :
//    un même titre donne quasi toujours la même réputation, quels que soient
//    les lieux/marchandises de l'instance — bien plus fiable, mais seulement
//    utilisable si le vrai titre du contrat a été capturé (OCR ou saisie
//    manuelle), pas le nom générique "Mission N".
// 2. data/mission-reputation.js — repli par simple donneur quand le titre est
//    inconnu ou introuvable, beaucoup plus approximatif (plusieurs contrats
//    très différents partagent le même donneur).
// Dans les deux cas, quand plusieurs variantes existent, on choisit celle
// dont la plage de récompense contient (ou se rapproche le plus de) la
// récompense réelle de la mission.
// Certaines variantes n'ont qu'une seule récompense connue (pas de plage) :
// la génération des données pose alors rewardMax à 0 au lieu de le dupliquer
// depuis rewardMin. On traite ce cas comme une plage exacte [min, min].
function effectiveRewardMax(v) {
  return v.rewardMax > 0 ? v.rewardMax : v.rewardMin;
}

function pickReputationVariant(variants, reward) {
  if (!variants || !variants.length) return null;
  const inRange = variants.find((v) => v.rewardMin > 0 && reward >= v.rewardMin && reward <= effectiveRewardMax(v));
  if (inRange) return inRange.rep;

  let best = null;
  let bestDist = Infinity;
  variants.forEach((v) => {
    if (v.rewardMin <= 0) return;
    const dist = Math.abs((v.rewardMin + effectiveRewardMax(v)) / 2 - reward);
    if (dist < bestDist) {
      bestDist = dist;
      best = v;
    }
  });
  return (best || variants[0]).rep;
}

function findTitleReputationVariants(title) {
  if (!title) return null;
  if (DEFAULT_MISSION_REPUTATION_BY_TITLE[title]) return DEFAULT_MISSION_REPUTATION_BY_TITLE[title];
  const lower = title.trim().toLowerCase();
  const key = Object.keys(DEFAULT_MISSION_REPUTATION_BY_TITLE).find((k) => k.toLowerCase() === lower);
  return key ? DEFAULT_MISSION_REPUTATION_BY_TITLE[key] : null;
}

function findGiverReputationVariants(giverName) {
  if (!giverName) return null;
  if (DEFAULT_MISSION_REPUTATION[giverName]) return DEFAULT_MISSION_REPUTATION[giverName];
  const lower = giverName.trim().toLowerCase();
  const key = Object.keys(DEFAULT_MISSION_REPUTATION).find((k) => {
    const kl = k.toLowerCase();
    return kl === lower || kl.includes(lower) || lower.includes(kl);
  });
  return key ? DEFAULT_MISSION_REPUTATION[key] : null;
}

function estimateMissionReputation(mission) {
  const reward = Number(mission.reward) || 0;

  const byTitle = pickReputationVariant(findTitleReputationVariants(mission.name), reward);
  if (byTitle) return byTitle;

  return pickReputationVariant(findGiverReputationVariants(mission.giver), reward);
}

function formatReputationGain(rep) {
  if (!rep || !rep.length) return "";
  return rep.map((r) => `+${r.amount} ${r.scope}`).join(", ");
}

function renderMissionsTable() {
  const tbody = document.getElementById("missions-tbody");
  tbody.innerHTML = "";
  const missions = activeMissions();
  missions.forEach((m) => {
    const tr = document.createElement("tr");

    const tdCheck = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = m.included;
    cb.addEventListener("change", () => {
      setMissionIncluded(m.id, cb.checked);
      renderStartLocationOptions();
      // NE PAS reconstruire la table ici. renderMissionsTable() commence par
      // tbody.innerHTML = "", ce qui retire du DOM la case qu'on vient de
      // cocher : le focus retombait sur <body>, et il fallait re-tabuler
      // depuis le début du document pour atteindre la ligne suivante —
      // cocher plusieurs missions au clavier était impossible. Aucune cellule
      // ne dépend de `included`, seul le pied de tableau change.
      renderMissionsSummary();
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    const tdName = document.createElement("td");
    tdName.textContent = m.name;
    tr.appendChild(tdName);

    const tdGiver = document.createElement("td");
    tdGiver.textContent = m.giver || "-";
    tr.appendChild(tdGiver);

    const tdPickup = document.createElement("td");
    tdPickup.textContent = missionPickupIds(m)
      .map((id) => locationLabel(getLocationById(id)))
      .join(", ");
    tr.appendChild(tdPickup);

    const tdDropoff = document.createElement("td");
    tdDropoff.textContent = missionDropoffIds(m)
      .map((id) => locationLabel(getLocationById(id)))
      .join(", ");
    tr.appendChild(tdDropoff);

    const tdCargo = document.createElement("td");
    const items = m.cargoItems || [];
    if (items.length) {
      items.forEach((item) => {
        const line = document.createElement("div");
        line.textContent = `${item.quantity || "?"} SCU — ${item.commodity || "?"}`;
        tdCargo.appendChild(line);
      });
    } else {
      tdCargo.textContent = "-";
    }
    tr.appendChild(tdCargo);

    const tdReward = document.createElement("td");
    tdReward.textContent = m.reward != null && m.reward !== "" ? `${m.reward} aUEC` : "-";
    tr.appendChild(tdReward);

    const tdRep = document.createElement("td");
    tdRep.className = "hint";
    tdRep.textContent = formatReputationGain(estimateMissionReputation(m)) || "-";
    tr.appendChild(tdRep);

    const tdActions = document.createElement("td");
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "actions-cell";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-primary";
    editBtn.textContent = t("editBtn");
    editBtn.addEventListener("click", () => startEditMission(m));
    actionsWrap.appendChild(editBtn);

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "btn-primary";
    doneBtn.textContent = t("completeBtn");
    doneBtn.addEventListener("click", () => {
      m.completed = true;
      m.completedAt = Date.now();
      saveState();
      renderAll();
    });
    actionsWrap.appendChild(doneBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-danger";
    delBtn.textContent = t("deleteBtn");
    delBtn.addEventListener("click", () => {
      const restoreMission = removeMission(m.id);
      renderAll();
      showToast(t("missionDeleted", { name: m.name }), "info", {
        actionLabel: t("undoBtn"),
        onAction: () => {
          restoreMission();
          renderAll();
          showToast(t("missionRestored", { name: m.name }), "success");
        },
      });
    });
    actionsWrap.appendChild(delBtn);
    tdActions.appendChild(actionsWrap);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  renderMissionsSummary();
}

// Pied du tableau des missions : compteur inclus/total, avertissement au-delà
// de 10 missions, et rappel de capacité. Séparé du rendu des lignes parce que
// c'est la SEULE partie qui change quand on coche une case — reconstruire les
// lignes pour ça détruisait le focus clavier (voir le handler ci-dessus).
function renderMissionsSummary() {
  const missions = activeMissions();
  const summary = document.getElementById("missions-summary");
  const included = missions.filter((m) => m.included);
  const totalCargo = included.reduce(
    (s, m) => s + (m.cargoItems || []).reduce((s2, item) => s2 + (Number(item.quantity) || 0), 0),
    0
  );
  const totalReward = included.reduce((s, m) => s + (Number(m.reward) || 0), 0);
  summary.textContent = missions.length
    ? t("missionsSummary", { included: included.length, total: missions.length, cargo: totalCargo, reward: totalReward })
    : t("noMissionsYet");

  const tooManyWarning = document.getElementById("too-many-missions-warning");
  if (missions.length > 10) {
    tooManyWarning.style.display = "";
    tooManyWarning.textContent = t("tooManyMissionsWarning", { count: missions.length });
  } else {
    tooManyWarning.style.display = "none";
  }

  // Ceci est la somme brute de toutes les récupérations, pas la charge réelle
  // à un instant donné (on décharge en cours de route, ce qui libère de la
  // place) : la vraie vérification de capacité se fait dans le résultat de
  // l'optimisation, une fois l'ordre du trajet connu.
  const capacityEl = document.getElementById("cargo-capacity-status");
  const ship = getSelectedShip();
  capacityEl.className = "hint";
  capacityEl.textContent = ship
    ? t("capacityWithShip", { cargo: totalCargo, shipName: ship.name, shipScu: getEffectiveShipCapacity() })
    : t("capacityNoShip", { cargo: totalCargo });
}

function renderHistoryTable() {
  const tbody = document.getElementById("history-tbody");
  tbody.innerHTML = "";
  const missions = historyMissions();

  // Regroupe les missions terminées identiques (même donneur, mêmes lignes
  // de cargaison, même récompense) en ignorant leur nom, pour compter combien
  // de fois cette mission a été faite.
  const groups = new Map();
  missions.forEach((m) => {
    const sig = missionSignature(m);
    if (!groups.has(sig)) groups.set(sig, { rep: m, ids: [], count: 0 });
    const g = groups.get(sig);
    g.count++;
    g.ids.push(m.id);
  });

  Array.from(groups.values()).forEach((g) => {
    const m = g.rep;
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = m.name;
    tr.appendChild(tdName);

    const tdTimes = document.createElement("td");
    tdTimes.textContent = `× ${g.count}`;
    tr.appendChild(tdTimes);

    const tdGiver = document.createElement("td");
    tdGiver.textContent = m.giver || "-";
    tr.appendChild(tdGiver);

    const tdPickup = document.createElement("td");
    tdPickup.textContent = missionPickupIds(m)
      .map((id) => locationLabel(getLocationById(id)))
      .join(", ");
    tr.appendChild(tdPickup);

    const tdDropoff = document.createElement("td");
    tdDropoff.textContent = missionDropoffIds(m)
      .map((id) => locationLabel(getLocationById(id)))
      .join(", ");
    tr.appendChild(tdDropoff);

    const tdCargo = document.createElement("td");
    const items = m.cargoItems || [];
    if (items.length) {
      items.forEach((item) => {
        const line = document.createElement("div");
        line.textContent = `${item.quantity || "?"} SCU — ${item.commodity || "?"}`;
        tdCargo.appendChild(line);
      });
    } else {
      tdCargo.textContent = "-";
    }
    tr.appendChild(tdCargo);

    const tdReward = document.createElement("td");
    tdReward.textContent = m.reward != null && m.reward !== "" ? `${m.reward} aUEC` : "-";
    tr.appendChild(tdReward);

    const tdRep = document.createElement("td");
    tdRep.className = "hint";
    const rep = estimateMissionReputation(m);
    tdRep.textContent = rep ? `${formatReputationGain(rep)}${g.count > 1 ? ` (× ${g.count})` : ""}` : "-";
    tr.appendChild(tdRep);

    const tdActions = document.createElement("td");
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "actions-cell";
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn-primary-sm";
    restoreBtn.textContent = t("restoreBtn");
    restoreBtn.addEventListener("click", () => {
      // Ne restaure qu'une seule occurrence du groupe (la dernière terminée).
      const id = g.ids[g.ids.length - 1];
      const mission = state.missions.find((mm) => mm.id === id);
      if (mission) mission.completed = false;
      saveState();
      renderAll();
    });
    actionsWrap.appendChild(restoreBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-danger-sm";
    delBtn.textContent = t("deleteBtn");
    delBtn.addEventListener("click", () => {
      // Supprime toutes les occurrences du groupe.
      state.missions = state.missions.filter((mm) => !g.ids.includes(mm.id));
      saveState();
      renderAll();
    });
    actionsWrap.appendChild(delBtn);
    tdActions.appendChild(actionsWrap);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  const summary = document.getElementById("history-summary");
  const totalReward = missions.reduce((s, m) => s + (Number(m.reward) || 0), 0);
  summary.textContent = missions.length
    ? t("historySummary", { count: missions.length, reward: totalReward })
    : t("noHistoryYet");

  renderReputationSummary(missions);
}

// Cumul de la réputation estimée gagnée (par faction/palier) sur l'ensemble
// des missions terminées — chaque mission de l'historique compte pour une
// occurrence réelle (pas de dédoublonnage, contrairement à l'affichage "× N").
// Réutilisé par renderReputationSummary et renderCompaniesTab.
function computeReputationTotals(missions) {
  const totals = new Map();
  missions.forEach((m) => {
    const rep = estimateMissionReputation(m);
    if (!rep) return;
    rep.forEach((r) => {
      const key = `${r.faction}|${r.scope}`;
      totals.set(key, (totals.get(key) || 0) + r.amount);
    });
  });
  return totals;
}

function renderReputationSummary(missions) {
  const container = document.getElementById("reputation-summary");
  if (!container) return;
  container.innerHTML = "";

  const totals = computeReputationTotals(missions);
  if (!totals.size) return;

  const title = document.createElement("h3");
  title.textContent = t("reputationSummaryTitle");
  container.appendChild(title);

  const list = document.createElement("ul");
  list.className = "reputation-list";
  Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, amount]) => {
      const [faction, scope] = key.split("|");
      const li = document.createElement("li");
      li.textContent = `${faction} — ${scope} : +${amount}`;
      list.appendChild(li);
    });
  container.appendChild(list);
}

// Onglet "Entreprises" : pour chaque entreprise ayant un palier de
// réputation connu (data/faction-reputation-ladders.js, issu de l'API Star
// Citizen Wiki), affiche la table de référence des paliers ET la
// progression réelle (calculée depuis l'historique) superposée dessus. Le
// "scope" du palier d'une entreprise (ex : "Hauling" pour Covalex) indique
// quelle catégorie de réputation cumulée (computeReputationTotals) lui
// correspond.
function renderCompaniesTab() {
  const container = document.getElementById("companies-list");
  if (!container || typeof FACTION_REPUTATION_LADDERS === "undefined") return;
  container.innerHTML = "";

  const totals = computeReputationTotals(historyMissions());

  // Seules les entreprises de transport interessent cet outil de cargo-
  // hauling — on ecarte les autres (chasseurs de primes, techniciens,
  // mercenaires, etc.). La plupart ont un palier nomme "Hauling", mais
  // certaines organisations illegales (ex : Dead Saints, contrebande) ont un
  // palier nomme "FactionReputation" cote API tout en donnant bien de la
  // reputation "Hauling" via leurs missions (voir data/mission-reputation*.js)
  // — on les inclut explicitement malgre l'etiquette de palier differente.
  const ILLEGAL_HAULING_FACTIONS = ["Dead Saints"];
  Object.keys(FACTION_REPUTATION_LADDERS)
    .filter(
      (factionName) =>
        FACTION_REPUTATION_LADDERS[factionName].scope === "Hauling" ||
        ILLEGAL_HAULING_FACTIONS.includes(factionName)
    )
    .sort((a, b) => a.localeCompare(b))
    .forEach((factionName) => {
      const ladder = FACTION_REPUTATION_LADDERS[factionName];
      const standings = ladder.standings;
      if (!standings || !standings.length) return;
      // Les missions de contrebande (ex : Dead Saints) creditent le scope
      // "Hauling" meme quand le palier de l'entreprise s'appelle autrement.
      const totalsScope = ILLEGAL_HAULING_FACTIONS.includes(factionName) ? "Hauling" : ladder.scope;

      // Le jeu n'affiche jamais le nombre exact de réputation, seulement le
      // palier atteint + une barre de progression sans valeur — l'estimation
      // par historique peut donc dériver (missions non enregistrées, calcul
      // approximatif). Un calibrage manuel sert de POINT DE DÉPART ("j'en
      // suis là en jeu, maintenant") : les missions terminées ENSUITE
      // continuent de s'additionner par-dessus automatiquement, plutôt que de
      // figer l'affichage pour toujours.
      const override = state.reputationOverrides[factionName];
      let current;
      if (override) {
        const missionsSinceCalibration = historyMissions().filter(
          (m) => (m.completedAt || 0) > (override.calibratedAt || 0)
        );
        const gainedSince = computeReputationTotals(missionsSinceCalibration).get(`${factionName}|${totalsScope}`) || 0;
        current = override.points + gainedSince;
      } else {
        current = totals.get(`${factionName}|${totalsScope}`) || 0;
      }

      let currentStanding = standings[0];
      let nextStanding = null;
      for (let i = 0; i < standings.length; i++) {
        if (current >= standings[i].minReputation) currentStanding = standings[i];
        else {
          nextStanding = standings[i];
          break;
        }
      }

      const card = document.createElement("div");
      card.className = "company-card";

      const nameCell = document.createElement("span");
      nameCell.className = "company-name";
      nameCell.textContent = factionName;
      card.appendChild(nameCell);

      // "Palier actuel" : select toujours modifiable (Auto ou un palier
      // choisi à la main). Choisir un palier ici démarre à son tout début
      // (0%), à affiner ensuite avec le curseur.
      const calibrateSelect = document.createElement("select");
      calibrateSelect.className = "company-calibrate-select";
      const autoOption = document.createElement("option");
      autoOption.value = "";
      autoOption.textContent = t("companyCalibrateAuto");
      calibrateSelect.appendChild(autoOption);
      autoOption.selected = !override;
      standings.forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.name;
        opt.textContent = `${s.name} (${s.minReputation})`;
        // Reflète le palier réellement atteint (calibrage + missions
        // accumulées depuis), pas forcément celui choisi au calibrage initial.
        if (override && currentStanding.name === s.name) opt.selected = true;
        calibrateSelect.appendChild(opt);
      });
      calibrateSelect.addEventListener("change", () => {
        if (calibrateSelect.value) {
          // Déverrouillé au départ : le curseur reste modifiable tant que le
          // joueur n'a pas cliqué le cadenas pour verrouiller sa position.
          const tier = standings.find((s) => s.name === calibrateSelect.value);
          state.reputationOverrides[factionName] = {
            tier: tier.name,
            points: tier.minReputation,
            calibratedAt: Date.now(),
            locked: false,
          };
        } else {
          delete state.reputationOverrides[factionName];
        }
        saveState();
        renderCompaniesTab();
      });
      card.appendChild(calibrateSelect);

      // "Curseur de modification" : affine la position dans le palier
      // actuel. Actif seulement en calibrage manuel (en mode Auto ou au
      // palier maximum, rien à affiner). Le glissement seul ne sauvegarde
      // rien (juste un aperçu en direct) : il faut cliquer "Définir" pour
      // verrouiller la position, comme choisir "Automatique" verrouille le
      // calcul automatique. Graduations 0/25/50/75/100 % affichées sous la
      // barre en plus des repères natifs du curseur.
      const rangeStart = currentStanding.minReputation;
      const rangeEnd = nextStanding ? nextStanding.minReputation : rangeStart;
      const isDisabled = !override || !nextStanding;
      const rawLocked = !!(override && override.locked);
      const isLocked = isDisabled || rawLocked;

      const sliderWrap = document.createElement("div");
      sliderWrap.className = "company-slider-wrap";

      // Barre + graduations empilées dans une colonne dédiée, pour que les
      // chiffres restent alignés sous la barre quel que soit ce qu'il y a à
      // côté (le cadenas, placé après, pas en dessous).
      const sliderCol = document.createElement("div");
      sliderCol.className = "company-slider-col";

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "company-calibrate-slider";
      slider.min = String(rangeStart);
      slider.max = String(rangeEnd);
      slider.value = String(current);
      slider.disabled = isLocked;

      // Pas de graduations natives (datalist) : leurs petits traits ne
      // s'alignaient pas avec nos chiffres cliquables en dessous — un seul
      // repère (les chiffres) plutôt que deux qui se contredisent.
      sliderCol.appendChild(slider);

      const nextCell = document.createElement("span");
      nextCell.className = "company-next-rank";
      const updateNextCell = (value) => {
        nextCell.textContent = nextStanding
          ? t("companyNextRank", { next: nextStanding.name, remaining: rangeEnd - value })
          : t("companyMaxRankLabel");
      };
      updateNextCell(current);

      // Graduations cliquables : place le curseur directement sur ce
      // pourcentage (juste un aperçu, il faut ensuite cliquer le cadenas
      // pour verrouiller la position, comme un glissement classique).
      const scaleLabels = document.createElement("div");
      scaleLabels.className = "company-slider-scale";
      [0, 25, 50, 75, 100].forEach((pct) => {
        const label = document.createElement("button");
        label.type = "button";
        label.className = "company-slider-tick";
        label.textContent = `${pct}`;
        label.disabled = isLocked;
        label.addEventListener("click", () => {
          const value = Math.round(rangeStart + ((rangeEnd - rangeStart) * pct) / 100);
          slider.value = String(value);
          updateNextCell(value);
        });
        scaleLabels.appendChild(label);
      });
      sliderCol.appendChild(scaleLabels);
      sliderWrap.appendChild(sliderCol);

      // Cadenas ouvert (rouge) = curseur modifiable, aperçu seulement.
      // Cadenas fermé (vert) = position verrouillée, la progression suit
      // ensuite automatiquement les missions terminées par-dessus.
      const lockBtn = document.createElement("button");
      lockBtn.type = "button";
      lockBtn.className = "company-lock-btn";
      lockBtn.classList.toggle("locked", rawLocked);
      lockBtn.classList.toggle("unlocked", !rawLocked);
      lockBtn.textContent = rawLocked ? "🔒" : "🔓";
      lockBtn.disabled = isDisabled;
      lockBtn.setAttribute("aria-label", t(rawLocked ? "companyUnlockAria" : "companyLockAria"));
      lockBtn.addEventListener("click", () => {
        if (rawLocked) {
          state.reputationOverrides[factionName] = {
            tier: currentStanding.name,
            points: current,
            calibratedAt: Date.now(),
            locked: false,
          };
        } else {
          state.reputationOverrides[factionName] = {
            tier: currentStanding.name,
            points: Number(slider.value),
            calibratedAt: Date.now(),
            locked: true,
          };
        }
        saveState();
        renderCompaniesTab();
      });
      sliderWrap.appendChild(lockBtn);

      card.appendChild(sliderWrap);
      card.appendChild(nextCell);

      slider.addEventListener("input", () => updateNextCell(Number(slider.value)));

      container.appendChild(card);
    });
}

// Pour un retrait à quantité nulle (corrigée en direct, ex : tout récupéré à
// un seul endroit au lieu de plusieurs comme prévu) : précise où la
// marchandise a réellement été récupérée. Retourne "" si non applicable.
function pickedUpElsewhereNote(item, mission) {
  if ((Number(item.quantity) || 0) > 0) return "";
  const siblings = (mission.cargoItems || []).filter(
    (other) =>
      other !== item &&
      other.commodity === item.commodity &&
      other.dropoffId === item.dropoffId &&
      (Number(other.quantity) || 0) > 0
  );
  if (!siblings.length) return "";
  const locations = siblings.map((s) => locationLabel(getLocationById(s.pickupId))).join(", ");
  return t("cargoAlreadyPickedUpElsewhere", { commodity: item.commodity || "?", locations });
}

// Une ligne de cargaison interactive dans le résultat de trajet : trois
// boutons rapides pour indiquer ce qui a réellement été récupéré/déposé à cet
// arrêt (tout / partiel / rien), comme une feuille de route qu'on coche au
// fil de la mission — plus rapide qu'un champ à taper à chaque fois.
function renderCargoItemRow(item, mission, type) {
  const row = document.createElement("div");
  row.className = "route-cargo-row";

  const label = document.createElement("span");
  label.className = "route-cargo-label";
  label.textContent = t("routeCargoRowLabel", {
    commodity: item.commodity || "?",
    planned: item.plannedQuantity ?? item.quantity,
  });
  row.appendChild(label);

  const planned = Number(item.plannedQuantity) || 0;
  const confirmedField = type === "pickup" ? "pickupConfirmed" : "dropoffConfirmed";

  function applyQuantity(qty) {
    if (!mission.cargoItems[item.index]) return;
    mission.cargoItems[item.index].quantity = qty;
    mission.cargoItems[item.index][confirmedField] = true;
    saveState();
    runOptimize();
  }

  const btnGroup = document.createElement("div");
  btnGroup.className = "route-cargo-btns";

  const partialInput = document.createElement("input");
  partialInput.type = "number";
  partialInput.min = "0";
  partialInput.step = "1";
  partialInput.value = item.quantity;
  partialInput.className = "route-cargo-partial-input";
  // visibility (pas display) : l'espace reste toujours réservé à côté de
  // "Rien", pour que la ligne ne se décale jamais selon l'état du bouton.
  partialInput.style.visibility = "hidden";
  partialInput.addEventListener("change", () => applyQuantity(Number(partialInput.value) || 0));

  const fullBtn = document.createElement("button");
  fullBtn.type = "button";
  fullBtn.className = "route-cargo-btn route-cargo-btn-full";
  fullBtn.textContent = t("routeCargoFullBtn");
  fullBtn.addEventListener("click", () => applyQuantity(planned));

  const partialBtn = document.createElement("button");
  partialBtn.type = "button";
  partialBtn.className = "route-cargo-btn route-cargo-btn-partial";
  partialBtn.textContent = t("routeCargoPartialBtn");
  partialBtn.addEventListener("click", () => {
    partialInput.style.visibility = "visible";
    partialInput.focus();
  });

  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "route-cargo-btn route-cargo-btn-none";
  noneBtn.textContent = t("routeCargoNoneBtn");
  noneBtn.addEventListener("click", () => applyQuantity(0));

  // Met en évidence le bouton qui correspond à la quantité actuellement
  // enregistrée, mais seulement une fois qu'un choix a été fait explicitement
  // (aucun bouton sélectionné par défaut, même si la quantité vaut encore
  // celle prévue à l'origine).
  const current = Number(item.quantity) || 0;
  let state = null;
  if (item[confirmedField]) {
    if (planned > 0 && current === planned) state = "full";
    else if (current === 0) state = "none";
    else state = "partial";
  }
  fullBtn.classList.toggle("active", state === "full");
  partialBtn.classList.toggle("active", state === "partial");
  noneBtn.classList.toggle("active", state === "none");
  if (state === "partial") partialInput.style.visibility = "visible";

  btnGroup.appendChild(fullBtn);
  btnGroup.appendChild(partialBtn);
  btnGroup.appendChild(noneBtn);
  btnGroup.appendChild(partialInput);
  row.appendChild(btnGroup);

  const wrapper = document.createElement("li");
  wrapper.appendChild(row);
  if (type === "pickup") {
    const note = pickedUpElsewhereNote(item, mission);
    if (note) {
      const noteP = document.createElement("div");
      noteP.className = "hint route-cargo-note";
      noteP.textContent = note;
      wrapper.appendChild(noteP);
    }
  }
  return wrapper;
}

function renderRouteResult(result) {
  const container = document.getElementById("route-result");
  container.innerHTML = "";

  if (!result) return;

  const missionTags = result.steps ? buildMissionRouteTags(collectRouteMissionsInOrder(result)) : new Map();

  if (result.error) {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = result.error;
    container.appendChild(p);
    triggerFadeIn(container);
    return;
  }

  if (result.revisited) {
    // Deux cas très différents : le trajet exact (l'ordre EST le meilleur, on
    // explique juste pourquoi on repasse au même endroit) et le repli glouton
    // sur très grosse instance (là seulement, l'ordre n'est pas garanti).
    const p = document.createElement("p");
    p.className = result.approximate ? "hint warning-text" : "hint";
    p.textContent = result.approximate
      ? t("revisitedResultWarning", { allowRevisitsBtn: t("allowRevisitsBtn") })
      : t("revisitedOptimalNote");
    container.appendChild(p);
  } else if (result.approximate) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t("approximateResultNote", { count: result.stopCount });
    container.appendChild(p);
  }

  const totalP = document.createElement("p");
  totalP.className = "route-total";
  totalP.textContent = t("routeTotal", { total: result.total, stops: result.steps.length });
  container.appendChild(totalP);

  const ship = getSelectedShip();
  const capacity = getEffectiveShipCapacity();
  const loadP = document.createElement("p");
  let over = false;
  if (capacity) {
    over = result.maxCargoLoad > capacity;
    loadP.className = over ? "cargo-overload" : "cargo-ok";
    loadP.textContent = over
      ? t("maxLoadOverload", { load: result.maxCargoLoad, scu: capacity, over: roundScu(result.maxCargoLoad - capacity) })
      : t("maxLoadOk", { load: result.maxCargoLoad, scu: capacity });
  } else {
    loadP.className = "hint";
    loadP.textContent = t("maxLoadNoShip", { load: result.maxCargoLoad });
  }
  container.appendChild(loadP);

  if (capacity && over) {
    const culprits = computeOverloadCulprits(result, capacity);
    if (culprits.length) {
      const culpritLabel = document.createElement("p");
      culpritLabel.className = "hint warning-text";
      culpritLabel.textContent = t("routeOverloadCulprits");
      container.appendChild(culpritLabel);

      const culpritList = document.createElement("div");
      culpritList.className = "route-culprits";
      culprits.forEach((mission) => {
        const row = document.createElement("div");
        row.className = "actions-cell";
        const label = document.createElement("span");
        label.textContent = missionRouteLabel(mission, missionTags);
        row.appendChild(label);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-danger-sm";
        btn.textContent = t("deselectAndRecalcBtn");
        btn.addEventListener("click", () => {
          mission.included = false;
          saveState();
          renderMissionsTable();
          runOptimize();
        });
        row.appendChild(btn);
        culpritList.appendChild(row);
      });
      container.appendChild(culpritList);
    }
  }

  const ol = document.createElement("ol");
  ol.className = "route-steps";
  result.steps.forEach((step) => {
    const li = document.createElement("li");
    const loc = getLocationById(step.locId);
    const header = document.createElement("div");
    header.className = "route-step-header";

    // Regroupées dans un même bloc pour former la première colonne de la
    // grille d'en-tête, alignée avec la colonne du libellé de marchandise des
    // lignes de cargaison en dessous (même gabarit de colonnes) — le bouton
    // "Ascenseur HS" se retrouve ainsi dans la seconde colonne, à la même
    // position horizontale que les boutons Tout/Partiel/Rien.
    const infoWrap = document.createElement("span");
    infoWrap.className = "route-step-info";
    infoWrap.textContent = locationLabel(loc);
    if (step.legDistance) {
      const legSpan = document.createElement("span");
      legSpan.className = "route-leg";
      legSpan.textContent = ` (+${step.legDistance} Gm)`;
      infoWrap.appendChild(legSpan);
    }
    const loadSpan = document.createElement("span");
    if (capacity) {
      const overHere = step.cargoLoad > capacity;
      loadSpan.className = overHere ? "route-load route-load-overload" : "route-load";
      loadSpan.textContent = t("onBoardWithShip", { load: step.cargoLoad, scu: capacity });
    } else {
      loadSpan.className = "route-load";
      loadSpan.textContent = t("onBoardNoShip", { load: step.cargoLoad });
    }
    infoWrap.appendChild(loadSpan);
    header.appendChild(infoWrap);

    const elevatorBtn = document.createElement("button");
    elevatorBtn.type = "button";
    elevatorBtn.className = "btn-elevator-hs";
    elevatorBtn.title = t("elevatorHsHint");
    elevatorBtn.textContent = t("elevatorHsBtn");
    elevatorBtn.addEventListener("click", () => toggleElevatorBroken(step.locId));
    header.appendChild(elevatorBtn);

    li.appendChild(header);

    if (step.actions.length) {
      const ul = document.createElement("ul");
      ul.className = "route-actions";
      step.actions.forEach((a) => {
        const actionLi = document.createElement("li");
        actionLi.className = a.type === "pickup" ? "action-pickup" : "action-dropoff";
        actionLi.textContent = `${a.type === "pickup" ? t("pickupAction") : t("dropoffAction")} — ${missionRouteLabel(a.mission, missionTags)}`;

        const items = a.items || [];
        if (items.length) {
          const itemsUl = document.createElement("ul");
          itemsUl.className = "route-cargo-items";
          items.forEach((item) => {
            itemsUl.appendChild(renderCargoItemRow(item, a.mission, a.type));
          });
          actionLi.appendChild(itemsUl);
        }

        ul.appendChild(actionLi);
      });
      li.appendChild(ul);
    }
    ol.appendChild(li);
  });
  container.appendChild(ol);

  // Centre chaque bouton "Ascenseur HS" sur le groupe Tout/Partiel/Rien des
  // lignes de cargaison en dessous : on compare directement le centre réel
  // des deux (getBoundingClientRect) et on translate le bouton de l'écart
  // constaté, plutôt que de supposer une position CSS particulière (centré,
  // à droite...) pour le groupe — reste juste quelle que soit cette position
  // ou la largeur des libellés Tout/Partiel/Rien (donc aussi en anglais).
  const sampleBtnGroup = container.querySelector(".route-cargo-btns");
  if (sampleBtnGroup) {
    const groupRect = sampleBtnGroup.getBoundingClientRect();
    const groupCenter = groupRect.left + groupRect.width / 2;
    container.querySelectorAll(".btn-elevator-hs").forEach((btn) => {
      btn.style.transform = "";
      const btnRect = btn.getBoundingClientRect();
      const btnCenter = btnRect.left + btnRect.width / 2;
      btn.style.transform = `translateX(${groupCenter - btnCenter}px)`;
    });
  }

  triggerFadeIn(container);
}

// Le champ de saisie libre (n'importe quel lieu connu, même s'il n'est le
// ramassage/dépôt d'aucune mission en cours) prend le pas sur le menu
// déroulant quand il est rempli et reconnu ; sinon on retombe sur le menu
// (donc sur "Libre" si les deux sont vides).
function resolveStartLocationId() {
  const customText = document.getElementById("start-location-custom").value.trim();
  if (customText) {
    const loc = findLocationByLabel(customText);
    if (loc) return loc.id;
  }
  return document.getElementById("start-location").value || null;
}

function runOptimize() {
  const startId = resolveStartLocationId();
  const included = activeMissions().filter((m) => m.included);
  const allowRevisits = document.getElementById("allow-revisits-btn").classList.contains("active");
  const result = optimizeRoute(included, startId, brokenElevatorLocationIds, allowRevisits);
  // Gardé de côté pour l'onglet Optimisation du cargo (voir
  // buildCargoItemStopIndex) : le rangement a besoin de savoir à quel arrêt
  // chaque marchandise est récupérée/livrée, pas juste sa quantité totale.
  lastRouteResult = result.error ? null : result;
  renderRouteResult(result);
}

// Repère, pour chaque ligne de cargaison de chaque mission, l'index de
// l'arrêt (dans le dernier trajet optimisé calculé) où elle est récupérée et
// celui où elle est livrée — nécessaire pour que le rangement du cargo (voir
// js/cargo-packing.js:simulateRoutePacking) sache dans quel ordre charger et
// décharger, au lieu de tout tasser ensemble sans notion de temps. Clé par
// mission+index de ligne plutôt que par lieu seul : un même lieu peut
// apparaître à plusieurs arrêts si les revisites sont autorisées.
function buildCargoItemStopIndex(routeResult) {
  const stopIndex = new Map();
  routeResult.steps.forEach((step, stepIdx) => {
    step.actions.forEach((action) => {
      action.items.forEach((item) => {
        const key = `${action.mission.id}:${item.index}`;
        const entry = stopIndex.get(key) || {};
        if (action.type === "pickup") entry.pickupStop = stepIdx;
        else entry.dropoffStop = stepIdx;
        stopIndex.set(key, entry);
      });
    });
  });
  return stopIndex;
}

// Rassemble une entrée à ranger par ligne de cargaison usable des missions
// incluses (cochées), avec assez de contexte (mission, commodité) pour la
// légende, et l'arrêt de récupération/livraison (voir buildCargoItemStopIndex)
// pour que le rangement respecte l'ordre réel du trajet plutôt que de tout
// tasser ensemble sans notion de temps.
function gatherCargoEntriesForPacking(stopIndex) {
  const entries = [];
  activeMissions()
    .filter((m) => m.included)
    .forEach((m) => {
      (m.cargoItems || []).forEach((item, index) => {
        const qty = Number(item.quantity) || 0;
        if (qty <= 0) return;
        const stops = stopIndex.get(`${m.id}:${index}`) || {};
        entries.push({
          quantity: qty,
          commodity: item.commodity || "?",
          mission: m,
          // Priorité à la taille saisie sur cette ligne de marchandise ; à
          // défaut, repli sur la taille globale du contrat (import OCR, voir
          // mission.maxCargoBoxSize plus haut).
          maxCargoBoxSize: item.maxCargoBoxSize || m.maxCargoBoxSize || null,
          pickupId: item.pickupId,
          dropoffId: item.dropoffId,
          pickupStop: stops.pickupStop ?? null,
          dropoffStop: stops.dropoffStop ?? null,
        });
      });
    });
  return entries;
}

// État du dernier rangement calculé (voir runCargoPacking), pour naviguer
// d'un arrêt à l'autre (voir cargo-step-prev/next) sans tout recalculer :
// la vue 3D et le plan texte affichent toujours le même arrêt, dans une
// seule fenêtre plutôt que deux blocs déconnectés (instantané figé +
// longue liste séparée).
let cargoPackState = null;

// Pastille de couleur assortie à la caisse dans la vue 3D (voir
// js/cargo-viewer.js:missionColorCss) : sans ça, rien ne relie visuellement
// une couleur à sa mission pour le joueur.
function addCargoColorSwatch(li, missionId) {
  const swatch = document.createElement("span");
  swatch.className = "cargo-color-swatch";
  swatch.style.background = typeof missionColorCss === "function" ? missionColorCss(missionId) : "#888";
  li.appendChild(swatch);
}

// Affiche l'arrêt courant (cargoPackState.stepIndex) : titre + plan texte de
// ce seul arrêt (récupérations/livraisons, avec un avertissement inline en
// cas de conflit — voir js/cargo-packing.js:simulateRoutePacking) et la vue
// 3D correspondante (seules les caisses effectivement à bord à cet instant),
// pour que le texte et le rendu 3D restent toujours synchronisés sur le même
// moment du trajet.
function renderCargoStepView() {
  const viewerPanel = document.getElementById("cargo-viewer-panel");
  const nav = document.getElementById("cargo-step-nav");
  const titleEl = document.getElementById("cargo-step-title");
  const actionsEl = document.getElementById("cargo-step-actions");
  const prevBtn = document.getElementById("cargo-step-prev");
  const nextBtn = document.getElementById("cargo-step-next");

  if (!cargoPackState) {
    // Pas de rangement calculé : on masque toute la visionneuse (boîte 3D
    // vide + boutons de vue + navigation d'étape) plutôt que de laisser un
    // grand rectangle vide occuper de la place et forcer un défilement pour
    // rien — elle réapparaît dès qu'un rangement existe.
    viewerPanel.style.display = "none";
    nav.style.display = "none";
    return;
  }
  viewerPanel.style.display = "";
  nav.style.display = "flex";

  const { holds, routeResult, result, stepIndex } = cargoPackState;
  const step = routeResult.steps[stepIndex];
  const loc = getLocationById(step.locId);
  titleEl.textContent = t("cargoStepLabelWithTotal", {
    index: stepIndex + 1,
    total: routeResult.steps.length,
    location: loc ? locationLabel(loc) : "?",
  });

  // Même désambiguïsation que la liste des étapes de trajet (voir
  // renderRouteResult) : plusieurs contrats peuvent partager le même nom
  // affiché ("Mission N", noms OCR incomplets...), on ajoute alors un
  // repère "x/y" pour les distinguer, sinon le joueur ne peut pas savoir
  // laquelle des deux missions de même nom correspond à quelle caisse.
  const missionTags = buildMissionRouteTags(collectRouteMissionsInOrder(routeResult));

  const conflictByBox = new Map();
  result.conflicts.forEach((c) => conflictByBox.set(c.box, c));

  actionsEl.innerHTML = "";
  const pickups = result.placements.filter((p) => p.pickupStop === stepIndex);
  const dropoffs = result.placements.filter((p) => p.dropoffStop === stepIndex);

  pickups.forEach((p) => {
    const li = document.createElement("li");
    addCargoColorSwatch(li, p.entry.mission.id);
    li.appendChild(
      document.createTextNode(
        t("cargoStepPickupLine", {
          scu: p.box.scu,
          commodity: p.entry.commodity,
          mission: missionRouteLabel(p.entry.mission, missionTags),
          module: p.module.name,
        })
      )
    );
    actionsEl.appendChild(li);
  });
  dropoffs.forEach((p) => {
    const li = document.createElement("li");
    addCargoColorSwatch(li, p.entry.mission.id);
    let text = t("cargoStepDropoffLine", {
      scu: p.box.scu,
      commodity: p.entry.commodity,
      mission: missionRouteLabel(p.entry.mission, missionTags),
      module: p.module.name,
    });
    const conflict = conflictByBox.get(p.box);
    if (conflict) {
      li.classList.add("warning-text");
      const blockers = conflict.blockedBy.map((e) => missionRouteLabel(e.mission, missionTags)).join(", ");
      text += " " + t("cargoConflictNote", { blockers: blockers || "?" });
    }
    li.appendChild(document.createTextNode(text));
    actionsEl.appendChild(li);
  });
  if (!pickups.length && !dropoffs.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = t("cargoStepNothing");
    actionsEl.appendChild(li);
  }

  prevBtn.disabled = stepIndex <= 0;
  nextBtn.disabled = stepIndex >= routeResult.steps.length - 1;

  // dropoffStop >= stepIndex (pas > ) : une caisse reste visible sur la
  // grille PENDANT l'étape où on la décharge (le texte de l'étape dit déjà
  // "Décharger X" à ce même stepIndex, voir dropoffs ci-dessus) — elle ne
  // doit disparaître qu'à l'étape SUIVANTE. Avec >, elle disparaissait dès
  // l'arrivée à l'étape de déchargement, obligeant à revenir en arrière
  // pour la voir encore sur la grille.
  const present = result.placements.filter((p) => p.pickupStop <= stepIndex && p.dropoffStop >= stepIndex);
  const shipName = getCargoViewerShipName();
  // Priorité : grille publiée (positions exactes) > disposition perso
  // (surcharge partielle) > reconstruction auto. Une grille publiée fait
  // autorité et remplace le placement perso du joueur.
  const publishedGrid = shipName ? state.approvedShipGrids[shipName] : null;
  // Porte de sortie (brique 2b) : le joueur a demandé à corriger la grille
  // publiée de ce vaisseau. Sa disposition perso (amorcée depuis la publiée par
  // proposeCorrection) reprend alors la main et l'édition redevient possible —
  // LOCALEMENT à lui, tant que le mainteneur n'a rien validé.
  const unlocked = !!(shipName && state.cargoViewerUnlocked[shipName]);
  const usePublished = !!publishedGrid && !unlocked;
  const publishedPositions = usePublished && shipName ? getPublishedGridPositions(shipName) : null;
  const orientation = usePublished ? publishedGrid.orientation : shipName ? getCargoViewerOrientation(shipName) : 0;
  const mirror = usePublished ? publishedGrid.mirror : shipName ? getCargoViewerMirror(shipName) : false;
  const savedLayout = publishedPositions || (shipName ? getCargoViewerLayout(shipName) : {});
  // Vaisseau avec grille publiée : elle fait autorité, on masque les
  // contrôles de placement perso pour un joueur normal (l'admin garde son
  // propre éditeur, voir enterAdminGridEdit). Le vrai garde-fou reste la RLS
  // côté base — masquer un bouton n'est pas une sécurité.
  const locked = usePublished && !isAdminUser;
  const editBtn = document.getElementById("cargo-viewer-edit-btn");
  const publishedNote = document.getElementById("cargo-published-note");
  if (editBtn) editBtn.style.display = locked ? "none" : "";
  // « Réserver un emplacement » : dispo dès qu'une grille est affichée, MÊME sur
  // une grille publiée (la réservation est perso, pas une modif de la grille).
  const resBtn = document.getElementById("reservation-edit-btn");
  if (resBtn) resBtn.style.display = holds && holds.length ? "" : "none";
  // Propositions (brique 2b) : il faut être connecté (l'insert exige auth.uid()).
  const connected = typeof cloudUserId !== "undefined" && !!cloudUserId;
  const correctionBtn = document.getElementById("propose-correction-btn");
  // « Proposer » dépend aussi de modifications réelles : voir updateProposeButton,
  // appelé ici ET après chaque glisser (sans re-rendre toute la scène 3D).
  updateProposeButton();
  // « Corriger cette disposition » : seule porte de sortie d'une grille publiée.
  // NE demande PAS d'être connecté : déverrouiller est purement LOCAL (la
  // disposition perso du joueur). Exiger un compte enfermait un joueur
  // déconnecté sur un vaisseau à grille publiée — ni « Éditer », ni porte de
  // sortie, aucun moyen d'ajuster sa propre vue. Seul l'ENVOI d'une proposition
  // exige un compte (voir #propose-layout-btn ci-dessus).
  if (correctionBtn)
    correctionBtn.style.display = publishedGrid && !unlocked && !isAdminUser ? "" : "none";
  if (publishedNote) publishedNote.style.display = usePublished ? "" : "none";
  document.getElementById("cargo-viewer-rotate-btn").style.display = locked ? "none" : "";
  document.getElementById("cargo-viewer-mirror-btn").style.display = locked ? "none" : "";
  if (typeof renderCargoViewer3D === "function")
    renderCargoViewer3D(holds, present, orientation, mirror, savedLayout);
}

// Soutes du vaisseau : grille publiée (Supabase) d'abord, FleetYards ensuite.
// C'est ICI que se fait le détachement — un vaisseau publié n'utilise plus du
// tout les données FleetYards. On ne branche pas ça dans js/fleetyards.js :
// ce fichier ne parle que de FleetYards, y mêler Supabase brouillerait une
// frontière nette.
function getShipHolds(shipName) {
  const published = shipName && state.approvedShipGrids[shipName];
  if (published && Array.isArray(published.grid) && published.grid.length) {
    return published.grid.map((m) => ({
      name: m.name,
      dimensions: m.dimensions,
      capacity: m.capacity,
      maxContainerSize: m.maxContainerSize,
    }));
  }
  return typeof getShipCargoHolds === "function" ? getShipCargoHolds(shipName) : null;
}

// Positions exactes d'une grille publiée, sous la forme attendue par la
// surcharge du visualiseur ({ [nom de module]: {x,y,z} }). Une grille publiée
// porte une position pour CHAQUE module : la reconstruction automatique est
// alors entièrement remplacée, le visualiseur ne devine plus rien.
function getPublishedGridPositions(shipName) {
  const published = shipName && state.approvedShipGrids[shipName];
  if (!published || !Array.isArray(published.grid)) return null;
  const byName = {};
  published.grid.forEach((m) => {
    if (m.position) byName[m.name] = { x: m.position.x, y: m.position.y, z: m.position.z };
  });
  return byName;
}

// =========================================================================
// Éditeur de grille (admin) — voir
// docs/superpowers/specs/2026-07-17-admin-grid-editor-design.md
// On édite LE VAISSEAU, pas la cargaison : l'éditeur s'ouvre sans qu'aucun
// rangement n'existe (un vaisseau inconnu de FleetYards n'a rien à ranger),
// donc il force l'affichage du visualiseur et y rend son brouillon.
// =========================================================================
const ADMIN_GRID_MAX_BOX_SIZES = [1, 2, 4, 8, 16, 24, 32];

let adminGridDraft = null; // [{ name, dimensions, capacity, maxContainerSize, position }]
let adminGridShipName = null;
let adminGridSelected = null; // le nom du module sélectionné
let adminGridMoveAll = false; // mode « tout déplacer » (voir toggleAdminGridMoveAll)

// La capacité n'est JAMAIS saisie : c'est le volume en cellules SCU.
// Vérifié sur les 284 soutes FleetYards, 284/284 sans exception.
function capacityFromDimensions(dims) {
  return Math.round((dims.x / UNIT_M) * (dims.y / UNIT_M) * (dims.z / UNIT_M));
}

function renderAdminGridEditor() {
  const panel = document.getElementById("cargo-viewer-panel");
  const nav = document.getElementById("cargo-step-nav");
  const adminPanel = document.getElementById("admin-grid-panel");
  if (!adminGridDraft) {
    adminPanel.style.display = "none";
    return;
  }
  panel.style.display = "";
  nav.style.display = "none";
  adminPanel.style.display = "";
  document.getElementById("cargo-published-note").style.display = "none";

  const holds = adminGridDraft.map((m) => ({
    name: m.name,
    dimensions: m.dimensions,
    capacity: m.capacity,
    maxContainerSize: m.maxContainerSize,
  }));
  const positions = {};
  adminGridDraft.forEach((m) => (positions[m.name] = { x: m.position.x, y: m.position.y, z: m.position.z }));
  // Orientation/miroir RÉELS (ceux que publishShipGrid enverra), pas 0/false :
  // l'admin doit voir la même étiquette Avant/Arrière/Gauche/Droite que celle
  // qu'il publie, sinon il place ses modules contre un repère qu'il ne
  // publie pas — voir revue finale 2a, finding B. Ça ne déplace rien (voir
  // updateCargoViewerOrientation) : seul l'étiquetage change.
  const orientation = adminGridShipName ? getCargoViewerOrientation(adminGridShipName) : 0;
  const mirror = adminGridShipName ? getCargoViewerMirror(adminGridShipName) : false;
  // Aucune caisse : on place des grilles, pas de la cargaison.
  if (typeof renderCargoViewer3D === "function") renderCargoViewer3D(holds, [], orientation, mirror, positions);

  renderAdminGridSelection();
}

function renderAdminGridSelection() {
  const box = document.getElementById("admin-grid-selected");
  const mod = adminGridDraft && adminGridDraft.find((m) => m.name === adminGridSelected);
  // « Pivoter » vit dans la barre principale (toujours visible) mais agit sur
  // le module SÉLECTIONNÉ : sans sélection il serait un clic sans effet, donc
  // on le grise plutôt que de le laisser mentir.
  const rotate = document.getElementById("admin-grid-rotate-btn");
  if (rotate) rotate.disabled = !mod;
  if (!mod) {
    box.style.display = "none";
    return;
  }
  box.style.display = "";
  document.getElementById("admin-grid-selected-name").textContent = mod.name;
  document.getElementById("admin-grid-cx").value = Math.round(mod.dimensions.x / UNIT_M);
  document.getElementById("admin-grid-cy").value = Math.round(mod.dimensions.y / UNIT_M);
  document.getElementById("admin-grid-cz").value = Math.round(mod.dimensions.z / UNIT_M);
  const sel = document.getElementById("admin-grid-mcs");
  sel.value = String(mod.maxContainerSize);
  document.getElementById("admin-grid-capacity").textContent = t("adminGridCapacity", { scu: mod.capacity });
}

function applyAdminGridSize() {
  const mod = adminGridDraft && adminGridDraft.find((m) => m.name === adminGridSelected);
  if (!mod) return;
  const cx = Math.max(1, Number(document.getElementById("admin-grid-cx").value) || 1);
  const cy = Math.max(1, Number(document.getElementById("admin-grid-cy").value) || 1);
  const cz = Math.max(1, Number(document.getElementById("admin-grid-cz").value) || 1);
  mod.dimensions = { x: cx * UNIT_M, y: cy * UNIT_M, z: cz * UNIT_M };
  mod.capacity = capacityFromDimensions(mod.dimensions);
  mod.maxContainerSize = Number(document.getElementById("admin-grid-mcs").value) || 1;
  renderAdminGridEditor();
}

// Câble un écouteur en tolérant un élément absent — voir le commentaire au
// point d'appel (index.html périmé + app.js neuf : un getElementById null tuait
// toute la fin de l'init).
function bindEvent(id, event, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler);
}

// Pivoter un module de 90° autour de la VERTICALE. Sur une grille alignée sur
// des cellules cubiques, cette rotation est exactement l'échange de X et Y —
// il n'y a donc rien à faire tourner : on échange les deux champs et on repasse
// par applyAdminGridSize, qui dérive déjà les dimensions, la capacité (qui ne
// bouge pas : même volume) et le rendu. La position n'est pas touchée, le
// module pivote donc sur place, coin conservé.
// Une rotation LIBRE (45°…) est impossible par construction : cargo-packing.js
// travaille en cellules entières alignées sur les axes. Ce n'est pas une limite
// de l'éditeur. Voir spec 2a §155 (rotation d'un module : hors périmètre à
// l'origine, rouverte à l'usage).
function rotateAdminGridModule() {
  const cx = document.getElementById("admin-grid-cx");
  const cy = document.getElementById("admin-grid-cy");
  const swap = cx.value;
  cx.value = cy.value;
  cy.value = swap;
  applyAdminGridSize();
}

// Bascule le mode « tout déplacer » : quand il est actif, un glisser dans la
// vue 3D translate TOUTES les grilles ensemble (voir setCargoLayoutMoveAll dans
// js/cargo-viewer.js), pour recaler l'ensemble d'un bloc sans bouger chaque
// grille une par une. Le bouton reflète l'état (libellé + classe active).
function setAdminGridMoveAll(on) {
  adminGridMoveAll = !!on;
  if (typeof setCargoLayoutMoveAll === "function") setCargoLayoutMoveAll(adminGridMoveAll);
  const btn = document.getElementById("admin-grid-moveall-btn");
  if (btn) {
    btn.textContent = t(adminGridMoveAll ? "adminGridMoveAllBtnActive" : "adminGridMoveAllBtn");
    btn.classList.toggle("btn-primary", adminGridMoveAll);
    btn.classList.toggle("btn-secondary", !adminGridMoveAll);
  }
}

function toggleAdminGridMoveAll() {
  setAdminGridMoveAll(!adminGridMoveAll);
}

function enterAdminGridEdit() {
  const ship = getSelectedShip();
  if (!ship) return;
  adminGridShipName = ship.name;
  adminGridSelected = null;

  // Amorçage : grille publiée > soutes FleetYards résolues > vide.
  const published = state.approvedShipGrids[ship.name];
  if (published && Array.isArray(published.grid) && published.grid.length) {
    adminGridDraft = JSON.parse(JSON.stringify(published.grid));
  } else {
    const holds = getShipHolds(ship.name) || [];
    // Rendu d'abord pour obtenir les positions résolues de la reconstruction
    // automatique (la disposition perso est partielle et ne les contient pas).
    if (holds.length && typeof renderCargoViewer3D === "function") {
      document.getElementById("cargo-viewer-panel").style.display = "";
      // Même orientation/miroir réels qu'en (2) : la reconstruction auto ne
      // dépend pas de l'orientation (relabel seulement), mais autant que ce
      // premier rendu affiche déjà les bonnes étiquettes avant que
      // renderAdminGridEditor() ne prenne le relais juste après.
      renderCargoViewer3D(
        holds,
        [],
        getCargoViewerOrientation(ship.name),
        getCargoViewerMirror(ship.name),
        getCargoViewerLayout(ship.name)
      );
      adminGridDraft = typeof getResolvedCargoGrid === "function" ? getResolvedCargoGrid() : [];
    } else {
      adminGridDraft = [];
    }
  }

  document.getElementById("admin-grid-edit-btn").style.display = "none";
  if (typeof setCargoLayoutEditing === "function") setCargoLayoutEditing(true);
  setAdminGridMoveAll(false); // toujours repartir en mode « une grille »
  setAdminGridEditUI(true);
  // « Ranger le cargo » écrase la scène 3D (grille FleetYards + caisses) et
  // referait passer tout glisser suivant pour une position de brouillon
  // admin issue d'un rendu qui n'est pas le sien — voir revue finale 2a,
  // finding #5. Réactivé dans exitAdminGridEdit.
  document.getElementById("pack-cargo-btn").disabled = true;
  renderAdminGridEditor();
}

function exitAdminGridEdit() {
  setAdminGridMoveAll(false);
  adminGridDraft = null;
  adminGridShipName = null;
  adminGridSelected = null;
  document.getElementById("admin-grid-panel").style.display = "none";
  if (typeof setCargoLayoutEditing === "function") setCargoLayoutEditing(false);
  setAdminGridEditUI(false);
  document.getElementById("pack-cargo-btn").disabled = false;
  renderCargoStepView();
  renderAdminGridEntry();
}

// Le bouton d'entrée n'apparaît que pour un admin, avec un vaisseau choisi.
function renderAdminGridEntry() {
  const btn = document.getElementById("admin-grid-edit-btn");
  if (!btn) return;
  btn.style.display = isAdminUser && getSelectedShip() && !adminGridDraft ? "" : "none";
}

function addAdminGridModule() {
  if (!adminGridDraft) return;
  let i = 1;
  let name = `grid_${i}`;
  while (adminGridDraft.some((m) => m.name === name)) name = `grid_${++i}`;
  const dims = { x: UNIT_M, y: UNIT_M, z: UNIT_M };
  adminGridDraft.push({
    name,
    dimensions: dims,
    capacity: capacityFromDimensions(dims),
    maxContainerSize: 1,
    position: { x: 0, y: 0, z: 0 },
  });
  adminGridSelected = name;
  renderAdminGridEditor();
}

function removeAdminGridModule() {
  if (!adminGridDraft || !adminGridSelected) {
    showToast(t("adminGridSelectFirst"), "error");
    return;
  }
  adminGridDraft = adminGridDraft.filter((m) => m.name !== adminGridSelected);
  adminGridSelected = null;
  renderAdminGridEditor();
}

async function publishAdminGrid() {
  if (!adminGridDraft || !adminGridShipName) return;
  if (!adminGridDraft.length) {
    showToast(t("adminGridEmpty"), "error");
    return;
  }
  const confirmed = await confirmDialog({
    message: t("adminGridPublishConfirm", { ship: adminGridShipName }),
    confirmLabel: t("adminGridPublishConfirmBtn"),
  });
  if (!confirmed) return;
  // Décision du mainteneur (revue finale 2a, finding #6) : on publie
  // l'orientation/miroir RÉELS du vaisseau — ceux que l'admin a réglés avec
  // Tourner/Miroir avant d'ouvrir l'éditeur — et non 0/false en dur. C'est ce
  // qu'exige le spec §117 (« Orientation/miroir : ceux de la grille publiée
  // s'appliquent ») et ce qui rend les colonnes orientation/mirror de
  // ship_layouts autre chose que des colonnes mortes. L'éditeur lui-même
  // n'expose pas Tourner/Miroir (hors scope) : on republie donc ce qui était
  // déjà réglé sur ce vaisseau, ce qui permet aussi de corriger un mauvais
  // étiquetage en republiant après avoir tourné/miroité.
  const orientation = getCargoViewerOrientation(adminGridShipName);
  const mirror = getCargoViewerMirror(adminGridShipName);
  const ok = await publishShipGrid(adminGridShipName, adminGridDraft, orientation, mirror);
  if (!ok) return;
  // Reflète tout de suite le résultat sans attendre la prochaine synchro —
  // mêmes valeurs que celles envoyées, pas 0/false.
  state.approvedShipGrids[adminGridShipName] = { grid: adminGridDraft, orientation, mirror };
  saveState();
  showToast(t("adminGridPublished", { ship: adminGridShipName }), "success");
  exitAdminGridEdit();
}

// Calcule et affiche le rangement des marchandises des missions incluses
// dans les vraies soutes du vaisseau sélectionné (données FleetYards.net,
// voir js/fleetyards.js), en respectant l'ordre réel de récupération/
// livraison du dernier trajet optimisé (voir js/cargo-packing.js) : une
// seule fenêtre naviguable arrêt par arrêt (voir renderCargoStepView),
// démarrant sur le premier arrêt du trajet.
function runCargoPacking() {
  // Garde-fou en plus de la désactivation du bouton (voir enterAdminGridEdit) :
  // un rangement pendant l'édition admin écraserait la scène du brouillon.
  if (adminGridDraft) return;
  const status = document.getElementById("cargo-pack-status");
  status.className = "hint";
  cargoPackState = null;

  const ship = getSelectedShip();
  if (!ship) {
    status.textContent = t("cargoPackNoShip");
    if (typeof clearCargoViewer3D === "function") clearCargoViewer3D();
    renderCargoStepView();
    return;
  }

  const holds = getShipHolds(ship.name);
  if (!holds || !holds.length) {
    status.textContent = t("cargoPackNoData");
    if (typeof clearCargoViewer3D === "function") clearCargoViewer3D();
    renderCargoStepView();
    return;
  }

  if (!lastRouteResult) {
    status.textContent = t("cargoPackNoRoute");
    if (typeof clearCargoViewer3D === "function") clearCargoViewer3D();
    renderCargoStepView();
    return;
  }

  const stopIndex = buildCargoItemStopIndex(lastRouteResult);
  const allEntries = gatherCargoEntriesForPacking(stopIndex);
  const entries = allEntries.filter((e) => e.pickupStop != null && e.dropoffStop != null);
  if (!entries.length) {
    status.textContent = t("cargoPackNoCargo");
    if (typeof clearCargoViewer3D === "function") clearCargoViewer3D();
    renderCargoStepView();
    return;
  }

  const result = simulateRoutePacking(entries, holds, lastRouteResult.steps.length, getShipAccessFaces(ship.name), getShipReservations(ship.name));
  cargoPackState = { holds, routeResult: lastRouteResult, result, stepIndex: 0, shipName: ship.name };
  renderCargoPackStatus();
  renderCargoStepView();
}

// Résumé texte du rangement (« X caisses rangées, tout rentre... ») recalculé
// depuis cargoPackState.result — extrait de runCargoPacking pour pouvoir être
// rejoué seul, notamment au changement de langue (le texte est cuit avec t()
// au moment du rendu, comme les étiquettes 3D). No-op si aucun rangement.
function renderCargoPackStatus() {
  const status = document.getElementById("cargo-pack-status");
  if (!status || !cargoPackState) return;
  const { result } = cargoPackState;
  const placedCount = result.placements.length;
  const totalCount = placedCount + result.unplaced.length;
  if (result.unplaced.length) {
    status.className = "hint warning-text";
    status.textContent = t("cargoPackSummary", { placed: placedCount, total: totalCount, unplaced: result.unplaced.length });
  } else if (result.conflicts.length) {
    status.className = "hint warning-text";
    status.textContent = t("cargoPackConflictSummary", { placed: placedCount, conflicts: result.conflicts.length });
  } else {
    status.className = "hint";
    status.textContent = t("cargoPackAllPlaced", { placed: placedCount });
  }
}

function renderAll() {
  refreshAllLocationSelects();
  renderShipOptions();
  renderShipCapacity();
  renderShipAccessFaces();
  renderMissionsTable();
  renderHistoryTable();
  renderCompaniesTab();
  renderBrokenElevatorsList();
  renderAdminGridEntry();
  document.getElementById("route-result").innerHTML = "";
}

// =========================================================================
// Champs dynamiques (une ligne par marchandise, avec son propre lieu de
// récupération et de dépôt)
// =========================================================================
function createLocationSubInput(row, className, placeholder, value) {
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("list", "locations-datalist");
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.className = className;
  if (value) input.value = value;
  row.appendChild(input);
  return input;
}

function createCargoFieldRow(commodity, quantity, pickupText, dropoffText, boxSize) {
  const container = document.getElementById("cargo-fields");
  const row = document.createElement("div");
  row.className = "field-row cargo-field-row";

  const commodityInput = document.createElement("input");
  commodityInput.type = "text";
  commodityInput.setAttribute("list", "commodities-datalist");
  commodityInput.placeholder = t("cargoCommodityPlaceholder");
  commodityInput.autocomplete = "off";
  commodityInput.className = "cargo-commodity-input";
  if (commodity) commodityInput.value = commodity;
  row.appendChild(commodityInput);

  const quantityInput = document.createElement("input");
  quantityInput.type = "number";
  quantityInput.min = "0";
  quantityInput.step = "any";
  quantityInput.placeholder = t("cargoScuPlaceholder");
  quantityInput.className = "cargo-quantity-input";
  if (quantity) quantityInput.value = quantity;
  row.appendChild(quantityInput);

  // Taille de caisse (SCU) annoncée pour cette marchandise, si connue —
  // reprend les formats réels de SCU_BOX_SIZES (js/cargo-packing.js) plutôt
  // qu'une liste devinée. Laissé vide par défaut ("Taille libre") : le
  // rangement se rabat alors sur mission.maxCargoBoxSize (import OCR) ou sur
  // le plus grand format que le vaisseau accepte (voir
  // gatherCargoEntriesForPacking).
  const boxSizeSelect = document.createElement("select");
  boxSizeSelect.className = "cargo-boxsize-input";
  const anyOption = document.createElement("option");
  anyOption.value = "";
  anyOption.textContent = t("cargoBoxSizeAnyOption");
  boxSizeSelect.appendChild(anyOption);
  SCU_BOX_SIZES.map((b) => b.scu)
    .sort((a, b) => a - b)
    .forEach((scu) => {
      const opt = document.createElement("option");
      opt.value = String(scu);
      opt.textContent = `${scu} SCU`;
      boxSizeSelect.appendChild(opt);
    });
  if (boxSize) boxSizeSelect.value = String(boxSize);
  row.appendChild(boxSizeSelect);

  createLocationSubInput(row, "cargo-pickup-input", t("cargoPickupPlaceholder"), pickupText);
  createLocationSubInput(row, "cargo-dropoff-input", t("cargoDropoffPlaceholder"), dropoffText);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-remove-field";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (container.children.length === 0) createCargoFieldRow();
  });
  row.appendChild(removeBtn);

  container.appendChild(row);
  return row;
}

function resetCargoFields() {
  const container = document.getElementById("cargo-fields");
  container.innerHTML = "";
  createCargoFieldRow();
}

function getCargoFieldValues() {
  const container = document.getElementById("cargo-fields");
  return Array.from(container.querySelectorAll(".cargo-field-row"))
    .map((row) => ({
      commodity: row.querySelector(".cargo-commodity-input").value.trim(),
      quantity: row.querySelector(".cargo-quantity-input").value,
      boxSize: row.querySelector(".cargo-boxsize-input").value,
      pickupText: row.querySelector(".cargo-pickup-input").value.trim(),
      dropoffText: row.querySelector(".cargo-dropoff-input").value.trim(),
    }))
    .filter(
      (item) =>
        item.commodity !== "" || item.quantity !== "" || item.pickupText !== "" || item.dropoffText !== ""
    );
}

// =========================================================================
// Import OCR (capture d'écran du contrat en jeu)
// =========================================================================

// Distance d'édition (Levenshtein) pour rattraper les petites variantes de
// nom (ex : "CRU-L4 Shallow Field Station" lu par l'OCR contre "CRU-L4
// Shallow Fields Station" dans la base) qu'une simple recherche de
// sous-chaîne ne peut pas détecter quand la différence est au milieu du nom.
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function fuzzyLocationMatch(cleaned) {
  const lower = cleaned.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  allLocations().forEach((loc) => {
    const dist = levenshteinDistance(lower, loc.name.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = loc;
    }
  });
  if (!best) return null;
  const threshold = Math.max(3, Math.round(best.name.length * 0.15));
  return bestDist <= threshold ? best : null;
}

// Certains types de lieu génériques se traduisent en français avec le mot
// descriptif placé en PRÉFIXE (ex : "Centre de travail Sakura Sun
// Goldenrod", "Avant-poste de Recherche Rayari Anvik"), alors que le nom
// anglais du catalogue (UEX ou Star Citizen Wiki) le place en SUFFIXE
// ("Sakura Sun Goldenrod Workcenter", "Rayari Anvik Research Outpost") :
// cet écart de structure n'est rattrapable ni par correspondance exacte/
// substring, ni par distance d'édition (les lettres ne sont pas dans le
// même ordre). Repéré au fil des captures d'écran plutôt que par un alias
// figé, pour couvrir tout nom propre suivant ce même gabarit.
const FRENCH_LOCATION_TYPE_PREFIXES = [
  { prefix: "avant-poste de recherche", suffix: "Research Outpost" },
  { prefix: "centre de travail", suffix: "Workcenter" },
  { prefix: "dépôt logistique", suffix: "Logistics Depot" },
  { prefix: "centre de distribution", suffix: "Distribution Centre" },
  { prefix: "centre industriel de fabrication", suffix: "Industrial Manufacturing Facility" },
  // Forme courte des stations de Lagrange (ex : "Station Green Glade"), sans
  // la description complète du point de Lagrange (voir
  // reorderFrenchLagrangeStation ci-dessous pour la forme longue) — le nom
  // catalogue ("HUR-L1 Green Glade Station") contient "Green Glade Station"
  // comme sous-chaîne une fois réordonné, donc pas besoin de reconstruire
  // l'abréviation de planète ici.
  { prefix: "station", suffix: "Station" },
];

// Renvoie un ou deux réordonnancements candidats : certains lieux ont un
// code alphanumérique final qui reste en dernière position dans les deux
// langues (ex : "Centre de distribution Covalex S4DC05" -> "Covalex
// Distribution Centre S4DC05", le code après le type plutôt qu'après
// l'entreprise), d'autres non (ex : "Sakura Sun Goldenrod Workcenter").
// Comme on ne sait pas laquelle des deux conventions s'applique, on
// propose les deux et on laisse l'appelant tenter chacune.
function reorderFrenchLocationDescriptor(rawText) {
  const cleaned = rawText.trim();
  const lower = cleaned.toLowerCase();
  for (const { prefix, suffix } of FRENCH_LOCATION_TYPE_PREFIXES) {
    if (!lower.startsWith(prefix)) continue;
    const rest = cleaned.slice(prefix.length).trim();
    if (!rest) continue;
    const candidates = [`${rest} ${suffix}`];
    const codeMatch = /^(.*\S)\s+([A-Za-z]*\d[A-Za-z0-9-]*)$/.exec(rest);
    if (codeMatch) candidates.push(`${codeMatch[1]} ${suffix} ${codeMatch[2]}`);
    return candidates;
  }
  return null;
}

// Les stations aux points de Lagrange sont nommées "<ABR>-L<N> <Nom>
// Station" dans le catalogue (ex : "HUR-L5 High Course Station"), mais
// certains écrans du jeu affichent une description complète plutôt que ce
// nom compact : "Station <Nom> au point de Lagrange L<N> d'<Planète>". Le
// code d'abréviation ne figure nulle part dans cette description (il faut
// le reconstruire à partir du nom de la planète), donc aucune des
// transformations ci-dessus ne peut le rattraper.
const LAGRANGE_PLANET_ABBR = {
  hurston: "HUR",
  crusader: "CRU",
  arccorp: "ARC",
  microtech: "MIC",
};

function reorderFrenchLagrangeStation(rawText) {
  const cleaned = rawText.trim();
  // Le code d'abréviation est parfois déjà présent devant (ex : "HUR-L1
  // Station Green Glade" au lieu du catalogue "HUR-L1 Green Glade
  // Station") : seul "Station" est du mauvais côté du nom, pas besoin de
  // reconstruire l'abréviation à partir du nom de planète dans ce cas.
  const withCode = /^([A-Za-z]{3}-l\d)\s+station\s+(.+)$/i.exec(cleaned);
  if (withCode) return `${withCode[1]} ${withCode[2].trim()} Station`;

  // Tolère un artefact OCR (crochet, puce...) entre "au" et "point", ainsi
  // qu'un espace manquant avant "au" (ex : "Faithful Dreamau point de..." —
  // le dernier mot du nom se retrouve collé à "au" sans espace) : le nom du
  // lieu tient parfois sur deux lignes en jeu, coupées juste à cet endroit.
  const m = /^station\s+(.+?)\s*au\s*[^\p{L}\s]*\s*point\s+de\s+lagrange\s+l(\d)\s+d[e']\s*(.+)$/iu.exec(cleaned);
  if (!m) return null;
  const abbr = LAGRANGE_PLANET_ABBR[m[3].trim().toLowerCase().replace(/[^a-z]/g, "")];
  if (!abbr) return null;
  return `${abbr}-L${m[2]} ${m[1].trim()} Station`;
}

// Certaines stations en orbite (pas à un point de Lagrange) sont décrites en
// français par "(La )Station <Nom> en orbite de <Planète>" (ex : "La Station
// Seraphin en orbite de Crusader" pour le catalogue "Seraphim Station") —
// même gabarit "Station" en préfixe que ci-dessus, mais sans code
// d'abréviation à reconstruire : on retire juste la description de l'orbite
// et on réordonne. La correspondance floue (fuzzyLocationMatch, appelée par
// looseLocationMatch) rattrape ensuite les petites erreurs de l'OCR sur le
// nom lui-même (ex : "Seraphin" au lieu de "Seraphim").
function reorderFrenchOrbitalStation(rawText) {
  const cleaned = rawText.trim();
  const re = /^(?:la\s+)?station\s+(.+?)\s*en\s*[^\p{L}\s]*\s*orbite\s+de\s+.+$/iu;
  let m = re.exec(cleaned);
  if (!m) {
    // Un glyphe isolé (icône d'interface mal lue par l'OCR, ex : "I", "|")
    // traîne parfois en tête de ligne à cause du recadrage — on retente en
    // le retirant, mais seulement s'il s'agit bien d'un unique caractère
    // suivi d'un espace (pour ne jamais couper un vrai mot court comme "la").
    m = re.exec(cleaned.replace(/^\S\s+/, ""));
  }
  if (!m) return null;
  return `${m[1].trim()} Station`;
}

// Le nom de lieu lu par l'OCR ne correspond pas toujours exactement à un
// lieu de la base (variante de nom, casse, mot manquant) : on tente une
// correspondance exacte, puis approximative, puis floue (distance d'édition).
function looseLocationMatch(rawText) {
  const cleaned = rawText.trim();
  if (!cleaned) return null;
  const exact = findLocationByLabel(cleaned);
  if (exact) return exact;
  // Certains lieux sont affichés en jeu (client français) sous un nom traduit
  // qui n'a aucun rapport structurel avec le nom UEX (anglais) : ni la
  // correspondance exacte/substring ni la distance d'édition ne peuvent
  // rattraper ça. On vérifie donc d'abord la table d'alias FR -> id connue.
  const aliasId = LOCATION_ALIASES[slugify(cleaned)];
  if (aliasId) {
    const aliased = getLocationById(aliasId);
    if (aliased) return aliased;
  }
  const lower = cleaned.toLowerCase();
  const byName = allLocations().find((loc) => loc.name.toLowerCase() === lower);
  if (byName) return byName;
  const bySubstring = allLocations().find((loc) => substringMatchesReasonably(lower, loc.name.toLowerCase()));
  if (bySubstring) return bySubstring;
  const fuzzy = fuzzyLocationMatch(cleaned);
  if (fuzzy) return fuzzy;
  const trimmed = progressiveTrimMatch(cleaned);
  if (trimmed) return trimmed;

  const candidates = [
    ...(reorderFrenchLocationDescriptor(cleaned) || []),
    ...(reorderFrenchLagrangeStation(cleaned) ? [reorderFrenchLagrangeStation(cleaned)] : []),
    ...(reorderFrenchOrbitalStation(cleaned) ? [reorderFrenchOrbitalStation(cleaned)] : []),
  ];
  for (const reordered of candidates) {
    const reorderedLower = reordered.toLowerCase();
    const byNameReordered = allLocations().find((loc) => loc.name.toLowerCase() === reorderedLower);
    if (byNameReordered) return byNameReordered;
    const bySubstringReordered = allLocations().find((loc) =>
      substringMatchesReasonably(reorderedLower, loc.name.toLowerCase())
    );
    if (bySubstringReordered) return bySubstringReordered;
    const fuzzyReordered = fuzzyLocationMatch(reordered);
    if (fuzzyReordered) return fuzzyReordered;
  }
  return null;
}

// Une correspondance "substring" entre deux textes de longueurs très
// différentes est presque toujours un faux positif (ex : le lieu générique
// "microTech" — juste le nom de la planète — est trivialement inclus dans
// n'importe quel texte contenant "microTech Logistics Depot ...") : on
// n'accepte la correspondance substring que si les deux textes sont d'une
// longueur assez proche.
function substringMatchesReasonably(a, b) {
  if (!a.includes(b) && !b.includes(a)) return false;
  const shorter = Math.min(a.length, b.length);
  const longer = Math.max(a.length, b.length);
  return shorter >= longer * 0.5;
}

// Filet de sécurité pour les suffixes de position pas encore rencontrés
// (ex : "au-dessus de X", "sur X", ou une autre tournure future) : on
// retire progressivement le dernier mot jusqu'à trouver une correspondance
// exacte, en partant du texte complet.
function progressiveTrimMatch(cleaned) {
  const words = cleaned.split(/\s+/);
  for (let end = words.length - 1; end >= 1; end--) {
    const candidate = words.slice(0, end).join(" ").toLowerCase();
    const loc = allLocations().find((l) => l.name.toLowerCase() === candidate);
    if (loc) return loc;
  }
  return null;
}

// Active l'onglet contenant tabId, quel que soit le groupe ".tabs" auquel il
// appartient (utilisé notamment pour ramener sur "Nouvelle mission" quand on
// importe une mission OCR depuis un autre onglet).
function activateTab(tabId) {
  const panel = document.getElementById(tabId);
  if (!panel) return;
  const group = panel.closest(".tabs");
  if (!group) return;

  const applySwitch = () => {
    const buttons = group.querySelectorAll(".tab-btn");
    const panels = group.querySelectorAll(".tab-panel");
    buttons.forEach((b) => b.classList.remove("active"));
    panels.forEach((p) => (p.style.display = "none"));
    panel.style.display = "";
    const btn = Array.from(buttons).find((b) => b.dataset.tab === tabId);
    if (btn) btn.classList.add("active");
  };

  // Transition animée native (Chrome/Edge) ; se rabat sur un changement
  // instantané dans les navigateurs qui ne la supportent pas encore.
  if (document.startViewTransition) {
    document.startViewTransition(applySwitch);
  } else {
    applySwitch();
  }
}

// Petit utilitaire pour rejouer une animation d'apparition sur un conteneur
// dont le contenu vient d'être remplacé (résultat OCR, résultat de trajet...).
function triggerFadeIn(el) {
  el.classList.remove("fade-in");
  void el.offsetWidth; // force le reflow pour pouvoir rejouer l'animation
  el.classList.add("fade-in");
}

// Résout un lieu OCR pour préremplir le formulaire : correspondance connue en
// premier, sinon secours Star Citizen Wiki — créé directement puisque c'est un
// lieu réel confirmé (pas juste du texte brut approximatif). Si même ça ne
// correspond à rien, le champ garde le texte brut pour correction manuelle.
function resolveLocationForOcrForm(rawText) {
  if (!rawText) return null;
  const existing = looseLocationMatch(rawText);
  if (existing) return existing;
  const scwiki = scwikiLocationMatch(rawText);
  if (scwiki) return addCustomLocation(scwiki.name, scwikiCategory(scwiki), scwiki.parent);
  return null;
}

// Pré-remplit le formulaire "Nouvelle mission" avec les données d'une mission
// déjà enregistrée pour la corriger en direct (bouton "Modifier" dans
// Missions enregistrées) : la soumission met alors à jour cette mission au
// lieu d'en créer une nouvelle.
function startEditMission(mission) {
  editingMissionId = mission.id;
  document.getElementById("mission-name").value = mission.name || "";
  document.getElementById("mission-giver").value = mission.giver || "";
  document.getElementById("mission-reward").value = mission.reward ?? "";

  const container = document.getElementById("cargo-fields");
  container.innerHTML = "";
  (mission.cargoItems || []).forEach((item) => {
    const pickupLoc = getLocationById(item.pickupId);
    const dropoffLoc = getLocationById(item.dropoffId);
    createCargoFieldRow(
      item.commodity,
      item.quantity,
      pickupLoc ? locationSearchLabel(pickupLoc) : "",
      dropoffLoc ? locationSearchLabel(dropoffLoc) : "",
      item.maxCargoBoxSize
    );
  });

  document.getElementById("mission-submit-btn").textContent = t("saveMissionBtn");
  document.getElementById("cancel-edit-btn").style.display = "";
  activateTab("new-mission-tab");
  document.getElementById("mission-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelEditMission() {
  editingMissionId = null;
  pendingOcrMaxCargoBoxSize = null;
  document.getElementById("mission-form").reset();
  resetCargoFields();
  document.getElementById("mission-submit-btn").textContent = t("addMissionBtn");
  document.getElementById("cancel-edit-btn").style.display = "none";
}

function applyOcrResultToForm(parsed) {
  // Un import OCR construit toujours une nouvelle mission : si le formulaire
  // était en train de modifier une mission existante, on annule ce mode pour
  // éviter d'écraser la mauvaise mission à la soumission.
  if (editingMissionId !== null) cancelEditMission();
  pendingOcrMaxCargoBoxSize = parsed.maxCargoBoxSize || null;
  if (parsed.name) document.getElementById("mission-name").value = parsed.name;
  if (parsed.giver) document.getElementById("mission-giver").value = parsed.giver;
  if (parsed.reward) document.getElementById("mission-reward").value = parsed.reward;
  if (parsed.cargoItems && parsed.cargoItems.length) {
    const container = document.getElementById("cargo-fields");
    container.innerHTML = "";
    parsed.cargoItems.forEach((item) => {
      const pickupLoc = resolveLocationForOcrForm(item.pickupText || "");
      const dropoffLoc = resolveLocationForOcrForm(item.dropoffText || "");
      createCargoFieldRow(
        resolveCommodityName(item.commodity),
        item.quantity,
        pickupLoc ? locationSearchLabel(pickupLoc) : item.pickupText,
        dropoffLoc ? locationSearchLabel(dropoffLoc) : item.dropoffText
      );
    });
    refreshAllLocationSelects();
  }
  activateTab("new-mission-tab");
  document.getElementById("mission-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderOcrResult(rawText, parsed) {
  const container = document.getElementById("ocr-result");
  container.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "ocr-summary";
  const rows = [
    [t("ocrLabelName"), parsed.name],
    [t("ocrLabelGiver"), parsed.giver],
    [t("ocrLabelReward"), parsed.reward ? `${parsed.reward} aUEC` : ""],
    [t("ocrLabelMaxBoxSize"), parsed.maxCargoBoxSize ? `${parsed.maxCargoBoxSize} SCU` : ""],
  ];
  rows.forEach(([label, value]) => {
    if (!value) return;
    const row = document.createElement("div");
    row.className = "ocr-summary-row";
    row.innerHTML = `<strong>${label} :</strong> `;
    row.appendChild(document.createTextNode(value));
    summary.appendChild(row);
  });
  const hasApproximateSplit = (parsed.cargoItems || []).some((item) => item.approximate);
  if (hasApproximateSplit) {
    const warn = document.createElement("p");
    warn.className = "hint warning-text";
    warn.textContent = t("ocrApproxWarning");
    container.appendChild(warn);
  }

  (parsed.cargoItems || []).forEach((item) => {
    const row = document.createElement("div");
    row.className = "ocr-summary-row";
    const approxNote = item.approximate ? t("ocrEstimationSuffix") : "";
    row.textContent = t("ocrItemLine", {
      qty: item.quantity || "?",
      commodity: item.commodity || "?",
      pickup: item.pickupText || "?",
      dropoff: item.dropoffText || "?",
      approx: approxNote,
    });
    summary.appendChild(row);
  });
  container.appendChild(summary);

  const pre = document.createElement("pre");
  pre.className = "ocr-raw-text";
  pre.textContent = rawText.trim() || t("ocrNoTextRecognized");
  container.appendChild(pre);

  const hasAnyField =
    parsed.name || parsed.giver || parsed.reward || (parsed.cargoItems && parsed.cargoItems.length);

  if (hasAnyField) {
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "btn-primary";
    useBtn.textContent = t("ocrUseFieldsBtn");
    useBtn.addEventListener("click", () => applyOcrResultToForm(parsed));
    container.appendChild(useBtn);
  } else {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = t("ocrNoFieldsRecognized");
    container.appendChild(note);
  }
  triggerFadeIn(container);
}

// Vide le panneau d'import OCR (capture, texte reconnu, champs extraits) une
// fois qu'une mission a été enregistrée à partir de son contenu, pour ne pas
// laisser trainer des données devenues inutiles dans le panneau latéral.
function clearOcrPanel() {
  document.getElementById("ocr-status").textContent = "";
  const preview = document.getElementById("ocr-preview");
  preview.style.display = "none";
  preview.src = "";
  document.getElementById("ocr-result").innerHTML = "";
}

async function processOcrImage(blob) {
  const status = document.getElementById("ocr-status");
  const preview = document.getElementById("ocr-preview");

  preview.src = URL.createObjectURL(blob);
  preview.style.display = "block";
  status.textContent = t("ocrRecognizing");

  try {
    const rawText = await runOcrOnMissionScreenshot(blob);
    const parsed = parseOcrText(rawText);
    status.textContent = t("ocrRecognized");
    renderOcrResult(rawText, parsed);
  } catch (e) {
    status.textContent = t("ocrError", { msg: e.message });
  }
}

function allScwikiLocations() {
  return state.scwikiLocations.length ? state.scwikiLocations : DEFAULT_SCWIKI_LOCATIONS;
}

// Reconstitue une catégorie dans la même convention que celle utilisée pour
// les lieux UEX (voir locationCategoryFromTerminal dans uex.js), à partir des
// champs type/système du lieu Star Citizen Wiki.
function scwikiCategory(entry) {
  let base = "Avant-poste";
  if (entry.type === "Planet") base = "Planète";
  else if (entry.type === "Moon") base = "Lune";
  else if (entry.type === "Settlement") base = "Ville";
  else if (entry.type === "Manmade") base = "Station";
  if (entry.system && entry.system !== "Stanton") base += ` - ${entry.system}`;
  return base;
}

// Recherche de secours dans le jeu de données Star Citizen Wiki (beaucoup
// plus granulaire qu'UEX, cf. data/scwiki-locations.js), utilisée seulement
// quand aucun lieu UEX ne correspond : donne un lieu personnalisé avec la
// bonne catégorie/planète/système plutôt qu'un lieu générique "Personnalisé".
function scwikiLocationMatch(rawText) {
  const cleaned = rawText.trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const entries = allScwikiLocations();
  const exact = entries.find((e) => e.name.toLowerCase() === lower);
  if (exact) return exact;
  const bySubstring = entries.find((e) => substringMatchesReasonably(lower, e.name.toLowerCase()));
  if (bySubstring) return bySubstring;

  function closestWithin(text) {
    const needle = text.toLowerCase();
    let best = null;
    let bestDist = Infinity;
    entries.forEach((e) => {
      const dist = levenshteinDistance(needle, e.name.toLowerCase());
      if (dist < bestDist) {
        bestDist = dist;
        best = e;
      }
    });
    if (!best) return null;
    const threshold = Math.max(3, Math.round(best.name.length * 0.15));
    return bestDist <= threshold ? best : null;
  }

  const fuzzy = closestWithin(cleaned);
  if (fuzzy) return fuzzy;

  // Même repli que looseLocationMatch : certains lieux (secours SC Wiki
  // uniquement, ex : "Cry-Astro Processing Plant 34-12", "microTech
  // Logistics Depot S4LD01") sont traduits avec le mot descriptif en
  // préfixe plutôt qu'en suffixe.
  const candidates = reorderFrenchLocationDescriptor(cleaned);
  if (!candidates) return null;
  for (const reordered of candidates) {
    const reorderedLower = reordered.toLowerCase();
    const bySubstringReordered = entries.find((e) =>
      substringMatchesReasonably(reorderedLower, e.name.toLowerCase())
    );
    if (bySubstringReordered) return bySubstringReordered;
    const fuzzyReordered = closestWithin(reordered);
    if (fuzzyReordered) return fuzzyReordered;
  }
  return null;
}

// Traduit un nom de marchandise capté en français vers le nom UEX (anglais),
// via la table d'alias (voir data/commodity-aliases.js) — contrairement aux
// lieux, une correspondance approximative ne peut pas aider ici (les noms
// français et anglais n'ont généralement aucun mot en commun), donc pas de
// repli flou : sans alias connu, on garde le texte brut tel quel.
function resolveCommodityName(rawName) {
  if (!rawName) return rawName;
  const alias = COMMODITY_ALIASES[rawName.trim().toLowerCase()];
  return alias || rawName;
}

// Résout un lieu OCR vers un lieu existant (correspondance approximative),
// puis en secours vers le jeu de données Star Citizen Wiki, ou en crée un
// nouveau à la volée si rien ne correspond — pour ne jamais bloquer la
// création automatique d'une mission en import multiple.
function resolveOrCreateLocation(rawText, notes) {
  if (!rawText) return null;
  const existing = looseLocationMatch(rawText);
  if (existing) return existing;
  const scwiki = scwikiLocationMatch(rawText);
  if (scwiki) {
    const created = addCustomLocation(scwiki.name, scwikiCategory(scwiki), scwiki.parent);
    if (created) notes.push(t("ocrBatchLocationCreated", { name: created.name }));
    return created;
  }
  const created = addCustomLocation(rawText, "Personnalisé");
  if (created) notes.push(t("ocrBatchLocationCreated", { name: created.name }));
  return created;
}

// Crée directement une mission à partir d'un résultat OCR (utilisé en import
// multiple, où revoir chaque champ à la main annulerait l'intérêt du lot).
function createMissionFromOcrResult(parsed) {
  const notes = [];
  const cargoItems = [];
  (parsed.cargoItems || []).forEach((item) => {
    const pickupLoc = resolveOrCreateLocation(item.pickupText, notes);
    const dropoffLoc = resolveOrCreateLocation(item.dropoffText, notes);
    if (!pickupLoc || !dropoffLoc) return;
    cargoItems.push({
      commodity: resolveCommodityName(item.commodity) || "",
      quantity: item.quantity || "",
      pickupId: pickupLoc.id,
      dropoffId: dropoffLoc.id,
    });
  });
  if ((parsed.cargoItems || []).some((item) => item.approximate)) {
    notes.push(t("ocrApproxWarning"));
  }
  if (!cargoItems.length) {
    return { mission: null, notes: [t("ocrBatchNoCargo"), ...notes] };
  }

  // Évite de recréer une mission déjà enregistrée (ex : la même capture
  // importée deux fois) : on compare par signature (donneur/marchandises/
  // lieux/récompense), pas par nom, pour repérer aussi les cas où l'OCR
  // reconnaît le nom différemment d'un import à l'autre.
  const candidateSignature = missionSignature({ giver: parsed.giver, cargoItems, reward: parsed.reward });
  const alreadyExists = activeMissions().some((m) => missionSignature(m) === candidateSignature);
  if (alreadyExists) {
    return { mission: null, notes: [t("ocrBatchDuplicate")] };
  }

  const mission = addMission({
    name: parsed.name,
    giver: parsed.giver,
    cargoItems,
    reward: parsed.reward,
    maxCargoBoxSize: parsed.maxCargoBoxSize,
  });
  return { mission, notes };
}

function renderOcrBatchResult(results) {
  const container = document.getElementById("ocr-result");
  container.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "ocr-summary";
  results.forEach(({ file, mission, notes }) => {
    const row = document.createElement("div");
    row.className = "ocr-summary-row";
    row.textContent = mission
      ? t("ocrBatchItemCreated", { file: file.name, name: mission.name })
      : t("ocrBatchItemFailed", { file: file.name, reason: notes[0] || "?" });
    summary.appendChild(row);
    if (mission && notes.length) {
      const noteRow = document.createElement("div");
      noteRow.className = "ocr-summary-row hint";
      noteRow.textContent = notes.join(" — ");
      summary.appendChild(noteRow);
    }
  });
  container.appendChild(summary);
  triggerFadeIn(container);
}

async function processOcrImagesBatch(files) {
  const status = document.getElementById("ocr-status");
  const preview = document.getElementById("ocr-preview");
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    status.textContent = t("ocrBatchProgress", { done: i + 1, total: files.length });
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
    try {
      const rawText = await runOcrOnMissionScreenshot(file);
      const parsed = parseOcrText(rawText);
      const { mission, notes } = createMissionFromOcrResult(parsed);
      results.push({ file, mission, notes });
    } catch (e) {
      results.push({ file, mission: null, notes: [t("ocrError", { msg: e.message })] });
    }
  }

  const created = results.filter((r) => r.mission).length;
  status.textContent = t("ocrBatchDone", { count: created, total: files.length });
  // Les missions sont déjà enregistrées à ce stade : inutile de garder la
  // dernière capture affichée, seul le résumé (créé/ignoré) reste utile.
  preview.style.display = "none";
  preview.src = "";
  renderOcrBatchResult(results);
  renderAll();
  activateTab("missions-tab");
}

// =========================================================================
// Câblage des événements
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  applyStaticTranslations();
  renderAll();
  resetCargoFields();

  const themeToggle = document.getElementById("theme-toggle");
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  themeToggle.textContent = currentTheme === "light" ? "🌙" : "☀️";
  themeToggle.addEventListener("click", () => {
    const next = (document.documentElement.getAttribute("data-theme") || "dark") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("sc-cargo-optimizer-theme", next);
    themeToggle.textContent = next === "light" ? "🌙" : "☀️";
  });

  const langToggle = document.getElementById("lang-toggle");
  langToggle.innerHTML = getLang() === "en" ? "🇫🇷 FR" : "🇺🇸 EN";
  langToggle.addEventListener("click", () => {
    setLang(getLang() === "en" ? "fr" : "en");
    langToggle.innerHTML = getLang() === "en" ? "🇫🇷 FR" : "🇺🇸 EN";
    applyStaticTranslations();
    // Rafraîchit aussi les textes des champs marchandise déjà présents dans
    // le formulaire (leurs placeholders ne sont pas couverts par data-i18n).
    document.querySelectorAll(".cargo-commodity-input").forEach((i) => (i.placeholder = t("cargoCommodityPlaceholder")));
    document.querySelectorAll(".cargo-quantity-input").forEach((i) => (i.placeholder = t("cargoScuPlaceholder")));
    document.querySelectorAll(".cargo-pickup-input").forEach((i) => (i.placeholder = t("cargoPickupPlaceholder")));
    document.querySelectorAll(".cargo-dropoff-input").forEach((i) => (i.placeholder = t("cargoDropoffPlaceholder")));
    document
      .querySelectorAll(".cargo-boxsize-input option[value='']")
      .forEach((o) => (o.textContent = t("cargoBoxSizeAnyOption")));
    renderAll();
    // Le texte de l'onglet « Optimisation du cargo » (étape courante,
    // récupérations/livraisons) ET les étiquettes Avant/Arrière/Gauche/Droite
    // de la vue 3D (textures canvas cuites avec le texte au moment du rendu,
    // voir makeAxisLabel dans js/cargo-viewer.js) ne sont pas couverts par
    // renderAll() : on rejoue le rendu de l'étape courante pour tout
    // retraduire d'un coup. renderCargoStepView() conserve l'étape courante
    // (cargoPackState.stepIndex) et ne bouge pas la caméra (même vaisseau ->
    // même frameKey côté cargo-viewer) ; renderCargoPackStatus() retraduit la
    // ligne de résumé. Les deux sont no-op si aucun rangement n'est affiché.
    renderCargoStepView();
    renderCargoPackStatus();
  });

  document.getElementById("add-cargo-btn").addEventListener("click", () => {
    createCargoFieldRow();
  });

  // Chaque groupe ".tabs" bascule indépendamment des autres groupes présents
  // sur la page (ex : les onglets Nouvelle mission/Missions n'affectent pas
  // ceux de Distances/Optimisation).
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activateTab(btn.dataset.tab);
      // Les propositions sont rechargées à l'ouverture de l'onglet (données
      // distantes, pas un rendu local) — sinon on afficherait un cache figé.
      if (btn.dataset.tab === "submissions-tab") renderSubmissionsTab();
    });
  });
  bindEvent("submissions-refresh-btn", "click", renderSubmissionsTab);

  document.getElementById("ship-select").addEventListener("change", (e) => {
    state.selectedShip = e.target.value;
    saveState();
    renderShipCapacity();
    renderShipAccessFaces();
    renderMissionsTable();
    renderAdminGridEntry();
  });

  const mcsSelect = document.getElementById("admin-grid-mcs");
  ADMIN_GRID_MAX_BOX_SIZES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s);
    opt.textContent = `${s} SCU`;
    mcsSelect.appendChild(opt);
  });
  // index.html est le SEUL fichier sans cache-bust : c'est le point d'entrée,
  // il ne peut pas s'auto-versionner. Un navigateur peut donc servir un
  // index.html PÉRIMÉ avec un js/app.js?v=N tout neuf (URL neuve = jamais en
  // cache) — les éléments ajoutés au HTML par la même livraison n'existent
  // alors pas. getElementById renvoie null, addEventListener lève, et comme
  // l'init est un seul bloc DOMContentLoaded sans filet, TOUT ce qui suit est
  // mort : c'est ainsi que l'ajout du bouton « Pivoter 90° » a tué le glisser
  // (reproduit : ancien index.html + app.js?v=r35 => TypeError). Un élément
  // absent doit dégrader — ce bouton-là ne marche pas jusqu'au rechargement —
  // jamais casser le reste.
  bindEvent("admin-grid-edit-btn", "click", enterAdminGridEdit);
  bindEvent("admin-grid-close-btn", "click", exitAdminGridEdit);
  bindEvent("admin-grid-add-btn", "click", addAdminGridModule);
  bindEvent("admin-grid-remove-btn", "click", removeAdminGridModule);
  bindEvent("admin-grid-publish-btn", "click", publishAdminGrid);
  bindEvent("admin-grid-rotate-btn", "click", rotateAdminGridModule);
  bindEvent("admin-grid-moveall-btn", "click", toggleAdminGridMoveAll);
  ["admin-grid-cx", "admin-grid-cy", "admin-grid-cz", "admin-grid-mcs"].forEach((id) => {
    bindEvent(id, "change", applyAdminGridSize);
  });

  document.getElementById("custom-ship-capacity").addEventListener("change", (e) => {
    state.customShipCapacity = Number(e.target.value) || null;
    saveState();
    renderShipCapacity();
    renderMissionsTable();
  });

  ACCESS_FACE_KEYS.forEach((face) => {
    document.getElementById(`access-face-${face}`).addEventListener("change", (e) => {
      const ship = getSelectedShip();
      if (!ship) return;
      const current = { ...(getShipAccessFaces(ship.name) || DEFAULT_ACCESS_FACES) };
      current[face] = e.target.checked;
      // Au moins une face doit rester cochée, sinon toute caisse deviendrait
      // définitivement irrécupérable sur ce vaisseau (voir
      // isBlockedFromEveryAccessibleFace : une liste vide bloque tout par
      // construction) — on annule le décochage de la dernière case restante.
      if (!ACCESS_FACE_KEYS.some((f) => current[f])) {
        e.target.checked = true;
        return;
      }
      state.shipAccessFaces[ship.name] = current;
      saveState();
      if (cargoPackState) runCargoPacking();
    });
  });

  const ocrDropzone = document.getElementById("ocr-dropzone");
  const ocrFileInput = document.getElementById("ocr-file-input");

  // L'exemple de capture fait 280 px de large dans le panneau latéral : le
  // détail que le joueur doit reconnaître (récompense, proposeur, liste des
  // objectifs) y est illisible. Cliquer l'agrandit par-dessus la page.
  makeImageZoomable(document.querySelector(".ocr-help-image"), t("ocrHelpImageZoom"));

  ocrDropzone.addEventListener("click", () => ocrFileInput.click());

  // Un div en role="button" n'hérite d'AUCUN comportement clavier natif : sans
  // ceci, Entrée et Espace ne faisaient rien sur la zone d'import.
  ocrDropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault(); // Espace ferait défiler la page
      ocrFileInput.click();
    }
  });

  ocrFileInput.addEventListener("change", () => {
    const files = Array.from(ocrFileInput.files);
    if (files.length === 1) processOcrImage(files[0]);
    else if (files.length > 1) processOcrImagesBatch(files);
  });

  ocrDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    ocrDropzone.classList.add("dragover");
  });
  ocrDropzone.addEventListener("dragleave", () => ocrDropzone.classList.remove("dragover"));
  ocrDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    ocrDropzone.classList.remove("dragover");
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 1) processOcrImage(files[0]);
    else if (files.length > 1) processOcrImagesBatch(files);
  });

  document.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (items.length === 0) return;
    const files = items.map((i) => i.getAsFile()).filter(Boolean);
    if (files.length === 1) processOcrImage(files[0]);
    else if (files.length > 1) processOcrImagesBatch(files);
  });

  document.getElementById("mission-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("mission-name").value.trim();
    const giver = document.getElementById("mission-giver").value.trim();
    const reward = document.getElementById("mission-reward").value;

    const rows = getCargoFieldValues();
    if (rows.length === 0) {
      showToast(t("addAtLeastOneCargoError"), "error");
      return;
    }

    const cargoItems = [];
    for (const row of rows) {
      const pickupLoc = findLocationByLabel(row.pickupText);
      const dropoffLoc = findLocationByLabel(row.dropoffText);
      if (!pickupLoc || !dropoffLoc) {
        showToast(t("locationNotFoundError", { commodity: row.commodity || "?" }), "error");
        return;
      }
      cargoItems.push({
        commodity: row.commodity,
        quantity: row.quantity,
        maxCargoBoxSize: row.boxSize ? Number(row.boxSize) : null,
        pickupId: pickupLoc.id,
        dropoffId: dropoffLoc.id,
      });
    }

    if (editingMissionId !== null) {
      const mission = state.missions.find((m) => m.id === editingMissionId);
      if (mission) {
        const oldItems = mission.cargoItems || [];
        mission.name = name;
        mission.giver = giver;
        mission.reward = reward;
        // Garde le plannedQuantity des lignes inchangées (même marchandise et
        // mêmes lieux), pour ne pas perdre la référence déjà suivie dans
        // l'onglet Suivi cargo ; une ligne modifiée ou nouvelle repart d'une
        // référence égale à la quantité tout juste saisie.
        mission.cargoItems = cargoItems.map((item) => {
          const prev = oldItems.find(
            (old) => old.commodity === item.commodity && old.pickupId === item.pickupId && old.dropoffId === item.dropoffId
          );
          return { ...item, plannedQuantity: prev ? prev.plannedQuantity : item.quantity };
        });
        saveState();
      }
      cancelEditMission();
    } else {
      const added = addMission({ name, giver, cargoItems, reward, maxCargoBoxSize: pendingOcrMaxCargoBoxSize });
      pendingOcrMaxCargoBoxSize = null;
      e.target.reset();
      resetCargoFields();
      // La mission est enregistrée : la capture/le texte reconnu qui a servi
      // à la préremplir n'a plus d'utilité, on nettoie le panneau d'import.
      clearOcrPanel();
      // C'est l'action la plus répétée de la session (5 à 10 fois). Sans ce
      // retour, le seul signal de succès était « le formulaire s'est vidé »,
      // indistinguable d'une remise à zéro accidentelle : le joueur allait
      // vérifier dans l'onglet Missions à chaque fois.
      showToast(t("missionAdded", { name: (added && added.name) || name }), "success");
    }
    renderAll();
  });

  document.getElementById("cancel-edit-btn").addEventListener("click", cancelEditMission);

  document.getElementById("add-location-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-location-name");
    const categorySelect = document.getElementById("new-location-category");
    const loc = addCustomLocation(nameInput.value, categorySelect.value);
    // addCustomLocation ne renvoie null que sur un nom vide. Avant, ce cas ne
    // produisait STRICTEMENT rien à l'écran : le joueur cliquait, rien ne
    // bougeait, et rien ne disait pourquoi.
    if (!loc) {
      showToast(t("locationNameRequired"), "error");
      nameInput.focus();
      return;
    }
    nameInput.value = "";
    refreshAllLocationSelects();
    showToast(t("locationAdded", { name: loc.name }), "success");
  });

  document.getElementById("select-all-missions").addEventListener("click", () => {
    activeMissions().forEach((m) => (m.included = true));
    saveState();
    renderAll();
  });
  document.getElementById("deselect-all-missions").addEventListener("click", () => {
    activeMissions().forEach((m) => (m.included = false));
    saveState();
    renderAll();
  });
  document.getElementById("complete-selected-missions").addEventListener("click", () => {
    const now = Date.now();
    activeMissions()
      .filter((m) => m.included)
      .forEach((m) => {
        m.completed = true;
        m.completedAt = now;
      });
    saveState();
    renderAll();
  });

  document.getElementById("optimize-btn").addEventListener("click", runOptimize);
  document.getElementById("pack-cargo-btn").addEventListener("click", runCargoPacking);
  document.getElementById("cargo-viewer-rotate-btn").addEventListener("click", rotateCargoViewerOrientation);
  document.getElementById("cargo-viewer-mirror-btn").addEventListener("click", mirrorCargoViewerOrientation);
  document.getElementById("cargo-viewer-edit-btn").addEventListener("click", enterCargoLayoutEdit);
  document.getElementById("cargo-viewer-edit-done-btn").addEventListener("click", exitCargoLayoutEdit);
  document.getElementById("cargo-viewer-reset-layout-btn").addEventListener("click", resetCargoViewerLayout);
  bindEvent("propose-layout-btn", "click", proposeCurrentLayout);
  bindEvent("propose-correction-btn", "click", proposeCorrection);
  bindEvent("reservation-edit-btn", "click", enterReservationEdit);
  bindEvent("reservation-close-btn", "click", exitReservationEdit);
  bindEvent("reservation-place-btn", "click", placeReservationVehicle);
  document.getElementById("cargo-step-prev").addEventListener("click", () => {
    if (!cargoPackState || cargoPackState.stepIndex <= 0) return;
    cargoPackState.stepIndex -= 1;
    renderCargoStepView();
  });
  document.getElementById("cargo-step-next").addEventListener("click", () => {
    if (!cargoPackState || cargoPackState.stepIndex >= cargoPackState.routeResult.steps.length - 1) return;
    cargoPackState.stepIndex += 1;
    renderCargoStepView();
  });

  const allowRevisitsBtn = document.getElementById("allow-revisits-btn");
  allowRevisitsBtn.title = t("allowRevisitsHint");
  allowRevisitsBtn.addEventListener("click", () => {
    allowRevisitsBtn.classList.toggle("active");
  });

  document.getElementById("reset-all").addEventListener("click", async () => {
    // danger:true — le focus part sur « Annuler » et le bouton de
    // confirmation est rouge : une frappe Entrée réflexe ne doit pas effacer
    // les données du joueur.
    const confirmed = await confirmDialog({
      message: t("confirmResetAll"),
      confirmLabel: t("confirmResetAllBtn"),
      danger: true,
    });
    if (!confirmed) return;
    // Ne remet à zéro que le contenu propre au joueur (missions, lieux
    // personnalisés, distances associées, calibrage de réputation — voir
    // confirmResetAll ci-dessous pour la liste exacte annoncée au joueur),
    // pas le catalogue UEX/SCWiki/FleetYards synchronisé : ce dernier n'a
    // aucune raison d'être perdu ici, il se tient déjà à jour tout seul
    // (voir maybeAutoSync) et un vaisseau/lieu n'a pas besoin d'être
    // "réappris" par une resynchronisation après un simple reset.
    const defaults = defaultState();
    state.missions = defaults.missions;
    state.customLocations = defaults.customLocations;
    state.distances = defaults.distances;
    state.nextMissionId = defaults.nextMissionId;
    state.reputationOverrides = defaults.reputationOverrides;
    saveState();
    renderAll();
    // Répercute aussi le reset côté cloud, sinon une prochaine connexion
    // ressusciterait les anciennes données depuis Supabase.
    if (typeof scheduleCloudSync === "function") scheduleCloudSync(state);
    if (typeof flushPendingCloudSync === "function") flushPendingCloudSync();
    showToast(t("resetAllDone"), "success");
  });

  if (typeof initCloudSync === "function") initCloudSync();

  // Pas de bouton de synchronisation manuelle : la base se rafraîchit toute
  // seule, jusqu'à 4 fois par jour (toutes les 6h). Un check au chargement
  // couvre la visite normale ; l'intervalle couvre le cas d'un onglet laissé
  // ouvert plus de 6h (le joueur n'a jamais besoin d'y penser). Un
  // DATA_SCHEMA_VERSION différent de celui déjà enregistré (voir plus haut)
  // force aussi une resynchro immédiate, même si les 6h ne sont pas
  // écoulées : sans ça, un correctif de la logique de synchro elle-même
  // (ex. le filtre syncUexShips qui excluait l'Ironclad Assault) reste
  // masqué par un cache local encore "frais" jusqu'à expiration du délai.
  const AUTO_SYNC_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const maybeAutoSync = () => {
    const stale = !state.uexSyncedAt || Date.now() - state.uexSyncedAt > AUTO_SYNC_MAX_AGE_MS;
    const schemaChanged = state.dataSchemaVersion !== DATA_SCHEMA_VERSION;
    if (stale || schemaChanged) {
      runFullSync().then(() => {
        state.dataSchemaVersion = DATA_SCHEMA_VERSION;
        saveState();
      });
    }
  };
  maybeAutoSync();
  setInterval(maybeAutoSync, 15 * 60 * 1000);
});

// Lance la synchronisation complète (UEX Corp, distances manquantes, Star
// Citizen Wiki, FleetYards) en arrière-plan — déclenchée automatiquement au
// chargement puis périodiquement (voir plus haut). Aucune UI de statut :
// c'est silencieux pour le joueur, une erreur ne finit qu'en console.
async function runFullSync() {
  // Chaque source échoue SEULE. Avant, tout vivait dans un unique try
  // séquentiel : une panne UEX (la première source) abandonnait aussi
  // FleetYards ET les grilles publiées — le cœur du site — alors que ces
  // sources sont indépendantes les unes des autres.
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      console.error(`Sync ${label} échouée :`, err);
    }
  };

  await step("lieux UEX", async () => {
    await syncUexLocations();
    renderAll();
  });
  await step("marchandises UEX", () => syncUexCommodities());
  await step("entreprises UEX", () => syncUexCompanies());
  await step("vaisseaux UEX", async () => {
    await syncUexShips();
    renderAll();
  });
  await step("distances UEX", () => syncMissingDistances());
  await step("lieux SC Wiki", async () => {
    await syncScwikiLocations();
    backfillCustomLocationPlanetHints();
    saveState();
  });
  await step("soutes FleetYards", () => syncFleetyardsCargoHolds());
  // Grilles publiées + statut admin. Après FleetYards : une grille publiée
  // le remplace (voir getShipHolds), donc elle doit être lue en dernier.
  await step("grilles publiées", async () => {
    if (typeof fetchApprovedShipGrids === "function") {
      state.approvedShipGrids = await fetchApprovedShipGrids();
      saveState();
    }
    if (typeof fetchIsAdmin === "function") isAdminUser = await fetchIsAdmin();
    renderAdminGridEntry();
    renderSubmissionsEntry();
  });
  renderShipCapacity();
}
