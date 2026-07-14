"use strict";

// =========================================================================
// Intégration API communautaire Star Citizen Wiki (https://api.star-citizen.wiki)
// Utilisée uniquement en secours, pour les lieux absents d'UEX Corp (petits
// avant-postes/points de livraison non suivis par UEX, qui se concentre sur
// les terminaux avec activité commerciale). Endpoints publics, sans clé API.
// =========================================================================
const SCWIKI_API_BASE = "https://api.star-citizen.wiki/api";
const SCWIKI_RELEVANT_TYPES = ["Outpost", "Manmade", "Moon", "Planet", "Settlement"];

async function syncScwikiLocations() {
  const pageSize = 200;
  let page = 1;
  let lastPage = 1;
  const collected = [];

  do {
    const res = await fetch(`${SCWIKI_API_BASE}/locations?page[size]=${pageSize}&page[number]=${page}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Erreur Star Citizen Wiki (${res.status})`);
    const json = await res.json();
    (json.data || []).forEach((loc) => {
      if (!loc.name || !SCWIKI_RELEVANT_TYPES.includes(loc.type && loc.type.classification)) return;
      collected.push({
        name: loc.name,
        type: loc.type.classification,
        parent: loc.parent && loc.parent.name !== "<= UNINITIALIZED =>" ? loc.parent.name : "",
        system: (loc.system || "").replace(/\s+System$/i, ""),
      });
    });
    lastPage = (json.meta && json.meta.last_page) || 1;
    page++;
  } while (page <= lastPage);

  state.scwikiLocations = collected;
  state.scwikiSyncedAt = Date.now();
  saveState();
  return collected;
}
