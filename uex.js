"use strict";

// =========================================================================
// Intégration API UEX Corp (https://uexcorp.space/api/documentation/)
// Lecture seule : liste des terminaux (pour les lieux) et distances entre
// terminaux. Ces endpoints répondent publiquement, la clé API est optionnelle
// (utile surtout pour des limites de débit plus confortables).
// =========================================================================
const UEX_API_BASE = "https://api.uexcorp.uk/2.0";

function uexHeaders() {
  const headers = { Accept: "application/json" };
  const key = state.settings && state.settings.apiKey;
  if (key) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

async function uexGet(path) {
  const res = await fetch(`${UEX_API_BASE}/${path}`, { headers: uexHeaders() });
  const json = await res.json();
  if (json.status !== "ok") {
    throw new Error(json.message || `Erreur UEX (${json.status})`);
  }
  return json.data;
}

function locationNameFromTerminal(t) {
  return (
    t.space_station_name ||
    t.outpost_name ||
    t.city_name ||
    t.moon_name ||
    t.planet_name ||
    t.displayname ||
    t.name
  );
}

function locationCategoryFromTerminal(t) {
  let base = "Planète";
  if (t.id_space_station) base = "Station";
  else if (t.id_outpost) base = "Avant-poste";
  else if (t.id_city) base = "Ville";
  else if (t.id_moon) base = "Lune (surface)";
  if (t.star_system_name && t.star_system_name !== "Stanton") {
    base += ` · ${t.star_system_name}`;
  }
  return base;
}

function groupKeyFromTerminal(t) {
  if (t.id_space_station) return `station-${t.id_space_station}`;
  if (t.id_outpost) return `outpost-${t.id_outpost}`;
  if (t.id_city) return `city-${t.id_city}`;
  if (t.id_moon) return `moon-${t.id_moon}`;
  if (t.id_planet) return `planet-${t.id_planet}`;
  return `terminal-${t.id}`;
}

// Un lieu par station/ville/avant-poste (dédupliqué), avec l'ID du terminal
// représentatif conservé pour interroger terminals_distances.
function buildUexLocations(terminals) {
  const byGroup = new Map();
  terminals.forEach((t) => {
    if (!t.is_available) return;
    const key = groupKeyFromTerminal(t);
    if (byGroup.has(key)) return;
    byGroup.set(key, {
      id: `uex-${key}`,
      name: locationNameFromTerminal(t),
      category: locationCategoryFromTerminal(t),
      uexTerminalId: t.id,
    });
  });
  return Array.from(byGroup.values());
}

async function syncUexLocations() {
  const terminals = await uexGet("terminals");
  const locations = buildUexLocations(terminals);
  state.uexLocations = locations;
  state.uexSyncedAt = Date.now();
  saveState();
  return locations;
}

async function fetchUexDistance(terminalIdA, terminalIdB) {
  const data = await uexGet(
    `terminals_distances?id_terminal_origin=${terminalIdA}&id_terminal_destination=${terminalIdB}`
  );
  return Number(data.distance);
}
