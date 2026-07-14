"use strict";

// =========================================================================
// Traductions (FR/EN) de l'interface. Les données du joueur (noms de
// missions, marchandises, lieux...) ne sont jamais traduites, seulement le
// texte fixe de l'interface.
// =========================================================================
const LANG_KEY = "sc-cargo-optimizer-lang";

const TRANSLATIONS = {
  fr: {
    themeToggleLabel: "Basculer le thème clair/sombre",
    langToggleLabel: "Changer de langue",
    pageTitle: "Optimiseur de routes cargo — Star Citizen",
    appTitle: "Optimiseur de routes cargo",
    appSubtitle: "Enregistre tes missions de transport et calcule l'ordre optimal des arrêts.",
    poweredByPrefix: "Données fournies par l'API publique",

    myShipTitle: "Mon vaisseau",
    shipUsedLabel: "Vaisseau utilisé",
    noneOption: "-- Aucun --",
    shipCapacityPrefix: "Capacité : {scu} SCU",
    shipCapacityNone: "Sélectionne un vaisseau pour voir sa capacité.",

    syncAllBtn: "Tout synchroniser (UEX Corp)",
    syncingLocations: "Synchronisation des lieux...",
    syncingCommodities: "Synchronisation des marchandises...",
    syncingCompanies: "Synchronisation des entreprises...",
    syncingShips: "Synchronisation des vaisseaux...",
    syncingDistances: "Synchronisation des distances...",
    syncingDistancesProgress: "Synchronisation des distances... {done}/{total}",
    syncingScwiki: "Synchronisation des lieux (Star Citizen Wiki)...",
    syncSummary:
      "{locs} lieux, {commodities} marchandises, {companies} entreprises, {ships} vaisseaux à jour — {fetched} distance(s) manquante(s) récupérée(s) via UEX — {scwiki} lieux de secours (Star Citizen Wiki) à jour.",
    syncFailed: "Échec de la synchronisation UEX : {msg}",

    importMissionTitle: "Importer une mission (capture d'écran)",
    importMissionHint:
      "Fais une capture de l'écran de détails du contrat en jeu (Win+Maj+S), puis colle-la ici (Ctrl+V) ou dépose l'image. Tu peux aussi sélectionner ou déposer plusieurs captures à la fois pour créer plusieurs missions d'un coup. La reconnaissance de texte tourne entièrement dans le navigateur.",
    ocrDropzoneText: "Colle (Ctrl+V) ou dépose une ou plusieurs images ici",
    ocrPreviewAlt: "Capture importée",
    ocrHelpTitle: "Quelle capture faire ?",
    ocrHelpText:
      "Capture large tout l'écran de détails du contrat (pas juste recadrée) : elle doit inclure la récompense, le proposeur et la liste complète des objectifs avec leurs quantités, comme dans l'exemple ci-dessous.",
    ocrHelpImageAlt: "Exemple de capture d'écran de contrat à importer",
    ocrRecognizing: "Reconnaissance en cours...",
    ocrRecognized: "Texte reconnu — vérifie avant d'utiliser.",
    ocrError: "Erreur OCR : {msg}",
    ocrLabelName: "Nom",
    ocrLabelGiver: "Donneur",
    ocrLabelReward: "Récompense",
    ocrApproxWarning:
      "⚠ Marchandise disponible à plusieurs lieux de retrait : la quantité est répartie également à titre d'estimation — vérifie le stock réel en jeu et corrige les quantités si besoin.",
    ocrItemLine: "{qty} SCU de {commodity} : {pickup} → {dropoff}{approx}",
    ocrEstimationSuffix: " (estimation)",
    ocrNoTextRecognized: "(aucun texte reconnu)",
    ocrUseFieldsBtn: "Utiliser ces champs dans le formulaire",
    ocrNoFieldsRecognized: "Aucun champ reconnu — vérifie le texte brut ci-dessous et complète à la main.",
    ocrBatchProgress: "Reconnaissance de l'image {done}/{total}...",
    ocrBatchDone: "{count}/{total} mission(s) créée(s) automatiquement — vérifie-les dans l'onglet Missions enregistrées.",
    ocrBatchItemCreated: "✓ {file} — mission « {name} » créée",
    ocrBatchItemFailed: "✗ {file} — {reason}",
    ocrBatchNoCargo: "aucune marchandise reconnue",
    ocrBatchDuplicate: "mission déjà enregistrée, ignorée",
    ocrBatchLocationCreated: "lieu « {name} » créé automatiquement, vérifie-le",

    routeOverloadCulprits: "Mission(s) en cause au moment du dépassement :",
    deselectAndRecalcBtn: "Désélectionner et recalculer",

    newMissionTab: "Nouvelle mission",
    missionsTab: "Missions enregistrées",
    historyTab: "Historique",
    routeCargoRowLabel: "{commodity} (prévu : {planned} SCU)",
    routeCargoFullBtn: "Tout",
    routeCargoPartialBtn: "Partiel",
    routeCargoNoneBtn: "Rien",
    editBtn: "Modifier",
    saveMissionBtn: "Enregistrer les modifications",
    cancelEditBtn: "Annuler la modification",
    completeBtn: "Terminer",
    restoreBtn: "Restaurer",
    historySummary: "{count} mission(s) terminée(s) — {reward} aUEC au total.",
    colTimes: "Complétée",
    noHistoryYet: "Aucune mission terminée pour l'instant.",
    missionNameLabel: "Nom (optionnel)",
    missionNamePlaceholder: "Ex : Livraison medgel",
    missionGiverLabel: "Donneur de mission",
    missionGiverPlaceholder: "Ex : Covalex",
    cargoItemsLabel: "Marchandises (chacune avec son lieu de récupération et de dépôt)",
    addCargoBtn: "+ Ajouter une marchandise",
    cargoCommodityPlaceholder: "Marchandise",
    cargoScuPlaceholder: "SCU",
    cargoPickupPlaceholder: "Lieu de récupération",
    cargoDropoffPlaceholder: "Lieu de dépôt",
    rewardLabel: "Récompense (aUEC)",
    addMissionBtn: "Ajouter la mission",
    addLocationLabel: "Ajouter un lieu personnalisé",
    locationNamePlaceholder: "Nom du lieu",
    categoryLabel: "Catégorie",
    addLocationBtn: "Ajouter le lieu",
    addAtLeastOneCargoError: "Ajoute au moins une marchandise avec son lieu de récupération et de dépôt.",
    locationNotFoundError:
      'Le lieu de récupération et le lieu de dépôt doivent être choisis dans la liste proposée (marchandise "{commodity}").',

    selectAllBtn: "Tout sélectionner",
    deselectAllBtn: "Tout désélectionner",
    colInclude: "Inclure",
    colName: "Nom",
    colGiver: "Donneur",
    colPickup: "Récupération",
    colDropoff: "Dépôt",
    colCargo: "Cargaison",
    colReward: "Récompense",
    deleteBtn: "Supprimer",
    missionsSummary: "{included}/{total} mission(s) sélectionnée(s) — {cargo} SCU — {reward} aUEC",
    tooManyMissionsWarning: "⚠ {count} missions actives enregistrées — le jeu limite à 10 le nombre de missions acceptées simultanément, pense à en terminer certaines.",
    noMissionsYet: "Aucune mission enregistrée pour l'instant.",
    capacityWithShip:
      '{cargo} SCU à transporter au total ({shipName}, {shipScu} SCU) — la charge réelle à bord dépend de l\'ordre du trajet, vérifie via "Optimiser la route".',
    capacityNoShip:
      "{cargo} SCU à transporter au total — sélectionne un vaisseau (menu de gauche) puis optimise la route pour vérifier que ça tient.",
    cargoLineWithRoute: "{qty} SCU — {commodity} ({pickup} → {dropoff})",
    dash: "-",

    distancesTab: "Distances entre lieux utilisés",
    optimizeTab: "Optimisation de la route",
    distanceFilterPlaceholder: "Filtrer par nom de lieu...",
    needTwoLocations: "Ajoute au moins deux lieux différents via tes missions pour renseigner des distances.",
    fillMissingDistancesBtn: "Remplir les distances manquantes via UEX",
    fetchingInProgress: "Récupération en cours...",
    fetchingProgress: "Récupération en cours... {done}/{total}",
    colLocA: "Lieu A",
    colLocB: "Lieu B",
    colDistanceGm: "Distance (Gm)",
    colSource: "Source",
    viaUexBtn: "via UEX",
    uexDistanceError: "Impossible de récupérer la distance UEX : {msg}",
    defaultDistanceNote:
      "Les paires sans donnée UEX ni valeur manuelle utilisent une valeur par défaut de {default} Gm.",
    sourceIdentical: "identique",
    sourceManual: "manuel",
    sourceDefault: "défaut",
    sourcePlanetEstimate: "estimée (planète)",

    startLocationLabel: "Point de départ (optionnel)",
    freeStart: "Libre (meilleur choix automatique)",
    optimizeBtn: "Optimiser la route",
    selectMissionError: "Sélectionne au moins une mission.",
    noValidOrderError:
      "Impossible de trouver un ordre valide : vérifie que le point de départ choisi n'est pas un dépôt sans récupération préalable.",
    approximateResultNote: "{count} lieux distincts : résultat approché (heuristique), pas garanti optimal à 100%.",
    routeTotal: "Distance totale estimée : {total} Gm — {stops} arrêt(s)",
    maxLoadOverload:
      "Charge maximale sur le trajet : {load} / {scu} SCU — dépassement de {over} SCU à un moment du trajet !",
    maxLoadOk: "Charge maximale sur le trajet : {load} / {scu} SCU — ça tient à tout moment du trajet.",
    maxLoadNoShip:
      "Charge maximale sur le trajet : {load} SCU — sélectionne un vaisseau (menu de gauche) pour vérifier que ça tient.",
    onBoardWithShip: " — {load} SCU à bord sur {scu} disponibles",
    onBoardNoShip: " — {load} SCU à bord",
    pickupAction: "Récupérer",
    dropoffAction: "Déposer",
    cargoAlreadyPickedUpElsewhere: "{commodity} — déjà récupéré à {locations}",

    uexLocationsLoaded: "{count} lieux chargés depuis UEX Corp (dernière synchro : {date}).",
    uexLocationsDefault:
      '{count} lieux intégrés par défaut (données UEX Corp). Utilise "Tout synchroniser" pour les rafraîchir.',

    resetAllBtn: "Réinitialiser toutes les données",
    confirmResetAll: "Supprimer toutes les missions, lieux personnalisés et distances enregistrées ?",
  },

  en: {
    themeToggleLabel: "Toggle light/dark theme",
    langToggleLabel: "Switch language",
    pageTitle: "Cargo Route Optimizer — Star Citizen",
    appTitle: "Cargo Route Optimizer",
    appSubtitle: "Save your hauling missions and compute the optimal stop order.",
    poweredByPrefix: "Data provided by the public",

    myShipTitle: "My ship",
    shipUsedLabel: "Ship used",
    noneOption: "-- None --",
    shipCapacityPrefix: "Capacity: {scu} SCU",
    shipCapacityNone: "Select a ship to see its capacity.",

    syncAllBtn: "Sync everything (UEX Corp)",
    syncingLocations: "Syncing locations...",
    syncingCommodities: "Syncing commodities...",
    syncingCompanies: "Syncing companies...",
    syncingShips: "Syncing ships...",
    syncingDistances: "Syncing distances...",
    syncingDistancesProgress: "Syncing distances... {done}/{total}",
    syncingScwiki: "Syncing fallback locations (Star Citizen Wiki)...",
    syncSummary:
      "{locs} locations, {commodities} commodities, {companies} companies, {ships} ships up to date — {fetched} missing distance(s) fetched via UEX — {scwiki} fallback locations (Star Citizen Wiki) up to date.",
    syncFailed: "UEX sync failed: {msg}",

    importMissionTitle: "Import a mission (screenshot)",
    importMissionHint:
      "Take a screenshot of the contract details screen in-game (Win+Shift+S), then paste it here (Ctrl+V) or drop the image. You can also select or drop several screenshots at once to create several missions in one go. Text recognition runs entirely in your browser.",
    ocrDropzoneText: "Paste (Ctrl+V) or drop one or more images here",
    ocrPreviewAlt: "Imported screenshot",
    ocrHelpTitle: "What screenshot should I take?",
    ocrHelpText:
      "Capture the whole contract details screen (not a cropped-in view): it must include the reward, the giver and the full list of objectives with their quantities, like in the example below.",
    ocrHelpImageAlt: "Example contract screenshot to import",
    ocrRecognizing: "Recognizing...",
    ocrRecognized: "Text recognized — check before using.",
    ocrError: "OCR error: {msg}",
    ocrLabelName: "Name",
    ocrLabelGiver: "Giver",
    ocrLabelReward: "Reward",
    ocrApproxWarning:
      "⚠ This commodity is available at several pickup locations: the quantity is split evenly as an estimate — check actual stock in-game and correct the quantities if needed.",
    ocrItemLine: "{qty} SCU of {commodity}: {pickup} → {dropoff}{approx}",
    ocrEstimationSuffix: " (estimate)",
    ocrNoTextRecognized: "(no text recognized)",
    ocrUseFieldsBtn: "Use these fields in the form",
    ocrNoFieldsRecognized: "No fields recognized — check the raw text below and fill in manually.",
    ocrBatchProgress: "Recognizing image {done}/{total}...",
    ocrBatchDone: "{count}/{total} mission(s) created automatically — check them in the Saved missions tab.",
    ocrBatchItemCreated: "✓ {file} — mission \"{name}\" created",
    ocrBatchItemFailed: "✗ {file} — {reason}",
    ocrBatchNoCargo: "no commodity recognized",
    ocrBatchDuplicate: "mission already saved, skipped",
    ocrBatchLocationCreated: "location \"{name}\" created automatically, please check it",

    routeOverloadCulprits: "Mission(s) causing the overload at that point:",
    deselectAndRecalcBtn: "Deselect and recalculate",

    newMissionTab: "New mission",
    missionsTab: "Saved missions",
    historyTab: "History",
    routeCargoRowLabel: "{commodity} (planned: {planned} SCU)",
    routeCargoFullBtn: "All",
    routeCargoPartialBtn: "Partial",
    routeCargoNoneBtn: "None",
    editBtn: "Edit",
    saveMissionBtn: "Save changes",
    cancelEditBtn: "Cancel edit",
    completeBtn: "Complete",
    restoreBtn: "Restore",
    historySummary: "{count} completed mission(s) — {reward} aUEC total.",
    colTimes: "Completed",
    noHistoryYet: "No completed missions yet.",
    missionNameLabel: "Name (optional)",
    missionNamePlaceholder: "E.g.: Medgel delivery",
    missionGiverLabel: "Mission giver",
    missionGiverPlaceholder: "E.g.: Covalex",
    cargoItemsLabel: "Cargo (each with its own pickup and dropoff location)",
    addCargoBtn: "+ Add cargo item",
    cargoCommodityPlaceholder: "Commodity",
    cargoScuPlaceholder: "SCU",
    cargoPickupPlaceholder: "Pickup location",
    cargoDropoffPlaceholder: "Dropoff location",
    rewardLabel: "Reward (aUEC)",
    addMissionBtn: "Add mission",
    addLocationLabel: "Add a custom location",
    locationNamePlaceholder: "Location name",
    categoryLabel: "Category",
    addLocationBtn: "Add location",
    addAtLeastOneCargoError: "Add at least one cargo item with its pickup and dropoff location.",
    locationNotFoundError:
      'The pickup and dropoff locations must be chosen from the suggested list (commodity "{commodity}").',

    selectAllBtn: "Select all",
    deselectAllBtn: "Deselect all",
    colInclude: "Include",
    colName: "Name",
    colGiver: "Giver",
    colPickup: "Pickup",
    colDropoff: "Dropoff",
    colCargo: "Cargo",
    colReward: "Reward",
    deleteBtn: "Delete",
    missionsSummary: "{included}/{total} mission(s) selected — {cargo} SCU — {reward} aUEC",
    tooManyMissionsWarning: "⚠ {count} active missions saved — the game caps accepted missions at 10, consider completing some.",
    noMissionsYet: "No missions saved yet.",
    capacityWithShip:
      '{cargo} SCU to haul in total ({shipName}, {shipScu} SCU) — actual load on board depends on the route order, check via "Optimize route".',
    capacityNoShip:
      "{cargo} SCU to haul in total — select a ship (left menu) then optimize the route to check it fits.",
    cargoLineWithRoute: "{qty} SCU — {commodity} ({pickup} → {dropoff})",
    dash: "-",

    distancesTab: "Distances between used locations",
    optimizeTab: "Route optimization",
    distanceFilterPlaceholder: "Filter by location name...",
    needTwoLocations: "Add at least two different locations via your missions to set distances.",
    fillMissingDistancesBtn: "Fill missing distances via UEX",
    fetchingInProgress: "Fetching...",
    fetchingProgress: "Fetching... {done}/{total}",
    colLocA: "Location A",
    colLocB: "Location B",
    colDistanceGm: "Distance (Gm)",
    colSource: "Source",
    viaUexBtn: "via UEX",
    uexDistanceError: "Could not fetch UEX distance: {msg}",
    defaultDistanceNote: "Pairs without UEX data or a manual value use a default of {default} Gm.",
    sourceIdentical: "same",
    sourceManual: "manual",
    sourceDefault: "default",
    sourcePlanetEstimate: "estimated (planet)",

    startLocationLabel: "Starting point (optional)",
    freeStart: "Free (best automatic choice)",
    optimizeBtn: "Optimize route",
    selectMissionError: "Select at least one mission.",
    noValidOrderError:
      "Could not find a valid order: check that the chosen starting point isn't a dropoff without a prior pickup.",
    approximateResultNote: "{count} distinct locations: approximate result (heuristic), not guaranteed 100% optimal.",
    routeTotal: "Estimated total distance: {total} Gm — {stops} stop(s)",
    maxLoadOverload: "Maximum load along the route: {load} / {scu} SCU — exceeds capacity by {over} SCU at some point!",
    maxLoadOk: "Maximum load along the route: {load} / {scu} SCU — fits at every point of the route.",
    maxLoadNoShip: "Maximum load along the route: {load} SCU — select a ship (left menu) to check it fits.",
    onBoardWithShip: " — {load} SCU on board out of {scu} available",
    onBoardNoShip: " — {load} SCU on board",
    pickupAction: "Pick up",
    dropoffAction: "Drop off",
    cargoAlreadyPickedUpElsewhere: "{commodity} — already picked up at {locations}",

    uexLocationsLoaded: "{count} locations loaded from UEX Corp (last sync: {date}).",
    uexLocationsDefault: '{count} locations built in by default (UEX Corp data). Use "Sync everything" to refresh them.',

    resetAllBtn: "Reset all data",
    confirmResetAll: "Delete all missions, custom locations and saved distances?",
  },
};

let currentLang = localStorage.getItem(LANG_KEY) || "fr";

function getLang() {
  return currentLang;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
}

function t(key, vars) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.fr;
  let str = key in dict ? dict[key] : TRANSLATIONS.fr[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
    });
  }
  return str;
}

// Applique les traductions à tout ce qui est marqué par des attributs
// data-i18n(-placeholder) dans le HTML statique.
function applyStaticTranslations() {
  document.documentElement.setAttribute("lang", currentLang);
  document.title = t("pageTitle");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    el.alt = t(el.dataset.i18nAlt);
  });
}
