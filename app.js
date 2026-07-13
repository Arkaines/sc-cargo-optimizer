"use strict";

// =========================================================================
// Persistance (localStorage)
// =========================================================================
const STORAGE_KEY = "sc-cargo-optimizer-v1";
const DEFAULT_DISTANCE = 100; // valeur de repli quand une distance n'a pas été renseignée

function defaultState() {
  return {
    missions: [],
    customLocations: [],
    distances: {},
    nextMissionId: 1,
    uexLocations: [],
    uexSyncedAt: null,
    selectedShip: "",
    uexCommodities: [],
    uexCompanies: [],
    uexShips: [],
  };
}

// Format actuel : mission.cargoItems, un tableau {commodity, quantity,
// pickupId, dropoffId} — chaque marchandise porte SON PROPRE lieu de
// récupération et de dépôt (plus de liste de lieux séparée au niveau de la
// mission, ce qui créait des doublons de dépose quand il y avait plusieurs
// lieux et qu'on ne savait pas quelle marchandise allait où).
function migrateMission(m) {
  if (m.cargoItems && m.cargoItems.length && m.cargoItems[0].pickupId !== undefined) {
    return { ...m, completed: m.completed || false };
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
    pickupId: oldPickupIds[0] || "",
    dropoffId: oldDropoffIds[0] || "",
  }));

  const { pickupIds, dropoffIds, pickupId, dropoffId, commodity, cargo, ...rest } = m;
  return { ...rest, cargoItems, completed: m.completed || false };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    return {
      missions: (parsed.missions || []).map(migrateMission),
      customLocations: parsed.customLocations || [],
      distances: parsed.distances || {},
      nextMissionId: parsed.nextMissionId || 1,
      uexLocations: parsed.uexLocations || [],
      uexSyncedAt: parsed.uexSyncedAt || null,
      selectedShip: parsed.selectedShip || "",
      uexCommodities: parsed.uexCommodities || [],
      uexCompanies: parsed.uexCompanies || [],
      uexShips: parsed.uexShips || [],
    };
  } catch (e) {
    return defaultState();
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function addCustomLocation(name, category) {
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

function hasBakedDistance(aId, bId) {
  return distanceKey(aId, bId) in DEFAULT_DISTANCE_MAP;
}

function getDistance(aId, bId) {
  if (aId === bId) return 0;
  const key = distanceKey(aId, bId);
  const manual = state.distances[key];
  if (typeof manual === "number" && !isNaN(manual)) return manual;
  const baked = DEFAULT_DISTANCE_MAP[key];
  if (typeof baked === "number" && !isNaN(baked)) return baked;
  return DEFAULT_DISTANCE;
}

function getDistanceSource(aId, bId) {
  if (aId === bId) return t("sourceIdentical");
  if (hasCustomDistance(aId, bId)) return t("sourceManual");
  if (hasBakedDistance(aId, bId)) return "UEX";
  return t("sourceDefault");
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
    cargoItems: mission.cargoItems || [],
    reward: mission.reward,
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

function removeMission(id) {
  state.missions = state.missions.filter((m) => m.id !== id);
  saveState();
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
function computeUniqueLocationIds(missions) {
  const set = new Set();
  missions.forEach((m) => {
    (m.cargoItems || []).forEach((item) => {
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

function optimizeRoute(missions, startId) {
  if (missions.length === 0) return { error: t("selectMissionError") };

  const locIds = computeUniqueLocationIds(missions);
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
      const pickupItems = (m.cargoItems || []).filter((item) => item.pickupId === locId);
      if (pickupItems.length) actions.push({ type: "pickup", mission: m, items: pickupItems });
      const dropoffItems = (m.cargoItems || []).filter((item) => item.dropoffId === locId);
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

// =========================================================================
// Rendu DOM
// =========================================================================
function locationLabel(loc) {
  return loc ? `${loc.name} (${loc.category})` : "?";
}

function locationSearchLabel(loc) {
  return `${loc.name} (${loc.category})`;
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
  const ship = getSelectedShip();
  el.textContent = ship ? t("shipCapacityPrefix", { scu: ship.scu }) : t("shipCapacityNone");
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
      renderMissionsTable();
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
        const pickupLoc = getLocationById(item.pickupId);
        const dropoffLoc = getLocationById(item.dropoffId);
        const route = pickupLoc && dropoffLoc ? ` (${pickupLoc.name} → ${dropoffLoc.name})` : "";
        line.textContent = `${item.quantity || "?"} SCU — ${item.commodity || "?"}${route}`;
        tdCargo.appendChild(line);
      });
    } else {
      tdCargo.textContent = "-";
    }
    tr.appendChild(tdCargo);

    const tdReward = document.createElement("td");
    tdReward.textContent = m.reward != null && m.reward !== "" ? `${m.reward} aUEC` : "-";
    tr.appendChild(tdReward);

    const tdActions = document.createElement("td");
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "btn-secondary";
    doneBtn.textContent = t("completeBtn");
    doneBtn.addEventListener("click", () => {
      m.completed = true;
      saveState();
      renderAll();
    });
    tdActions.appendChild(doneBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-danger-sm";
    delBtn.textContent = t("deleteBtn");
    delBtn.addEventListener("click", () => {
      removeMission(m.id);
      renderAll();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

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

  // Ceci est la somme brute de toutes les récupérations, pas la charge réelle
  // à un instant donné (on décharge en cours de route, ce qui libère de la
  // place) : la vraie vérification de capacité se fait dans le résultat de
  // l'optimisation, une fois l'ordre du trajet connu.
  const capacityEl = document.getElementById("cargo-capacity-status");
  const ship = getSelectedShip();
  capacityEl.className = "hint";
  capacityEl.textContent = ship
    ? t("capacityWithShip", { cargo: totalCargo, shipName: ship.name, shipScu: ship.scu })
    : t("capacityNoShip", { cargo: totalCargo });
}

function renderHistoryTable() {
  const tbody = document.getElementById("history-tbody");
  tbody.innerHTML = "";
  const missions = historyMissions();
  missions.forEach((m) => {
    const tr = document.createElement("tr");

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
        const pickupLoc = getLocationById(item.pickupId);
        const dropoffLoc = getLocationById(item.dropoffId);
        const route = pickupLoc && dropoffLoc ? ` (${pickupLoc.name} → ${dropoffLoc.name})` : "";
        line.textContent = `${item.quantity || "?"} SCU — ${item.commodity || "?"}${route}`;
        tdCargo.appendChild(line);
      });
    } else {
      tdCargo.textContent = "-";
    }
    tr.appendChild(tdCargo);

    const tdReward = document.createElement("td");
    tdReward.textContent = m.reward != null && m.reward !== "" ? `${m.reward} aUEC` : "-";
    tr.appendChild(tdReward);

    const tdActions = document.createElement("td");
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn-secondary";
    restoreBtn.textContent = t("restoreBtn");
    restoreBtn.addEventListener("click", () => {
      m.completed = false;
      saveState();
      renderAll();
    });
    tdActions.appendChild(restoreBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-danger-sm";
    delBtn.textContent = t("deleteBtn");
    delBtn.addEventListener("click", () => {
      removeMission(m.id);
      renderAll();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  const summary = document.getElementById("history-summary");
  const totalReward = missions.reduce((s, m) => s + (Number(m.reward) || 0), 0);
  summary.textContent = missions.length
    ? t("historySummary", { count: missions.length, reward: totalReward })
    : t("noHistoryYet");
}

function renderDistanceEditor() {
  const container = document.getElementById("distance-editor");
  container.innerHTML = "";
  const locIds = computeUniqueLocationIds(activeMissions());
  if (locIds.length < 2) {
    container.textContent = t("needTwoLocations");
    return;
  }
  const locs = locIds.map((id) => getLocationById(id)).filter(Boolean);
  locs.sort((a, b) => a.name.localeCompare(b.name));

  const pairs = [];
  for (let i = 0; i < locs.length; i++) {
    for (let j = i + 1; j < locs.length; j++) pairs.push([locs[i], locs[j]]);
  }

  const anyUexPair = pairs.some(([a, b]) => a.uexTerminalId && b.uexTerminalId);
  if (anyUexPair) {
    const bulkBtn = document.createElement("button");
    bulkBtn.type = "button";
    bulkBtn.className = "btn-secondary";
    bulkBtn.textContent = t("fillMissingDistancesBtn");
    bulkBtn.addEventListener("click", async () => {
      bulkBtn.disabled = true;
      bulkBtn.textContent = t("fetchingInProgress");
      await syncMissingDistances((done, total) => {
        bulkBtn.textContent = t("fetchingProgress", { done, total });
      });
      renderDistanceEditor();
    });
    container.appendChild(bulkBtn);
  }

  const table = document.createElement("table");
  table.className = "distance-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `<tr><th>${t("colLocA")}</th><th>${t("colLocB")}</th><th>${t("colDistanceGm")}</th><th>${t("colSource")}</th><th></th></tr>`;
  table.appendChild(thead);
  const tbody = document.createElement("tbody");

  pairs.forEach(([a, b]) => {
    const tr = document.createElement("tr");
    const tdA = document.createElement("td");
    tdA.textContent = a.name;
    const tdB = document.createElement("td");
    tdB.textContent = b.name;
    const tdInput = document.createElement("td");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "any";
    input.placeholder = String(DEFAULT_DISTANCE);
    input.value = getDistance(a.id, b.id);

    const tdSource = document.createElement("td");
    tdSource.className = "hint";

    const refreshSource = () => {
      tdSource.textContent = getDistanceSource(a.id, b.id);
    };
    refreshSource();

    input.addEventListener("change", () => {
      setDistance(a.id, b.id, input.value);
      if (input.value === "") input.value = getDistance(a.id, b.id);
      refreshSource();
    });
    tdInput.appendChild(input);
    tr.appendChild(tdA);
    tr.appendChild(tdB);
    tr.appendChild(tdInput);
    tr.appendChild(tdSource);

    const tdAction = document.createElement("td");
    if (a.uexTerminalId && b.uexTerminalId) {
      const uexBtn = document.createElement("button");
      uexBtn.type = "button";
      uexBtn.className = "btn-secondary";
      uexBtn.textContent = t("viaUexBtn");
      uexBtn.addEventListener("click", async () => {
        uexBtn.disabled = true;
        try {
          const d = await fetchUexDistance(a.uexTerminalId, b.uexTerminalId);
          input.value = d;
          setDistance(a.id, b.id, d);
          refreshSource();
        } catch (e) {
          alert(t("uexDistanceError", { msg: e.message }));
        }
        uexBtn.disabled = false;
      });
      tdAction.appendChild(uexBtn);
    }
    tr.appendChild(tdAction);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = t("defaultDistanceNote", { default: DEFAULT_DISTANCE });
  container.appendChild(note);

  filterDistanceRows();
}

// Filtre en direct les lignes de la table des distances par nom de lieu
// (n'importe lequel des deux lieux de la paire), sans tout re-rendre.
function filterDistanceRows() {
  const filterInput = document.getElementById("distance-filter");
  const query = filterInput.value.trim().toLowerCase();
  document.querySelectorAll("#distance-editor .distance-table tbody tr").forEach((tr) => {
    const matches = !query || tr.textContent.toLowerCase().includes(query);
    tr.style.display = matches ? "" : "none";
  });
}

function renderRouteResult(result) {
  const container = document.getElementById("route-result");
  container.innerHTML = "";

  if (!result) return;

  if (result.error) {
    const p = document.createElement("p");
    p.className = "error";
    p.textContent = result.error;
    container.appendChild(p);
    return;
  }

  if (result.approximate) {
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
  const loadP = document.createElement("p");
  if (ship) {
    const over = result.maxCargoLoad > ship.scu;
    loadP.className = over ? "cargo-overload" : "cargo-ok";
    loadP.textContent = over
      ? t("maxLoadOverload", { load: result.maxCargoLoad, scu: ship.scu, over: roundScu(result.maxCargoLoad - ship.scu) })
      : t("maxLoadOk", { load: result.maxCargoLoad, scu: ship.scu });
  } else {
    loadP.className = "hint";
    loadP.textContent = t("maxLoadNoShip", { load: result.maxCargoLoad });
  }
  container.appendChild(loadP);

  const ol = document.createElement("ol");
  ol.className = "route-steps";
  result.steps.forEach((step) => {
    const li = document.createElement("li");
    const loc = getLocationById(step.locId);
    const header = document.createElement("div");
    header.className = "route-step-header";
    header.textContent = locationLabel(loc);
    if (step.legDistance) {
      const legSpan = document.createElement("span");
      legSpan.className = "route-leg";
      legSpan.textContent = ` (+${step.legDistance} Gm)`;
      header.appendChild(legSpan);
    }
    const loadSpan = document.createElement("span");
    if (ship) {
      const overHere = step.cargoLoad > ship.scu;
      loadSpan.className = overHere ? "route-load route-load-overload" : "route-load";
      loadSpan.textContent = t("onBoardWithShip", { load: step.cargoLoad, scu: ship.scu });
    } else {
      loadSpan.className = "route-load";
      loadSpan.textContent = t("onBoardNoShip", { load: step.cargoLoad });
    }
    header.appendChild(loadSpan);
    li.appendChild(header);

    if (step.actions.length) {
      const ul = document.createElement("ul");
      ul.className = "route-actions";
      step.actions.forEach((a) => {
        const actionLi = document.createElement("li");
        actionLi.className = a.type === "pickup" ? "action-pickup" : "action-dropoff";
        actionLi.textContent = `${a.type === "pickup" ? t("pickupAction") : t("dropoffAction")} — ${a.mission.name}`;

        const items = a.items || [];
        if (items.length) {
          const itemsUl = document.createElement("ul");
          itemsUl.className = "route-cargo-items";
          items.forEach((item) => {
            const itemLi = document.createElement("li");
            itemLi.textContent = t("scuOf", { qty: item.quantity || "?", commodity: item.commodity || "?" });
            itemsUl.appendChild(itemLi);
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
}

function renderUexStatus() {
  const status = document.getElementById("uex-status");
  if (state.uexLocations.length) {
    const date = new Date(state.uexSyncedAt).toLocaleString(getLang() === "en" ? "en-US" : "fr-FR");
    status.textContent = t("uexLocationsLoaded", { count: state.uexLocations.length, date });
  } else {
    status.textContent = t("uexLocationsDefault", { count: DEFAULT_LOCATIONS.length });
  }
}

function renderAll() {
  refreshAllLocationSelects();
  renderShipOptions();
  renderShipCapacity();
  renderMissionsTable();
  renderHistoryTable();
  renderDistanceEditor();
  renderUexStatus();
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

function createCargoFieldRow(commodity, quantity, pickupText, dropoffText) {
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

// Le nom de lieu lu par l'OCR ne correspond pas toujours exactement à un
// lieu de la base (variante de nom, casse, mot manquant) : on tente une
// correspondance exacte, puis approximative, puis floue (distance d'édition).
function looseLocationMatch(rawText) {
  const cleaned = rawText.trim();
  if (!cleaned) return null;
  const exact = findLocationByLabel(cleaned);
  if (exact) return exact;
  const lower = cleaned.toLowerCase();
  const byName = allLocations().find((loc) => loc.name.toLowerCase() === lower);
  if (byName) return byName;
  const bySubstring = allLocations().find(
    (loc) => loc.name.toLowerCase().includes(lower) || lower.includes(loc.name.toLowerCase())
  );
  if (bySubstring) return bySubstring;
  const fuzzy = fuzzyLocationMatch(cleaned);
  if (fuzzy) return fuzzy;
  return progressiveTrimMatch(cleaned);
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
  const buttons = group.querySelectorAll(".tab-btn");
  const panels = group.querySelectorAll(".tab-panel");
  buttons.forEach((b) => b.classList.remove("active"));
  panels.forEach((p) => (p.style.display = "none"));
  panel.style.display = "";
  const btn = Array.from(buttons).find((b) => b.dataset.tab === tabId);
  if (btn) btn.classList.add("active");
}

function applyOcrResultToForm(parsed) {
  if (parsed.name) document.getElementById("mission-name").value = parsed.name;
  if (parsed.giver) document.getElementById("mission-giver").value = parsed.giver;
  if (parsed.reward) document.getElementById("mission-reward").value = parsed.reward;
  if (parsed.cargoItems && parsed.cargoItems.length) {
    const container = document.getElementById("cargo-fields");
    container.innerHTML = "";
    parsed.cargoItems.forEach((item) => {
      const pickupLoc = looseLocationMatch(item.pickupText || "");
      const dropoffLoc = looseLocationMatch(item.dropoffText || "");
      createCargoFieldRow(
        item.commodity,
        item.quantity,
        pickupLoc ? locationSearchLabel(pickupLoc) : item.pickupText,
        dropoffLoc ? locationSearchLabel(dropoffLoc) : item.dropoffText
      );
    });
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
    warn.className = "hint ocr-approx-warning";
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
}

async function processOcrImage(blob) {
  const status = document.getElementById("ocr-status");
  const preview = document.getElementById("ocr-preview");

  preview.src = URL.createObjectURL(blob);
  preview.style.display = "block";
  status.textContent = t("ocrRecognizing");

  try {
    const rawText = await runOcrOnImage(blob);
    const parsed = parseOcrText(rawText);
    status.textContent = t("ocrRecognized");
    renderOcrResult(rawText, parsed);
  } catch (e) {
    status.textContent = t("ocrError", { msg: e.message });
  }
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
  langToggle.textContent = getLang() === "en" ? "FR" : "EN";
  langToggle.addEventListener("click", () => {
    setLang(getLang() === "en" ? "fr" : "en");
    langToggle.textContent = getLang() === "en" ? "FR" : "EN";
    applyStaticTranslations();
    // Rafraîchit aussi les textes des champs marchandise déjà présents dans
    // le formulaire (leurs placeholders ne sont pas couverts par data-i18n).
    document.querySelectorAll(".cargo-commodity-input").forEach((i) => (i.placeholder = t("cargoCommodityPlaceholder")));
    document.querySelectorAll(".cargo-quantity-input").forEach((i) => (i.placeholder = t("cargoScuPlaceholder")));
    document.querySelectorAll(".cargo-pickup-input").forEach((i) => (i.placeholder = t("cargoPickupPlaceholder")));
    document.querySelectorAll(".cargo-dropoff-input").forEach((i) => (i.placeholder = t("cargoDropoffPlaceholder")));
    renderAll();
  });

  document.getElementById("add-cargo-btn").addEventListener("click", () => {
    createCargoFieldRow();
  });

  document.getElementById("distance-filter").addEventListener("input", filterDistanceRows);

  // Chaque groupe ".tabs" bascule indépendamment des autres groupes présents
  // sur la page (ex : les onglets Nouvelle mission/Missions n'affectent pas
  // ceux de Distances/Optimisation).
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  document.getElementById("ship-select").addEventListener("change", (e) => {
    state.selectedShip = e.target.value;
    saveState();
    renderShipCapacity();
    renderMissionsTable();
  });

  const ocrDropzone = document.getElementById("ocr-dropzone");
  const ocrFileInput = document.getElementById("ocr-file-input");

  ocrDropzone.addEventListener("click", () => ocrFileInput.click());

  ocrFileInput.addEventListener("change", () => {
    const file = ocrFileInput.files[0];
    if (file) processOcrImage(file);
  });

  ocrDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    ocrDropzone.classList.add("dragover");
  });
  ocrDropzone.addEventListener("dragleave", () => ocrDropzone.classList.remove("dragover"));
  ocrDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    ocrDropzone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) processOcrImage(file);
  });

  document.addEventListener("paste", (e) => {
    const items = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (items.length === 0) return;
    const blob = items[0].getAsFile();
    if (blob) processOcrImage(blob);
  });

  document.getElementById("mission-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("mission-name").value.trim();
    const giver = document.getElementById("mission-giver").value.trim();
    const reward = document.getElementById("mission-reward").value;

    const rows = getCargoFieldValues();
    if (rows.length === 0) {
      alert(t("addAtLeastOneCargoError"));
      return;
    }

    const cargoItems = [];
    for (const row of rows) {
      const pickupLoc = findLocationByLabel(row.pickupText);
      const dropoffLoc = findLocationByLabel(row.dropoffText);
      if (!pickupLoc || !dropoffLoc) {
        alert(t("locationNotFoundError", { commodity: row.commodity || "?" }));
        return;
      }
      cargoItems.push({
        commodity: row.commodity,
        quantity: row.quantity,
        pickupId: pickupLoc.id,
        dropoffId: dropoffLoc.id,
      });
    }

    addMission({ name, giver, cargoItems, reward });
    e.target.reset();
    resetCargoFields();
    renderAll();
  });

  document.getElementById("add-location-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-location-name");
    const categorySelect = document.getElementById("new-location-category");
    const loc = addCustomLocation(nameInput.value, categorySelect.value);
    if (loc) {
      nameInput.value = "";
      refreshAllLocationSelects();
    }
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

  document.getElementById("optimize-btn").addEventListener("click", () => {
    const startId = document.getElementById("start-location").value || null;
    const included = activeMissions().filter((m) => m.included);
    const result = optimizeRoute(included, startId);
    renderRouteResult(result);
  });

  document.getElementById("reset-all").addEventListener("click", () => {
    if (confirm(t("confirmResetAll"))) {
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      renderAll();
    }
  });

  document.getElementById("uex-sync-all-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    const status = document.getElementById("uex-status");
    btn.disabled = true;
    try {
      btn.textContent = t("syncingLocations");
      await syncUexLocations();
      renderAll();

      btn.textContent = t("syncingCommodities");
      await syncUexCommodities();

      btn.textContent = t("syncingCompanies");
      await syncUexCompanies();

      btn.textContent = t("syncingShips");
      await syncUexShips();
      renderAll();

      btn.textContent = t("syncingDistances");
      const fetched = await syncMissingDistances((done, total) => {
        btn.textContent = t("syncingDistancesProgress", { done, total });
      });
      renderDistanceEditor();
      status.textContent = t("syncSummary", {
        locs: state.uexLocations.length,
        commodities: state.uexCommodities.length,
        companies: state.uexCompanies.length,
        ships: state.uexShips.length,
        fetched,
      });
    } catch (err) {
      alert(t("syncFailed", { msg: err.message }));
    }
    btn.disabled = false;
    btn.textContent = t("syncAllBtn");
  });
});
