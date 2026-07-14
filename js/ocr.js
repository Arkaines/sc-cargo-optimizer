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

// Le jeu ajoute au nom du lieu une précision de position qui n'en fait pas
// partie : "sur <corps>" pour un lieu en surface, "au-dessus de/d'<corps>" ou
// "au L4 Lagrange de <corps>" pour un point stellaire. "au" couvre les deux
// variantes ("au-dessus..." commence aussi par "au" suivi d'une frontière de
// mot sur le tiret). On coupe tout ce qui suit ce mot-clé.
const LOCATION_SUFFIX_RE = /\s+(?:sur|au)\b.*$/i;

function stripSystemSuffix(text) {
  return text.replace(LOCATION_SUFFIX_RE, "").trim();
}

// Isole le nom de lieu au tout début d'un morceau de texte en retirant les
// artefacts OCR parasites (":", "|", etc.) qui trainent juste avant le
// prochain repère utile.
function cleanLocationEdges(text) {
  return text.replace(/[\s:|;,.\-]+$/, "").trim();
}

// Retire un éventuel symbole de puce de la ligne SUIVANTE qui reste collé en
// fin de morceau (ex : "Quartz ©") : le découpage par mot-clé coupe juste
// avant "Livrez à"/"Allez à", donc la puce qui précède ce mot-clé dans le
// texte brut atterrit à la fin du morceau précédent plutôt que d'être ignorée.
function stripTrailingBulletNoise(text) {
  return text.replace(/[^\p{L}\p{N}'-]+$/u, "").trim();
}

// Analyse le morceau qui suit "Livrez à " jusqu'au prochain mot-clé :
// "<lieu> [artefacts OCR] X/Y SCU de <marchandise>". Le nombre X et les
// caractères entre le lieu et "X/Y" sont volontairement tolérés (l'OCR
// insère parfois des symboles parasites, ex : ": | 0/3 SCU"), tout comme entre
// "SCU" et "de" (ex : "SCU | de Quartz", quand la ligne se coupe juste après SCU).
function parseDropoffChunk(content) {
  const scuMatch = /^(.*?)SCU[^a-zA-Z]*de\s+(.+)$/i.exec(content);
  if (!scuMatch) return null;
  const beforeScu = scuMatch[1].trim();
  const commodity = stripTrailingBulletNoise(scuMatch[2].trim());
  const qtyMatch = /(\d+)\s*\/\s*(\d+)\s*$/.exec(beforeScu);
  if (!qtyMatch) return null;
  const location = cleanLocationEdges(beforeScu.slice(0, qtyMatch.index));
  return { location: stripSystemSuffix(location), quantity: Number(qtyMatch[2]), commodity };
}

// Analyse le morceau qui suit "Allez à " jusqu'au prochain mot-clé :
// "<lieu> pour récupérer : <marchandise>". Seul le lieu nous intéresse ici.
function parsePickupChunk(content) {
  const re = new RegExp("^(.+?)\\s+pour\\s+r" + E_ACUTE + "cup" + E_ACUTE + "rer\\b", "i");
  const m = re.exec(content);
  if (!m) return null;
  return stripSystemSuffix(cleanLocationEdges(m[1]));
}

// Extrait les objectifs (dépôt + marchandise + quantité, avec leurs lieux de
// retrait alternatifs) depuis le texte normalisé (espaces uniquement, pas de
// retours à la ligne). Découpe d'abord le texte à chaque "Livrez à"/"Allez à"
// puis analyse chaque morceau séparément : plus tolérant aux artefacts OCR
// qu'une seule grosse expression régulière couvrant toute la phrase.
function extractObjectives(normalized) {
  const KEYWORD_RE = new RegExp("(Livrez\\s+[" + A_GRAVE + "a]\\s+|Allez\\s+[" + A_GRAVE + "a]\\s+)", "gi");
  const tokens = normalized.split(KEYWORD_RE);

  const objectives = [];
  let current = null;
  for (let i = 1; i < tokens.length; i += 2) {
    const keyword = tokens[i].trim().toLowerCase();
    const content = tokens[i + 1] || "";
    if (keyword.startsWith("livrez")) {
      const parsed = parseDropoffChunk(content);
      current = parsed
        ? { dropoff: parsed.location, quantity: parsed.quantity, commodity: parsed.commodity, pickupOptions: [] }
        : null;
      if (current) objectives.push(current);
    } else if (current) {
      const loc = parsePickupChunk(content);
      if (loc) current.pickupOptions.push(loc);
    }
  }
  return objectives;
}

// Répartit une quantité (en SCU, toujours entier) le plus également possible
// entre plusieurs lieux : ex. 9 réparti sur 2 lieux -> [5, 4], jamais de
// décimales puisque le SCU est une unité entière.
function splitQuantityEvenly(quantity, count) {
  const base = Math.floor(quantity / count);
  const remainder = quantity - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

function parseOcrText(text) {
  const normalized = normalizeOcrText(text);
  const objectives = extractObjectives(normalized);

  // Quand une marchandise a plusieurs lieux de retrait possibles, on ne peut
  // pas savoir comment la quantité totale se répartit entre eux (ça dépend
  // du stock réellement disponible sur place, connu seulement en jeu) : on
  // crée une ligne par lieu, avec une répartition égale (en SCU entiers) à
  // titre d'estimation à corriger une fois sur place — plutôt que de choisir
  // un seul lieu en silence et perdre l'info que l'autre existe aussi.
  const cargoItems = [];
  objectives.forEach((o) => {
    const options = o.pickupOptions.length ? o.pickupOptions : [""];
    const approximate = options.length > 1;
    const shares = approximate ? splitQuantityEvenly(o.quantity, options.length) : [o.quantity];
    options.forEach((pickupText, i) => {
      cargoItems.push({
        commodity: o.commodity,
        quantity: shares[i],
        pickupText,
        dropoffText: o.dropoff,
        approximate,
      });
    });
  });

  return {
    raw: text,
    name: extractContractTitle(text),
    giver: extractGiver(normalized),
    cargoItems,
    reward: extractReward(normalized),
  };
}
