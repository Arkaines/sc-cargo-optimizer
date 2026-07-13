"use strict";

// =========================================================================
// Analyse best-effort du Game.log de Star Citizen pour detecter les
// missions de transport acceptees (client en francais). Le format des
// lignes n'est pas documente officiellement : si Cloud Imperium le change
// ou si le client est dans une autre langue, ajuste les regex ci-dessous.
// =========================================================================

const E_ACUTE = String.fromCharCode(0x00e9); // e accent aigu
const A_GRAVE = String.fromCharCode(0x00e0); // a accent grave

const MISSION_ID_SRC = "[0-9a-fA-F-]{36}";

// Capture missionId + donneur + zoneHostId (identifiant stable du lieu
// physique) pour chaque marqueur d'objectif (recuperation ou depot).
// zoneHostId ne correspond a aucun nom lisible dans le log : on construit
// une table de correspondance locale (voir app.js) que l'utilisateur
// renseigne une fois par lieu, puis qui se reutilise automatiquement.
const MARKER_RE = new RegExp(
  "CLocalMissionPhaseMarker::CreateMarker.*?missionId \\[(" +
    MISSION_ID_SRC +
    ")\\], generator name \\[([^\\]]+)\\].*?objectiveId \\[(pickup|dropoff)_[^\\]]*\\].*?zoneHostId \\[(\\d+)\\]"
);

const ACCEPT_RE = new RegExp(
  'Added notification "Contrat accept' +
    E_ACUTE +
    '\\s*:\\s*(.*?)"\\s*\\[\\d+\\] to queue.*?MissionId:\\s*\\[(' +
    MISSION_ID_SRC +
    ")\\]"
);

// "Livrez X/Y SCU de <commodite> a <destination>: "
const DROPOFF_RE = new RegExp(
  'Added notification "Nouvel objectif\\s*:\\s*Livrez\\s+\\d+/(\\d+)\\s*SCU\\s+de\\s+(.+?)\\s+' +
    A_GRAVE +
    '\\s+(.+?)\\s*:\\s*"\\s*\\[\\d+\\] to queue.*?MissionId:\\s*\\[(' +
    MISSION_ID_SRC +
    ")\\]"
);

// "Recuperez X/Y SCU de <commodite> a <origine>: " (motif suppose, non confirme sur un vrai log)
const PICKUP_RE = new RegExp(
  'Added notification "Nouvel objectif\\s*:\\s*R' +
    E_ACUTE +
    "cup" +
    E_ACUTE +
    'rez\\s+\\d+/(\\d+)\\s*SCU\\s+de\\s+(.+?)\\s+' +
    A_GRAVE +
    '\\s+(.+?)\\s*:\\s*"\\s*\\[\\d+\\] to queue.*?MissionId:\\s*\\[(' +
    MISSION_ID_SRC +
    ")\\]"
);

function cleanMissionTitle(raw) {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/\[\s*\d+\s*xp\s*\]/gi, "")
    .replace(/:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeGiverName(raw) {
  return raw.replace(/_/g, " ").trim();
}

function getOrCreateLogRecord(missionsMap, id) {
  let rec = missionsMap.get(id);
  if (!rec) {
    rec = {
      id,
      title: "",
      giver: "",
      accepted: false,
      objectives: [],
      zones: { pickup: [], dropoff: [] },
    };
    missionsMap.set(id, rec);
  }
  return rec;
}

function addLogObjective(rec, type, commodity, quantity, place) {
  const exists = rec.objectives.some(
    (o) => o.type === type && o.commodity === commodity && o.place === place
  );
  if (!exists) rec.objectives.push({ type, commodity, quantity, place });
}

function addLogZone(rec, role, zoneHostId) {
  if (!rec.zones[role].includes(zoneHostId)) rec.zones[role].push(zoneHostId);
}

// Analyse une tranche de texte du Game.log et fusionne les infos trouvees
// dans missionsMap (Map<missionId, record>), qui peut deja contenir des
// enregistrements partiels issus d'appels precedents.
function parseGameLogChunk(text, missionsMap) {
  const lines = text.split("\n");
  for (const line of lines) {
    let m;

    if ((m = MARKER_RE.exec(line))) {
      const rec = getOrCreateLogRecord(missionsMap, m[1]);
      if (!rec.giver) rec.giver = humanizeGiverName(m[2]);
      addLogZone(rec, m[3], m[4]);
      continue;
    }

    if ((m = ACCEPT_RE.exec(line))) {
      const rec = getOrCreateLogRecord(missionsMap, m[2]);
      rec.title = cleanMissionTitle(m[1]);
      rec.accepted = true;
      continue;
    }

    if ((m = DROPOFF_RE.exec(line))) {
      const rec = getOrCreateLogRecord(missionsMap, m[4]);
      addLogObjective(rec, "dropoff", m[2].trim(), Number(m[1]), m[3].trim());
      continue;
    }

    if ((m = PICKUP_RE.exec(line))) {
      const rec = getOrCreateLogRecord(missionsMap, m[4]);
      addLogObjective(rec, "pickup", m[2].trim(), Number(m[1]), m[3].trim());
      continue;
    }
  }
}
