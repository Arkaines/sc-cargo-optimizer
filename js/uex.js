"use strict";

// =========================================================================
// Intégration API UEX Corp (https://uexcorp.space/api/documentation/)
// Lecture seule : terminaux (lieux), distances, marchandises, entreprises,
// vaisseaux. Ces endpoints répondent publiquement, sans clé API.
// =========================================================================
const UEX_API_BASE = "https://api.uexcorp.uk/2.0";

async function uexGet(path) {
  const res = await fetch(`${UEX_API_BASE}/${path}`, { headers: { Accept: "application/json" } });
  // Sans ce contrôle, une page d'erreur HTML (500, maintenance...) faisait
  // exploser res.json() en « Unexpected token < » — indéboguable. On échoue
  // proprement d'abord, comme scwiki.js et fleetyards.js le font déjà.
  if (!res.ok) throw new Error(`Erreur UEX (HTTP ${res.status})`);
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
    base += ` - ${t.star_system_name}`;
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
      orbitId: t.id_orbit || 0,
    });
  });
  return Array.from(byGroup.values());
}

async function syncUexLocations() {
  const terminals = await uexGet("terminals");
  const locations = buildUexLocations(terminals);
  state.uexLocations = locations;
  state.uexSyncedAt = Date.now();
  planetAnchorCache = null;
  saveState();
  return locations;
}

async function fetchUexDistance(terminalIdA, terminalIdB) {
  const data = await uexGet(
    `terminals_distances?id_terminal_origin=${terminalIdA}&id_terminal_destination=${terminalIdB}`
  );
  return Number(data.distance);
}

async function syncUexCommodities() {
  const commodities = await uexGet("commodities");
  const mapped = commodities
    .filter((c) => c.is_available)
    .map((c) => ({ name: c.name, kind: c.kind || "", illegal: !!c.is_illegal }));
  state.uexCommodities = mapped;
  saveState();
  return mapped;
}

async function syncUexCompanies() {
  const companies = await uexGet("companies");
  const mapped = companies.map((c) => ({ name: c.name, industry: c.industry || "" }));
  state.uexCompanies = mapped;
  saveState();
  return mapped;
}

// Vaisseaux spatiaux (hors véhicules terrestres) avec une capacité cargo non
// nulle. Un vaisseau non canonique (id_parent différent de son propre id)
// n'est gardé que si son SCU diffère de celui de son vaisseau de base : ça
// distingue une vraie variante à cargo distinct (ex. Ironclad Assault,
// Freelancer MAX) d'une variante purement peinture/édition qui partage le
// même SCU que le vaisseau de base (celle-là reste exclue).
async function syncUexShips() {
  const vehicles = await uexGet("vehicles");
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const mapped = vehicles
    .filter((v) => {
      if (v.is_ground_vehicle || !(v.scu > 0)) return false;
      if (v.id === v.id_parent) return true;
      const parent = byId.get(v.id_parent);
      return parent ? v.scu !== parent.scu : true;
    })
    .map((v) => ({ name: v.name, scu: v.scu, company: v.company_name || "" }));
  state.uexShips = mapped;
  saveState();
  return mapped;
}

// Complète via l'API les distances manquantes pour les paires de lieux utilisées
// par les missions enregistrées (ignore les paires déjà couvertes par les données
// de base ou déjà fixées manuellement). onProgress(done, total) est appelé à chaque paire.
async function syncMissingDistances(onProgress) {
  const locIds = computeUniqueLocationIds(state.missions);
  const locs = locIds.map((id) => getLocationById(id)).filter(Boolean);
  const pairs = [];
  for (let i = 0; i < locs.length; i++) {
    for (let j = i + 1; j < locs.length; j++) pairs.push([locs[i], locs[j]]);
  }
  let fetched = 0;
  for (let k = 0; k < pairs.length; k++) {
    const [a, b] = pairs[k];
    if (onProgress) onProgress(k + 1, pairs.length);
    if (!a.uexTerminalId || !b.uexTerminalId) continue;
    if (hasCustomDistance(a.id, b.id)) continue;
    if (distanceKey(a.id, b.id) in DEFAULT_DISTANCE_MAP) continue;
    try {
      const d = await fetchUexDistance(a.uexTerminalId, b.uexTerminalId);
      setDistance(a.id, b.id, d);
      fetched++;
    } catch (e) {
      console.error(`Distance UEX ${a.name} -> ${b.name} :`, e);
    }
  }
  return fetched;
}
