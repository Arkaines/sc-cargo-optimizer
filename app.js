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
    settings: { apiKey: "" },
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
    return m;
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
  return { ...rest, cargoItems };
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
      settings: { apiKey: (parsed.settings && parsed.settings.apiKey) || "" },
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
  if (aId === bId) return "identique";
  if (hasCustomDistance(aId, bId)) return "manuel";
  if (hasBakedDistance(aId, bId)) return "UEX";
  return "défaut";
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
  };
  state.missions.push(m);
  saveState();
  return m;
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
  if (missions.length === 0) return { error: "Sélectionne au moins une mission." };

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
    return {
      error:
        "Impossible de trouver un ordre valide : vérifie que le point de départ choisi n'est pas un dépôt sans récupération préalable.",
    };
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
  none.textContent = "-- Aucun --";
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
  el.textContent = ship ? `Capacité : ${ship.scu} SCU` : "Sélectionne un vaisseau pour voir sa capacité.";
}

function renderStartLocationOptions() {
  const sel = document.getElementById("start-location");
  const prev = sel.value;
  const usedIds = computeUniqueLocationIds(state.missions.filter((m) => m.included));
  sel.innerHTML = "";
  const free = document.createElement("option");
  free.value = "";
  free.textContent = "Libre (meilleur choix automatique)";
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
  state.missions.forEach((m) => {
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
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-danger-sm";
    delBtn.textContent = "Supprimer";
    delBtn.addEventListener("click", () => {
      removeMission(m.id);
      renderAll();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  const summary = document.getElementById("missions-summary");
  const included = state.missions.filter((m) => m.included);
  const totalCargo = included.reduce(
    (s, m) => s + (m.cargoItems || []).reduce((s2, item) => s2 + (Number(item.quantity) || 0), 0),
    0
  );
  const totalReward = included.reduce((s, m) => s + (Number(m.reward) || 0), 0);
  summary.textContent = state.missions.length
    ? `${included.length}/${state.missions.length} mission(s) sélectionnée(s) — ${totalCargo} SCU — ${totalReward} aUEC`
    : "Aucune mission enregistrée pour l'instant.";

  // Ceci est la somme brute de toutes les récupérations, pas la charge réelle
  // à un instant donné (on décharge en cours de route, ce qui libère de la
  // place) : la vraie vérification de capacité se fait dans le résultat de
  // l'optimisation, une fois l'ordre du trajet connu.
  const capacityEl = document.getElementById("cargo-capacity-status");
  const ship = getSelectedShip();
  capacityEl.className = "hint";
  capacityEl.textContent = ship
    ? `${totalCargo} SCU à transporter au total (${ship.name}, ${ship.scu} SCU) — la charge réelle à bord dépend de l'ordre du trajet, vérifie via "Optimiser la route".`
    : `${totalCargo} SCU à transporter au total — sélectionne un vaisseau (menu de gauche) puis optimise la route pour vérifier que ça tient.`;
}

function renderDistanceEditor() {
  const container = document.getElementById("distance-editor");
  container.innerHTML = "";
  const locIds = computeUniqueLocationIds(state.missions);
  if (locIds.length < 2) {
    container.textContent = "Ajoute au moins deux lieux différents via tes missions pour renseigner des distances.";
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
    bulkBtn.textContent = "Remplir les distances manquantes via UEX";
    bulkBtn.addEventListener("click", async () => {
      bulkBtn.disabled = true;
      bulkBtn.textContent = "Récupération en cours...";
      await syncMissingDistances((done, total) => {
        bulkBtn.textContent = `Récupération en cours... ${done}/${total}`;
      });
      renderDistanceEditor();
    });
    container.appendChild(bulkBtn);
  }

  const table = document.createElement("table");
  table.className = "distance-table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Lieu A</th><th>Lieu B</th><th>Distance</th><th>Source</th><th></th></tr>";
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
      uexBtn.textContent = "via UEX";
      uexBtn.addEventListener("click", async () => {
        uexBtn.disabled = true;
        try {
          const d = await fetchUexDistance(a.uexTerminalId, b.uexTerminalId);
          input.value = d;
          setDistance(a.id, b.id, d);
          refreshSource();
        } catch (e) {
          alert(`Impossible de récupérer la distance UEX : ${e.message}`);
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
  note.textContent = `Les paires sans donnée UEX ni valeur manuelle utilisent une valeur par défaut de ${DEFAULT_DISTANCE}.`;
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
    p.textContent = `${result.stopCount} lieux distincts : résultat approché (heuristique), pas garanti optimal à 100%.`;
    container.appendChild(p);
  }

  const totalP = document.createElement("p");
  totalP.className = "route-total";
  totalP.textContent = `Distance totale estimée : ${result.total} — ${result.steps.length} arrêt(s)`;
  container.appendChild(totalP);

  const ship = getSelectedShip();
  const loadP = document.createElement("p");
  if (ship) {
    const over = result.maxCargoLoad > ship.scu;
    loadP.className = over ? "cargo-overload" : "cargo-ok";
    loadP.textContent = over
      ? `Charge maximale sur le trajet : ${result.maxCargoLoad} / ${ship.scu} SCU — dépassement de ${roundScu(result.maxCargoLoad - ship.scu)} SCU à un moment du trajet !`
      : `Charge maximale sur le trajet : ${result.maxCargoLoad} / ${ship.scu} SCU — ça tient à tout moment du trajet.`;
  } else {
    loadP.className = "hint";
    loadP.textContent = `Charge maximale sur le trajet : ${result.maxCargoLoad} SCU — sélectionne un vaisseau (menu de gauche) pour vérifier que ça tient.`;
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
      legSpan.textContent = ` (+${step.legDistance})`;
      header.appendChild(legSpan);
    }
    const loadSpan = document.createElement("span");
    if (ship) {
      const overHere = step.cargoLoad > ship.scu;
      loadSpan.className = overHere ? "route-load route-load-overload" : "route-load";
      loadSpan.textContent = ` — ${step.cargoLoad} SCU à bord sur ${ship.scu} disponibles`;
    } else {
      loadSpan.className = "route-load";
      loadSpan.textContent = ` — ${step.cargoLoad} SCU à bord`;
    }
    header.appendChild(loadSpan);
    li.appendChild(header);

    if (step.actions.length) {
      const ul = document.createElement("ul");
      ul.className = "route-actions";
      step.actions.forEach((a) => {
        const actionLi = document.createElement("li");
        actionLi.className = a.type === "pickup" ? "action-pickup" : "action-dropoff";
        actionLi.textContent = `${a.type === "pickup" ? "Récupérer" : "Déposer"} — ${a.mission.name}`;

        const items = a.items || [];
        if (items.length) {
          const itemsUl = document.createElement("ul");
          itemsUl.className = "route-cargo-items";
          items.forEach((item) => {
            const itemLi = document.createElement("li");
            itemLi.textContent = `${item.quantity || "?"} SCU de ${item.commodity || "?"}`;
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
    const date = new Date(state.uexSyncedAt).toLocaleString("fr-FR");
    status.textContent = `${state.uexLocations.length} lieux chargés depuis UEX Corp (dernière synchro : ${date}).`;
  } else {
    status.textContent = `${DEFAULT_LOCATIONS.length} lieux intégrés par défaut (données UEX Corp). Utilise "Tout synchroniser" pour les rafraîchir.`;
  }
}

function renderAll() {
  refreshAllLocationSelects();
  renderShipOptions();
  renderShipCapacity();
  renderMissionsTable();
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
  commodityInput.placeholder = "Marchandise";
  commodityInput.autocomplete = "off";
  commodityInput.className = "cargo-commodity-input";
  if (commodity) commodityInput.value = commodity;
  row.appendChild(commodityInput);

  const quantityInput = document.createElement("input");
  quantityInput.type = "number";
  quantityInput.min = "0";
  quantityInput.step = "any";
  quantityInput.placeholder = "SCU";
  quantityInput.className = "cargo-quantity-input";
  if (quantity) quantityInput.value = quantity;
  row.appendChild(quantityInput);

  createLocationSubInput(row, "cargo-pickup-input", "Lieu de récupération", pickupText);
  createLocationSubInput(row, "cargo-dropoff-input", "Lieu de dépôt", dropoffText);

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
  document.getElementById("mission-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderOcrResult(rawText, parsed) {
  const container = document.getElementById("ocr-result");
  container.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "ocr-summary";
  const rows = [
    ["Nom", parsed.name],
    ["Donneur", parsed.giver],
    ["Récompense", parsed.reward ? `${parsed.reward} aUEC` : ""],
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
    warn.textContent =
      "⚠ Marchandise disponible à plusieurs lieux de retrait : la quantité est répartie également à titre d'estimation — vérifie le stock réel en jeu et corrige les quantités si besoin.";
    container.appendChild(warn);
  }

  (parsed.cargoItems || []).forEach((item) => {
    const row = document.createElement("div");
    row.className = "ocr-summary-row";
    const approxNote = item.approximate ? " (estimation)" : "";
    row.textContent = `${item.quantity || "?"} SCU de ${item.commodity || "?"} : ${item.pickupText || "?"} → ${item.dropoffText || "?"}${approxNote}`;
    summary.appendChild(row);
  });
  container.appendChild(summary);

  const pre = document.createElement("pre");
  pre.className = "ocr-raw-text";
  pre.textContent = rawText.trim() || "(aucun texte reconnu)";
  container.appendChild(pre);

  const hasAnyField =
    parsed.name || parsed.giver || parsed.reward || (parsed.cargoItems && parsed.cargoItems.length);

  if (hasAnyField) {
    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "btn-primary";
    useBtn.textContent = "Utiliser ces champs dans le formulaire";
    useBtn.addEventListener("click", () => applyOcrResultToForm(parsed));
    container.appendChild(useBtn);
  } else {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Aucun champ reconnu — vérifie le texte brut ci-dessous et complète à la main.";
    container.appendChild(note);
  }
}

async function processOcrImage(blob) {
  const status = document.getElementById("ocr-status");
  const preview = document.getElementById("ocr-preview");

  preview.src = URL.createObjectURL(blob);
  preview.style.display = "block";
  status.textContent = "Reconnaissance en cours...";

  try {
    const rawText = await runOcrOnImage(blob);
    const parsed = parseOcrText(rawText);
    status.textContent = "Texte reconnu — vérifie avant d'utiliser.";
    renderOcrResult(rawText, parsed);
  } catch (e) {
    status.textContent = `Erreur OCR : ${e.message}`;
  }
}

// =========================================================================
// Câblage des événements
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  renderAll();
  resetCargoFields();

  document.getElementById("add-cargo-btn").addEventListener("click", () => {
    createCargoFieldRow();
  });

  document.getElementById("distance-filter").addEventListener("input", filterDistanceRows);

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
      alert("Ajoute au moins une marchandise avec son lieu de récupération et de dépôt.");
      return;
    }

    const cargoItems = [];
    for (const row of rows) {
      const pickupLoc = findLocationByLabel(row.pickupText);
      const dropoffLoc = findLocationByLabel(row.dropoffText);
      if (!pickupLoc || !dropoffLoc) {
        alert(
          `Le lieu de récupération et le lieu de dépôt doivent être choisis dans la liste proposée (marchandise "${row.commodity || "?"}").`
        );
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
    state.missions.forEach((m) => (m.included = true));
    saveState();
    renderAll();
  });
  document.getElementById("deselect-all-missions").addEventListener("click", () => {
    state.missions.forEach((m) => (m.included = false));
    saveState();
    renderAll();
  });

  document.getElementById("optimize-btn").addEventListener("click", () => {
    const startId = document.getElementById("start-location").value || null;
    const included = state.missions.filter((m) => m.included);
    const result = optimizeRoute(included, startId);
    renderRouteResult(result);
  });

  document.getElementById("reset-all").addEventListener("click", () => {
    if (confirm("Supprimer toutes les missions, lieux personnalisés et distances enregistrées ?")) {
      localStorage.removeItem(STORAGE_KEY);
      state = loadState();
      renderAll();
    }
  });

  const apiKeyInput = document.getElementById("uex-api-key");
  apiKeyInput.value = state.settings.apiKey || "";
  apiKeyInput.addEventListener("change", () => {
    state.settings.apiKey = apiKeyInput.value.trim();
    saveState();
  });

  document.getElementById("uex-sync-all-btn").addEventListener("click", async (e) => {
    const btn = e.target;
    const status = document.getElementById("uex-status");
    btn.disabled = true;
    try {
      btn.textContent = "Synchronisation des lieux...";
      await syncUexLocations();
      renderAll();

      btn.textContent = "Synchronisation des marchandises...";
      await syncUexCommodities();

      btn.textContent = "Synchronisation des entreprises...";
      await syncUexCompanies();

      btn.textContent = "Synchronisation des vaisseaux...";
      await syncUexShips();
      renderAll();

      btn.textContent = "Synchronisation des distances...";
      const fetched = await syncMissingDistances((done, total) => {
        btn.textContent = `Synchronisation des distances... ${done}/${total}`;
      });
      renderDistanceEditor();
      status.textContent =
        `${state.uexLocations.length} lieux, ${state.uexCommodities.length} marchandises, ` +
        `${state.uexCompanies.length} entreprises, ${state.uexShips.length} vaisseaux à jour — ` +
        `${fetched} distance(s) manquante(s) récupérée(s) via UEX.`;
    } catch (err) {
      alert(`Échec de la synchronisation UEX : ${err.message}`);
    }
    btn.disabled = false;
    btn.textContent = "Tout synchroniser (UEX Corp)";
  });
});
