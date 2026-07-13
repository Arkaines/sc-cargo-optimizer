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
  };
}

// Ancien format : mission.pickupId/dropoffId (un seul lieu chacun).
// Nouveau format : mission.pickupIds/dropoffIds (tableaux, plusieurs lieux possibles).
function migrateMission(m) {
  return {
    ...m,
    pickupIds: m.pickupIds || (m.pickupId ? [m.pickupId] : []),
    dropoffIds: m.dropoffIds || (m.dropoffId ? [m.dropoffId] : []),
  };
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
    pickupIds: mission.pickupIds,
    dropoffIds: mission.dropoffIds,
    commodity: mission.commodity || "",
    cargo: mission.cargo,
    reward: mission.reward,
    included: true,
  };
  state.missions.push(m);
  saveState();
  return m;
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
    (m.pickupIds || []).forEach((id) => set.add(id));
    (m.dropoffIds || []).forEach((id) => set.add(id));
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

  // Chaque lieu de récupération doit être visité avant chaque lieu de dépôt
  // de la même mission (produit cartésien pickups x dropoffs).
  const constraints = [];
  missions.forEach((m) => {
    (m.pickupIds || []).forEach((pId) => {
      (m.dropoffIds || []).forEach((dId) => {
        if (pId === dId) return;
        constraints.push([idxOf[pId], idxOf[dId]]);
      });
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

  let total = 0;
  const steps = order.map((idx, i) => {
    if (i > 0) total += dist[order[i - 1]][idx];
    const locId = locIds[idx];
    const actions = [];
    missions.forEach((m) => {
      if ((m.pickupIds || []).includes(locId)) actions.push({ type: "pickup", mission: m });
      if ((m.dropoffIds || []).includes(locId)) actions.push({ type: "dropoff", mission: m });
    });
    return { locId, actions, legDistance: i > 0 ? dist[order[i - 1]][idx] : 0 };
  });

  return { steps, total, approximate, stopCount: n };
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

function renderCommodityDatalist() {
  const datalist = document.getElementById("commodities-datalist");
  datalist.innerHTML = "";
  DEFAULT_COMMODITIES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    datalist.appendChild(opt);
  });
}

function refreshAllLocationSelects() {
  renderLocationDatalist();
  renderCommodityDatalist();
  renderStartLocationOptions();
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
    });
    tdCheck.appendChild(cb);
    tr.appendChild(tdCheck);

    const tdName = document.createElement("td");
    tdName.textContent = m.name;
    tr.appendChild(tdName);

    const tdPickup = document.createElement("td");
    tdPickup.textContent = (m.pickupIds || [])
      .map((id) => locationLabel(getLocationById(id)))
      .join(", ");
    tr.appendChild(tdPickup);

    const tdDropoff = document.createElement("td");
    tdDropoff.textContent = (m.dropoffIds || [])
      .map((id) => locationLabel(getLocationById(id)))
      .join(", ");
    tr.appendChild(tdDropoff);

    const tdCommodity = document.createElement("td");
    tdCommodity.textContent = m.commodity || "-";
    tr.appendChild(tdCommodity);

    const tdCargo = document.createElement("td");
    tdCargo.textContent = m.cargo != null && m.cargo !== "" ? `${m.cargo} SCU` : "-";
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
  const totalCargo = included.reduce((s, m) => s + (Number(m.cargo) || 0), 0);
  const totalReward = included.reduce((s, m) => s + (Number(m.reward) || 0), 0);
  summary.textContent = state.missions.length
    ? `${included.length}/${state.missions.length} mission(s) sélectionnée(s) — ${totalCargo} SCU — ${totalReward} aUEC`
    : "Aucune mission enregistrée pour l'instant.";
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
    li.appendChild(header);

    if (step.actions.length) {
      const ul = document.createElement("ul");
      ul.className = "route-actions";
      step.actions.forEach((a) => {
        const actionLi = document.createElement("li");
        actionLi.className = a.type === "pickup" ? "action-pickup" : "action-dropoff";
        actionLi.textContent = `${a.type === "pickup" ? "Récupérer" : "Déposer"} — ${a.mission.name}`;
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
  renderMissionsTable();
  renderDistanceEditor();
  renderUexStatus();
  document.getElementById("route-result").innerHTML = "";
}

// =========================================================================
// Champs dynamiques (plusieurs lieux de récupération / dépôt par mission)
// =========================================================================
function createLocationFieldRow(containerId, value) {
  const container = document.getElementById(containerId);
  const row = document.createElement("div");
  row.className = "field-row";

  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("list", "locations-datalist");
  input.placeholder = "Tape pour chercher...";
  input.autocomplete = "off";
  input.className = "location-field-input";
  if (value) input.value = value;
  row.appendChild(input);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-remove-field";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (container.children.length === 0) createLocationFieldRow(containerId);
  });
  row.appendChild(removeBtn);

  container.appendChild(row);
  return row;
}

function resetLocationFields(containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  createLocationFieldRow(containerId);
}

function getLocationFieldValues(containerId) {
  const container = document.getElementById(containerId);
  return Array.from(container.querySelectorAll(".location-field-input"))
    .map((input) => input.value.trim())
    .filter((v) => v !== "");
}

// =========================================================================
// Câblage des événements
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
  renderAll();
  resetLocationFields("pickup-fields");
  resetLocationFields("dropoff-fields");

  document.getElementById("add-pickup-btn").addEventListener("click", () => {
    createLocationFieldRow("pickup-fields");
  });
  document.getElementById("add-dropoff-btn").addEventListener("click", () => {
    createLocationFieldRow("dropoff-fields");
  });

  document.getElementById("mission-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("mission-name").value.trim();
    const commodity = document.getElementById("mission-commodity").value.trim();
    const cargo = document.getElementById("mission-cargo").value;
    const reward = document.getElementById("mission-reward").value;

    const pickupTexts = getLocationFieldValues("pickup-fields");
    const dropoffTexts = getLocationFieldValues("dropoff-fields");

    if (pickupTexts.length === 0 || dropoffTexts.length === 0) {
      alert("Ajoute au moins un lieu de récupération et un lieu de dépôt.");
      return;
    }

    const pickupLocs = pickupTexts.map(findLocationByLabel);
    const dropoffLocs = dropoffTexts.map(findLocationByLabel);

    if (pickupLocs.some((l) => !l) || dropoffLocs.some((l) => !l)) {
      alert(
        "Un des lieux saisis n'a pas été reconnu : choisis-le dans la liste proposée (tape un nom puis sélectionne une suggestion)."
      );
      return;
    }

    addMission({
      name,
      pickupIds: pickupLocs.map((l) => l.id),
      dropoffIds: dropoffLocs.map((l) => l.id),
      commodity,
      cargo,
      reward,
    });
    e.target.reset();
    resetLocationFields("pickup-fields");
    resetLocationFields("dropoff-fields");
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

      btn.textContent = "Synchronisation des distances...";
      const fetched = await syncMissingDistances((done, total) => {
        btn.textContent = `Synchronisation des distances... ${done}/${total}`;
      });
      renderDistanceEditor();
      status.textContent = `${state.uexLocations.length} lieux à jour — ${fetched} distance(s) manquante(s) récupérée(s) via UEX.`;
    } catch (err) {
      alert(`Échec de la synchronisation UEX : ${err.message}`);
    }
    btn.disabled = false;
    btn.textContent = "Tout synchroniser (lieux + distances)";
  });
});
