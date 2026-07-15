"use strict";

// =========================================================================
// Intégration API FleetYards.net (https://api.fleetyards.net/v1/) — lecture
// seule, publique, sans clé requise. Fournit la vraie répartition des
// soutes de cargo par vaisseau (dimensions, capacité, taille de caisse max
// par module), bien plus précise que le seul chiffre SCU total d'UEX/RSI —
// utilisée pour l'onglet "Optimisation du cargo" (savoir où ranger chaque
// marchandise). Projet communautaire open source (GPL-3.0), crédité dans
// le README à côté d'UEX Corp et Star Citizen Wiki.
const FLEETYARDS_API_BASE = "https://api.fleetyards.net/v1";

// Quelques noms de vaisseaux diffèrent entre notre catalogue (UEX) et
// FleetYards — table d'alias FleetYards -> notre nom, construite au fil
// des écarts constatés (voir syncFleetyardsCargoHolds).
const FLEETYARDS_NAME_ALIASES = {
  "C2 Hercules": "C2 Hercules Starlifter",
  Genesis: "Genesis Starliner",
};

async function fleetyardsGet(path) {
  const res = await fetch(`${FLEETYARDS_API_BASE}/${path}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Erreur FleetYards (${res.status})`);
  return res.json();
}

// Récupère la liste complète des vaisseaux (paginée, ~240 par page) avec
// leurs soutes de cargo, et les indexe par NOTRE nom de vaisseau (celui du
// catalogue UEX) plutôt que par le nom FleetYards.
async function syncFleetyardsCargoHolds() {
  let page = 1;
  let all = [];
  for (;;) {
    const res = await fleetyardsGet(`models?perPage=240&page=${page}`);
    all = all.concat(res.items || []);
    const totalPages = res.meta && res.meta.pagination ? res.meta.pagination.totalPages : 1;
    if (page >= totalPages) break;
    page++;
  }

  const byOurName = {};
  all.forEach((ship) => {
    if (!ship.cargoHolds || !ship.cargoHolds.length) return;
    const ourName = FLEETYARDS_NAME_ALIASES[ship.name] || ship.name;
    byOurName[ourName] = ship.cargoHolds.map((h) => ({
      name: h.name,
      dimensions: h.dimensions,
      capacity: h.capacity,
      maxContainerSize: h.maxContainerSize ? h.maxContainerSize.size : null,
    }));
  });

  state.fleetyardsCargoHolds = byOurName;
  state.fleetyardsSyncedAt = Date.now();
  saveState();
  return byOurName;
}

// Soutes de cargo réelles pour un vaisseau donné (par nom), ou null si le
// catalogue FleetYards n'a pas encore été synchronisé ou ne connaît pas ce
// vaisseau (repli sur le chiffre SCU simple dans ce cas).
function getShipCargoHolds(shipName) {
  return (state.fleetyardsCargoHolds && state.fleetyardsCargoHolds[shipName]) || null;
}
