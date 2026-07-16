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

// Échange x/y d'un module dont FleetYards signale une rotation à plat
// (90 ou 270° autour de l'axe vertical) — z (hauteur) reste inchangé, une
// rotation à plat ne joue jamais sur la hauteur. Une rotation de 180° (ou
// l'absence de rotation) ne change pas l'empreinte au sol, donc ne fait
// rien ici.
function rotateFlatDimensions(dimensions, rotation) {
  if (!dimensions) return dimensions;
  const normalized = ((rotation || 0) % 180 + 180) % 180;
  if (normalized !== 90) return dimensions;
  return { x: dimensions.y, y: dimensions.x, z: dimensions.z };
}

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
      // FleetYards donne dimensions.x/y dans le repère LOCAL du module (avant
      // rotation) ; h.rotation (relevé jusqu'ici à 90 ou 270 sur Carrack,
      // Caterpillar, Hull C) tourne le module à plat autour de l'axe vertical
      // et échange donc x/y au sol — z (hauteur) n'est jamais affecté par une
      // rotation à plat. Sans cet échange, le module "nez" du Caterpillar par
      // exemple gardait une empreinte au sol tournée de 90° par rapport à ce
      // qu'affiche fleetyards.net/tools/cargo-grids/.
      dimensions: rotateFlatDimensions(h.dimensions, h.rotation),
      capacity: h.capacity,
      maxContainerSize: h.maxContainerSize ? h.maxContainerSize.size : null,
      // Position relative de ce module dans le vaisseau — fiable pour les
      // vaisseaux aux modules tous différents (ex. Hull B, dont les noms de
      // hardpoint encodent même la position : "bottom_front_left_lower"...),
      // mais identique entre plusieurs instances d'un même module répété
      // (ex. les 4 baies du Caterpillar) puisqu'il s'agit alors de l'offset
      // local au préfab répété, pas d'une position absolue sur le vaisseau —
      // voir js/cargo-viewer.js qui détecte ce cas et retombe sur une
      // disposition en rangée pour les modules à l'offset dupliqué. Exprimé
      // dans le repère du vaisseau (déjà après rotation), contrairement à
      // dimensions : pas d'échange x/y à faire ici.
      offset: h.offset || null,
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
