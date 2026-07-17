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
    fanDisclaimer:
      "Ceci est un site de fans non-officiel de Star Citizen, non affilié au groupe d'entreprises Cloud Imperium. Tout le contenu de ce site non créé par son hébergeur ou ses utilisateurs appartient à ses propriétaires respectifs. Site officiel :",
    pageTitle: "Optimiseur de routes cargo — Star Citizen",
    appTitle: "Optimiseur de routes cargo",
    appSubtitle: "Enregistre tes missions de transport et calcule l'ordre optimal des arrêts.",
    poweredByPrefix: "Données fournies par l'API publique",
    poweredByAnd: "et",

    myShipTitle: "Mon vaisseau",
    shipUsedLabel: "Vaisseau utilisé",
    noneOption: "-- Aucun --",
    shipCapacityPrefix: "Capacité : {scu} SCU",
    shipCapacityNone: "Sélectionne un vaisseau pour voir sa capacité.",
    customCapacityLabel: "Capacité personnalisée (SCU)",
    customCapacityPlaceholder: "Ex : capacité réelle constatée",
    accessFacesTitle: "Faces accessibles de la soute",
    accessFaceBack: "Arrière",
    accessFaceFront: "Avant",
    accessFaceLeft: "Gauche",
    accessFaceRight: "Droite",
    accessFaceTop: "Dessus",
    accessFaceBottom: "Dessous",

    importMissionTitle: "Importer une mission (capture d'écran)",
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
    ocrLabelMaxBoxSize: "Taille de caisse",
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
    companiesTab: "Réputation",
    companiesHint: "Paliers de réputation par entreprise, d'après le catalogue Star Citizen Wiki. La progression indiquée est calculée depuis ton historique de missions terminées.",
    companyCalibrateAuto: "Automatique",
    companyNextRank: "{next} (encore {remaining})",
    companyMaxRankLabel: "Palier maximum",
    companyLockAria: "Verrouiller la position",
    companyUnlockAria: "Déverrouiller pour modifier",

    loginBtn: "Se connecter avec Discord",
    logoutBtn: "Se déconnecter",
    loggedInAs: "Connecté",
    cloudSyncing: "Synchronisation...",
    cloudSynced: "Synchronisé",
    cloudSyncFailed: "Échec de la synchronisation cloud : {msg}",
    cloudConflictPrompt:
      "Des données existent déjà en ligne pour ce compte. OK pour charger les données en ligne (tes modifications locales non synchronisées seront perdues), Annuler pour garder tes données locales et écraser celles en ligne.",
    routeCargoRowLabel: "{commodity} (prévu : {planned} SCU)",
    routeCargoFullBtn: "Tout",
    routeCargoPartialBtn: "Partiel",
    routeCargoNoneBtn: "Rien",
    elevatorHsBtn: "⚠ Ascenseur HS ⚠",
    elevatorHsHint: "Aucun ramassage ni dépôt possible ici tant que l'ascenseur est marqué HS (pour cette session de jeu uniquement).",
    brokenElevatorsLabel: "Ascenseurs HS (cette session) :",
    elevatorReactivateBtn: "⚠ {location} — réactiver ✕",
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
    cargoBoxSizeAnyOption: "Taille libre",
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
    completeSelectedBtn: "Terminer les missions sélectionnées",
    colInclude: "Inclure",
    colName: "Nom",
    colGiver: "Donneur",
    colPickup: "Récupération",
    colDropoff: "Dépôt",
    colCargo: "Cargaison",
    colReward: "Récompense",
    colReputation: "Réputation (estimée)",
    reputationSummaryTitle: "Réputation cumulée (estimée)",
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

    optimizeTab: "Optimisation de la route",
    cargoTab: "Optimisation du cargo",
    cargoTabNotFunctional: "⚠ Ce module est encore en développement et peut comporter des erreurs.",
    packCargoBtn: "Calculer le rangement",
    cargoPackNoShip: "Sélectionne un vaisseau (menu de gauche) pour calculer le rangement.",
    cargoPackNoData: "Pas de données de soute pour ce vaisseau.",
    cargoPackNoCargo: "Aucune marchandise à ranger (inclus au moins une mission).",
    cargoPackNoRoute: "Calcule d'abord un trajet (onglet Optimisation de la route) : le rangement en a besoin pour savoir dans quel ordre charger/décharger chaque marchandise.",
    cargoPackSummary: "{placed} caisses rangées sur {total} — {unplaced} n'ont trouvé de place nulle part.",
    cargoPackAllPlaced: "{placed} caisses rangées, tout rentre, sans conflit de chargement !",
    cargoPackConflictSummary:
      "{placed} caisses rangées, tout rentre — mais {conflicts} nécessitent de déplacer une autre caisse en cours de route (détail ci-dessous).",
    cargoUnplacedWarning:
      "⚠ Certaines marchandises ne rentrent pas dans les soutes disponibles : {list}. Désélectionne une mission ou choisis un vaisseau plus grand.",
    cargoStepLabelWithTotal: "Étape {index}/{total} — {location}",
    cargoStepPickupLine: "Charger {scu} SCU de {commodity} ({mission})",
    cargoStepDropoffLine: "Décharger {scu} SCU de {commodity} ({mission})",
    cargoStepNothing: "Rien à charger ou décharger à cet arrêt.",
    cargoConflictNote: "⚠ accès bloqué par : {blockers} (à déplacer temporairement)",
    viewFrontBtn: "Vue avant",
    viewRearBtn: "Vue arrière",
    viewLeftBtn: "Vue gauche",
    viewRightBtn: "Vue droite",
    viewTopBtn: "Vue du dessus",
    viewBottomBtn: "Vue du dessous",
    axisFront: "Avant",
    axisRear: "Arrière",
    axisLeft: "Gauche",
    axisRight: "Droite",
    rotateOrientationBtn: "Tourner",
    rotateOrientationHint:
      "FleetYards ne donne pas toujours la vraie position des soutes : si l'avant/arrière/gauche/droite affiché ne correspond pas au vaisseau, clique pour tourner l'étiquetage par pas de 90°.",
    mirrorOrientationBtn: "Miroir",
    mirrorOrientationHint:
      "Si tourner ne suffit pas (ex. l'avant affiché correspond en fait à la droite du vaisseau), clique pour inverser l'étiquetage en miroir — combinable avec Tourner pour couvrir tous les cas.",
    editLayoutBtn: "Éditer la disposition",
    editLayoutDoneBtn: "Terminer",
    resetLayoutBtn: "Réinitialiser la disposition",
    editLayoutHint:
      "Glisse chaque grille à sa vraie place (aimantage sur 1 SCU = 1,25 m). Tu déplaces dans le plan que tu regardes : en vue de dessus au sol, en vue avant ou de côté tu règles la hauteur. Change de vue avec les boutons ci-dessous.",
    publishedGridNote:
      "Grille officielle : la disposition de ce vaisseau a été validée et s'applique à tout le monde.",
    adminGridEditBtn: "Éditer la grille (admin)",
    adminGridHint:
      "Édite la grille de ce vaisseau : clique une grille pour la sélectionner, glisse-la pour la placer (change de vue pour régler la hauteur), et règle sa taille en cellules SCU. La capacité se calcule toute seule. Rien n'est publié tant que tu ne cliques pas Publier.",
    adminGridAddBtn: "Ajouter une grille",
    adminGridRemoveBtn: "Supprimer la grille",
    adminGridPublishBtn: "Publier la grille",
    adminGridCloseBtn: "Fermer sans publier",
    adminGridCellsX: "Largeur (cellules)",
    adminGridCellsY: "Profondeur (cellules)",
    adminGridCellsZ: "Hauteur (cellules)",
    adminGridMaxBox: "Caisse max (SCU)",
    adminGridCapacity: "Capacité : {scu} SCU",
    adminGridSelectFirst: "Sélectionne d'abord une grille.",

    startLocationLabel: "Point de départ (optionnel)",
    freeStart: "Libre (meilleur choix automatique)",
    startLocationCustomLabel: "Ou saisir un autre lieu de départ",
    startLocationCustomPlaceholder: "Ex : lieu où tu te trouves déjà",
    optimizeBtn: "Optimiser la route",
    selectMissionError: "Sélectionne au moins une mission.",
    noValidOrderError:
      "Impossible de trouver un ordre valide. Si un point de départ est choisi, vérifie qu'il n'est pas un dépôt sans récupération préalable ; sinon, deux missions imposent probablement un ordre de visite contradictoire entre certains lieux (un même trajet ne peut pas visiter deux lieux dans les deux ordres) — essaie de désélectionner une mission à la fois pour repérer laquelle.",
    noValidOrderCycleError:
      "Impossible de trouver un ordre valide : une mission demande de récupérer à {a} avant de déposer à {b}, tandis qu'une autre demande l'inverse. Un même trajet ne peut pas visiter ces deux lieux dans les deux ordres — désélectionne l'une des missions concernées entre {a} et {b}, ou active \"{allowRevisitsBtn}\" ci-dessous.",
    allowRevisitsLabel: "Autoriser à revisiter un lieu si nécessaire (trajet non garanti optimal)",
    allowRevisitsBtn: "Autoriser les revisites",
    allowRevisitsHint: "Si activé, un lieu peut être visité plusieurs fois pour débloquer un trajet autrement impossible — le résultat n'est alors plus garanti optimal.",
    revisitedResultWarning:
      "⚠ Trajet de secours : au moins un lieu est visité plusieurs fois pour satisfaire des missions imposant un ordre contradictoire. Ce trajet n'est PAS optimisé (simple parcours au plus proche, pas de recherche du meilleur ordre) — désactive \"{allowRevisitsBtn}\" et désélectionne une mission pour un calcul optimal.",
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

    resetAllBtn: "Réinitialiser mes données",
    confirmResetAll:
      "⚠ Action irréversible : ceci va supprimer tes missions actives, l'historique des missions terminées, le calibrage de réputation, tes lieux personnalisés et les distances enregistrées. Si tu es connecté, la sauvegarde cloud sera aussi effacée définitivement. Le catalogue vaisseaux/lieux/marchandises n'est pas touché — il se met à jour tout seul. Continuer ?",
  },

  en: {
    themeToggleLabel: "Toggle light/dark theme",
    langToggleLabel: "Switch language",
    fanDisclaimer:
      "This is an unofficial Star Citizen fan site, not affiliated with the Cloud Imperium group of companies. All content on this site not authored by its host or users are property of their respective owners. Official site:",
    pageTitle: "Cargo Route Optimizer — Star Citizen",
    appTitle: "Cargo Route Optimizer",
    appSubtitle: "Save your hauling missions and compute the optimal stop order.",
    poweredByPrefix: "Data provided by the public",
    poweredByAnd: "and",

    myShipTitle: "My ship",
    shipUsedLabel: "Ship used",
    noneOption: "-- None --",
    shipCapacityPrefix: "Capacity: {scu} SCU",
    shipCapacityNone: "Select a ship to see its capacity.",
    customCapacityLabel: "Custom capacity (SCU)",
    customCapacityPlaceholder: "E.g.: actual capacity observed",
    accessFacesTitle: "Accessible cargo grid faces",
    accessFaceBack: "Back",
    accessFaceFront: "Front",
    accessFaceLeft: "Left",
    accessFaceRight: "Right",
    accessFaceTop: "Top",
    accessFaceBottom: "Bottom",


    importMissionTitle: "Import a mission (screenshot)",
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
    ocrLabelMaxBoxSize: "Crate size",
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
    companiesTab: "Reputation",
    companiesHint: "Reputation tiers per company, from the Star Citizen Wiki catalog. Progress shown is computed from your completed mission history.",
    companyCalibrateAuto: "Automatic",
    companyNextRank: "{next} ({remaining} more)",
    companyMaxRankLabel: "Maximum tier",
    companyLockAria: "Lock position",
    companyUnlockAria: "Unlock to edit",

    loginBtn: "Log in with Discord",
    logoutBtn: "Log out",
    loggedInAs: "Logged in",
    cloudSyncing: "Syncing...",
    cloudSynced: "Synced",
    cloudSyncFailed: "Cloud sync failed: {msg}",
    cloudConflictPrompt:
      "Data already exists online for this account. OK to load the online data (unsynced local changes will be lost), Cancel to keep your local data and overwrite the online copy.",
    routeCargoRowLabel: "{commodity} (planned: {planned} SCU)",
    routeCargoFullBtn: "All",
    routeCargoPartialBtn: "Partial",
    routeCargoNoneBtn: "None",
    elevatorHsBtn: "⚠ Elevator down ⚠",
    elevatorHsHint: "No pickup or dropoff possible here while the elevator is marked down (for this game session only).",
    brokenElevatorsLabel: "Elevators down (this session):",
    elevatorReactivateBtn: "⚠ {location} — reactivate ✕",
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
    cargoBoxSizeAnyOption: "Any size",
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
    completeSelectedBtn: "Complete selected missions",
    colInclude: "Include",
    colName: "Name",
    colGiver: "Giver",
    colPickup: "Pickup",
    colDropoff: "Dropoff",
    colCargo: "Cargo",
    colReward: "Reward",
    colReputation: "Reputation (estimated)",
    reputationSummaryTitle: "Cumulative reputation (estimated)",
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

    optimizeTab: "Route optimization",
    cargoTab: "Cargo optimization",
    cargoTabNotFunctional: "⚠ This module is still under development and may have errors.",
    packCargoBtn: "Compute the arrangement",
    cargoPackNoShip: "Select a ship (left menu) to compute the arrangement.",
    cargoPackNoData: "No cargo hold data for this ship.",
    cargoPackNoCargo: "No cargo to arrange (include at least one mission).",
    cargoPackNoRoute: "Compute a route first (Route optimization tab): the arrangement needs it to know in what order to load/unload each item.",
    cargoPackSummary: "{placed} crates arranged out of {total} — {unplaced} found no room anywhere.",
    cargoPackAllPlaced: "{placed} crates arranged, everything fits, no loading conflicts!",
    cargoPackConflictSummary:
      "{placed} crates arranged, everything fits — but {conflicts} of them require moving another crate mid-route (details below).",
    cargoUnplacedWarning:
      "⚠ Some cargo doesn't fit in the available holds: {list}. Deselect a mission or pick a bigger ship.",
    cargoStepLabelWithTotal: "Step {index}/{total} — {location}",
    cargoStepPickupLine: "Load {scu} SCU of {commodity} ({mission})",
    cargoStepDropoffLine: "Unload {scu} SCU of {commodity} ({mission})",
    cargoStepNothing: "Nothing to load or unload at this stop.",
    cargoConflictNote: "⚠ access blocked by: {blockers} (needs to be moved temporarily)",
    viewFrontBtn: "Front view",
    viewRearBtn: "Rear view",
    viewLeftBtn: "Left view",
    viewRightBtn: "Right view",
    viewTopBtn: "Top view",
    viewBottomBtn: "Bottom view",
    axisFront: "Front",
    axisRear: "Rear",
    axisLeft: "Left",
    axisRight: "Right",
    rotateOrientationBtn: "Rotate",
    rotateOrientationHint:
      "FleetYards doesn't always report the real position of cargo holds: if the shown front/rear/left/right doesn't match the ship, click to rotate the labeling in 90° steps.",
    mirrorOrientationBtn: "Mirror",
    mirrorOrientationHint:
      "If rotating isn't enough (e.g. the shown front is actually the ship's right), click to mirror the labeling — combine with Rotate to cover every case.",
    editLayoutBtn: "Edit layout",
    editLayoutDoneBtn: "Done",
    resetLayoutBtn: "Reset layout",
    editLayoutHint:
      "Drag each grid to its real place (snaps to 1 SCU = 1.25 m). You move within the plane you are looking at: top view moves it along the floor, front or side view sets its height. Switch views with the buttons below.",
    publishedGridNote:
      "Official grid: this ship's layout has been validated and applies to everyone.",
    adminGridEditBtn: "Edit grid (admin)",
    adminGridHint:
      "Edit this ship's grid: click a grid to select it, drag it to place it (switch view to set its height), and set its size in SCU cells. Capacity is computed for you. Nothing is published until you click Publish.",
    adminGridAddBtn: "Add a grid",
    adminGridRemoveBtn: "Delete grid",
    adminGridPublishBtn: "Publish grid",
    adminGridCloseBtn: "Close without publishing",
    adminGridCellsX: "Width (cells)",
    adminGridCellsY: "Depth (cells)",
    adminGridCellsZ: "Height (cells)",
    adminGridMaxBox: "Max box (SCU)",
    adminGridCapacity: "Capacity: {scu} SCU",
    adminGridSelectFirst: "Select a grid first.",

    startLocationLabel: "Starting point (optional)",
    freeStart: "Free (best automatic choice)",
    startLocationCustomLabel: "Or type another starting location",
    startLocationCustomPlaceholder: "E.g.: wherever you already are",
    optimizeBtn: "Optimize route",
    selectMissionError: "Select at least one mission.",
    noValidOrderError:
      "Could not find a valid order. If a starting point is chosen, check that it isn't a dropoff without a prior pickup; otherwise, two missions likely require a contradictory visit order between some locations (a single route can't visit two locations in both orders) — try deselecting missions one at a time to find which one.",
    noValidOrderCycleError:
      "Could not find a valid order: one mission requires picking up at {a} before dropping off at {b}, while another requires the opposite. A single route can't visit these two locations in both orders — deselect one of the conflicting missions between {a} and {b}, or enable \"{allowRevisitsBtn}\" below.",
    allowRevisitsLabel: "Allow revisiting a location if needed (route not guaranteed optimal)",
    allowRevisitsBtn: "Allow revisits",
    allowRevisitsHint: "When enabled, a location can be visited more than once to unblock an otherwise impossible route — the result is then no longer guaranteed optimal.",
    revisitedResultWarning:
      "⚠ Fallback route: at least one location is visited more than once to satisfy missions requiring a contradictory order. This route is NOT optimized (simple nearest-neighbor pass, no search for the best order) — disable \"{allowRevisitsBtn}\" and deselect a mission for an optimal calculation.",
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

    resetAllBtn: "Reset my data",
    confirmResetAll:
      "⚠ Irreversible action: this will delete your active missions, completed mission history, reputation calibration, custom locations and saved distances. If you're logged in, the cloud backup will also be permanently erased. The ship/location/commodity catalog is not affected — it keeps itself up to date automatically. Continue?",
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
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}
