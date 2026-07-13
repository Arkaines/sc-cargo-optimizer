"use strict";

// =========================================================================
// Reconnaissance de texte (OCR) sur une capture d'écran de l'écran de
// détails de contrat (mobiGlas, client français) et extraction des champs.
// Tourne entièrement dans le navigateur via Tesseract.js (WebAssembly).
// =========================================================================

async function runOcrOnImage(imageSource) {
  const {
    data: { text },
  } = await Tesseract.recognize(imageSource, "fra+eng");
  return text;
}

const E_ACUTE = String.fromCharCode(0x00e9); // e minuscule accent aigu
const E_ACUTE_UP = String.fromCharCode(0x00c9); // E majuscule accent aigu
const A_GRAVE = String.fromCharCode(0x00e0); // a accent grave
const CURLY_SINGLE_RE = new RegExp(
  "[" + String.fromCharCode(0x2018) + String.fromCharCode(0x2019) + "]",
  "g"
);
const CURLY_DOUBLE_RE = new RegExp(
  "[" + String.fromCharCode(0x201c) + String.fromCharCode(0x201d) + "]",
  "g"
);

function normalizeOcrText(text) {
  return text
    .replace(CURLY_SINGLE_RE, "'")
    .replace(CURLY_DOUBLE_RE, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// "DÉBUTANT - MOYEN - INTERSTELLAIRE [50 xp]" -> le tier/nom du contrat.
// On cherche la ligne brute contenant "[N xp]" plutôt que de travailler sur
// le texte normalisé, car l'ordre de lecture global entre les deux colonnes
// de l'écran n'est pas garanti.
function extractContractTitle(rawText) {
  const line = rawText.split("\n").find((l) => /\[\s*\d+\s*xp\s*\]/i.test(l));
  if (!line) return "";
  return line.replace(/\[\s*\d+\s*xp\s*\]/i, "").trim();
}

// "Proposé Par" suivi du nom du donneur, jusqu'au prochain titre de section.
function extractGiver(normalized) {
  const re = new RegExp(
    "Propos" + E_ACUTE + "\\s*Par\\s+(.+?)(?=\\s+(?:D" + E_ACUTE_UP + "TAILS|OBJECTIFS|$))",
    "i"
  );
  const m = re.exec(normalized);
  return m ? m[1].trim() : "";
}

// "RÉCOMPENSE" ... montant en aUEC (ex : ¤ 322,500). Le symbole aUEC est
// stylisé et souvent mal reconnu par l'OCR : on se base uniquement sur le
// nombre à séparateurs de milliers qui suit, avec une fenêtre large car
// d'autres libellés (Échéance, Proposé Par...) peuvent s'intercaler selon
// l'ordre de lecture choisi par l'OCR.
function extractReward(normalized) {
  const re = new RegExp(
    "R" + E_ACUTE_UP + "COMPENSE[\\s\\S]{0,60}?([0-9]{1,3}(?:[,.\\s][0-9]{3})+)",
    "i"
  );
  const m = re.exec(normalized);
  if (!m) return "";
  return m[1].replace(/[,.\s]/g, "");
}

// Retire le suffixe "sur <corps céleste>" (ex : "sur Pyro IV", "sur Cellin")
// que le jeu ajoute au nom du lieu mais qui n'en fait pas partie.
// Le jeu ajoute au nom du lieu une précision de position qui n'en fait pas
// partie : "sur <corps>" pour un lieu en surface, "au-dessus de/d'<corps>"
// pour une station en orbite. On coupe tout ce qui suit ce mot-clé.
const LOCATION_SUFFIX_RE = /\s+(?:sur|au-dessus)\b.*$/i;

function stripSystemSuffix(text) {
  return text.replace(LOCATION_SUFFIX_RE, "").trim();
}

// Extrait les objectifs (dépôt + marchandise + quantité, avec leurs lieux de
// retrait alternatifs) depuis le texte normalisé (espaces uniquement, pas de
// retours à la ligne, pour ne pas être perturbé par le retour à la ligne
// automatique du jeu au milieu d'un nom de lieu ou de marchandise).
function extractObjectives(normalized) {
  const re = new RegExp(
    "Livrez\\s+[" +
      A_GRAVE +
      "a]\\s+(.+?)\\s*:\\s*\\d+/(\\d+)\\s*SCU\\s+de\\s+(.+?)(?=\\s+Livrez\\s+[" +
      A_GRAVE +
      "a]|\\s+Allez\\s+[" +
      A_GRAVE +
      "a]|$)" +
      "|" +
      "Allez\\s+[" +
      A_GRAVE +
      "a]\\s+(.+?)\\s+pour\\s+r" +
      E_ACUTE +
      "cup" +
      E_ACUTE +
      "rer\\s*:\\s*(.+?)(?=\\s+Allez\\s+[" +
      A_GRAVE +
      "a]|\\s+Livrez\\s+[" +
      A_GRAVE +
      "a]|$)",
    "gi"
  );

  const objectives = [];
  let current = null;
  let m;
  while ((m = re.exec(normalized)) !== null) {
    if (m[1] !== undefined) {
      current = {
        dropoff: stripSystemSuffix(m[1]),
        quantity: Number(m[2]),
        commodity: m[3].trim(),
        pickupOptions: [],
      };
      objectives.push(current);
    } else if (current) {
      current.pickupOptions.push(stripSystemSuffix(m[4]));
    }
  }
  return objectives;
}

// Choisit un ensemble minimal de lieux de retrait couvrant tous les
// objectifs (glouton) : quand un même lieu peut fournir plusieurs
// marchandises (options alternatives), on évite de proposer un arrêt
// supplémentaire inutile.
function pickMinimalPickupSet(objectives) {
  let remaining = objectives.filter((o) => o.pickupOptions.length);
  const chosen = [];
  while (remaining.length) {
    const counts = new Map();
    remaining.forEach((o) =>
      o.pickupOptions.forEach((loc) => counts.set(loc, (counts.get(loc) || 0) + 1))
    );
    let best = null;
    let bestCount = -1;
    counts.forEach((count, loc) => {
      if (count > bestCount) {
        best = loc;
        bestCount = count;
      }
    });
    if (!best) break;
    chosen.push(best);
    remaining = remaining.filter((o) => !o.pickupOptions.includes(best));
  }
  return chosen;
}

function parseOcrText(text) {
  const normalized = normalizeOcrText(text);
  const objectives = extractObjectives(normalized);

  const dropoffTexts = Array.from(new Set(objectives.map((o) => o.dropoff)));
  const pickupTexts = pickMinimalPickupSet(objectives);
  // Une ligne par objectif (pas de fusion par nom de marchandise) : deux
  // objectifs de la même marchandise vers deux dépôts différents restent
  // deux lignes distinctes, plus fidèle au contrat réel.
  const cargoItems = objectives.map((o) => ({ commodity: o.commodity, quantity: o.quantity }));

  return {
    raw: text,
    name: extractContractTitle(text),
    giver: extractGiver(normalized),
    cargoItems,
    reward: extractReward(normalized),
    pickupTexts,
    dropoffTexts,
  };
}
