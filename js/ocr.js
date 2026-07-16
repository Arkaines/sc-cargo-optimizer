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

// Découpe une région de l'image sur un canvas séparé (recadrage réel, plutôt
// que de compter sur l'option "rectangle" de Tesseract dont le comportement
// s'est avéré peu fiable ici) : createImageBitmap accepte directement un
// rectangle source, on le redessine sur un canvas de cette seule taille.
async function cropImageToCanvas(imageSource, left, top, width, height) {
  const bitmap = await createImageBitmap(imageSource, left, top, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

// L'écran de détails de contrat a une bande du haut pleine largeur (titre à
// gauche, récompense/échéance/donneur à droite) puis deux colonnes en
// dessous : panneau "DÉTAILS" à gauche (donneur, type de mission, point de
// collecte/destination en clair, et surtout "Taille maximum du cargo : X SCU"
// — la seule info utile de ce panneau, le reste étant redondant avec les
// objectifs), objectifs à droite. Faire lire toute la bande du haut d'un bloc
// mélange parfois l'ordre de lecture entre le titre et le bloc récompense
// (constaté empiriquement : les deux se retrouvent alors imbriqués ligne par
// ligne, titre et récompense corrompus) — on découpe donc aussi la bande du
// haut en gauche/droite, avec la même frontière verticale que pour le bas de
// l'écran, pour ne jamais laisser Tesseract démêler deux blocs côte à côte.
async function runOcrOnMissionScreenshot(imageSource) {
  const fullBitmap = await createImageBitmap(imageSource);
  const w = fullBitmap.width;
  const h = fullBitmap.height;
  fullBitmap.close();

  const topBandHeight = Math.round(h * 0.22);
  const rightColumnLeft = Math.round(w * 0.45);

  const [topLeftCanvas, topRightCanvas, bottomLeftCanvas, rightCanvas] = await Promise.all([
    cropImageToCanvas(imageSource, 0, 0, rightColumnLeft, topBandHeight),
    cropImageToCanvas(imageSource, rightColumnLeft, 0, w - rightColumnLeft, topBandHeight),
    cropImageToCanvas(imageSource, 0, topBandHeight, rightColumnLeft, h - topBandHeight),
    cropImageToCanvas(imageSource, rightColumnLeft, topBandHeight, w - rightColumnLeft, h - topBandHeight),
  ]);

  const [topLeftResult, topRightResult, bottomLeftResult, rightResult] = await Promise.all([
    Tesseract.recognize(topLeftCanvas, "fra+eng"),
    Tesseract.recognize(topRightCanvas, "fra+eng"),
    Tesseract.recognize(bottomLeftCanvas, "fra+eng"),
    Tesseract.recognize(rightCanvas, "fra+eng"),
  ]);
  return `${topLeftResult.data.text}\n${topRightResult.data.text}\n${bottomLeftResult.data.text}\n${rightResult.data.text}`;
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

// Un badge de palier de rang ("Member Rank", "Junior Rank"...) traîne parfois
// collé juste devant le titre à cause de l'ordre de lecture OCR : on le
// retire s'il est présent en tête, sans quoi il resterait mélangé au titre.
const RANK_TIER_PREFIX_RE = new RegExp(
  "^(?:Trainee|Rookie|Junior|Member|Experienced|Senior|Master)\\s+Rank\\s+",
  "i"
);

// Le titre du contrat est affiché en haut à gauche de l'écran. Plusieurs
// gabarits rencontrés :
// 1. "DÉBUTANT - MOYEN - INTERSTELLAIRE [50 xp]" : on cherche la ligne brute
//    contenant "[N xp]" (texte brut, pas normalisé, car l'ordre de lecture
//    global entre les deux colonnes de l'écran n'est pas garanti).
// 2. Pas de crochet "[N xp]" du tout (ex : "Opportunité de Transport de Fret
//    chez Ling Hauling") : le titre est alors tout ce qui précède le premier
//    repère de récompense connu ("RÉCOMPENSE"/"Paiement"/"Reward"), qui suit
//    toujours le titre en haut de l'écran.
// 3. Le titre se retrouve lu APRÈS la récompense/l'échéance à cause de l'ordre
//    de lecture (le repli 2 ne trouve alors rien puisque "Reward" est déjà le
//    tout premier mot) : on cherche alors le texte juste avant le repère du
//    donneur ("Contracted By"/"Proposé Par"/"Émis Par"), où le titre se
//    retrouve coincé (parfois précédé d'un badge de palier de rang).
function extractContractTitle(rawText) {
  // L'UI du jeu affiche parfois un glyphe "|" (puce de section, vu aussi
  // devant "Notes" dans le panneau DÉTAILS) juste devant le titre, capté par
  // le recadrage OCR de la bande du haut — jamais légitime dans un titre,
  // on le retire quel que soit le gabarit ci-dessous qui a matché.
  const stripLeadingGlyph = (s) => s.replace(/^[|\s]+/, "");

  const xpLine = rawText.split("\n").find((l) => /\[\s*\d+\s*xp\s*\]/i.test(l));
  if (xpLine) return stripLeadingGlyph(xpLine.replace(/\[\s*\d+\s*xp\s*\]/i, "").trim());

  const beforeReward = new RegExp("^([\\s\\S]*?)(?:R" + E_ACUTE_UP + "COMPENSE|Paiement|Reward)", "i").exec(rawText);
  if (beforeReward && beforeReward[1].trim()) {
    // Le titre est la toute première ligne de la bande du haut, en tête de
    // l'écran — quand la capture ci-dessus contient plusieurs lignes, celles
    // qui suivent sont du bruit OCR d'un élément plus bas dans ce même
    // recadrage (ex : l'en-tête "DETAILS" mal lu en "NETAIl €"), jamais une
    // suite légitime du titre.
    const lines = beforeReward[1].split("\n").map((l) => l.trim()).filter(Boolean);
    const firstLine = lines.length ? lines[0] : beforeReward[1];
    return stripLeadingGlyph(firstLine.replace(/\s+/g, " ").trim());
  }

  const giverLabelSrc = "Contracted\\s*By|Propos" + E_ACUTE + "\\s*Par|[E" + E_ACUTE_UP + "]mis\\s*Par";

  // Cas précis : le badge de palier de rang précède directement le titre,
  // lui-même juste avant le repère du donneur (ex : "Member Rank Small Cargo
  // Haul Contracted By Covalex..."). On capture uniquement ce qui se trouve
  // entre les deux repères, sans le bruit (récompense/échéance) qui précède.
  const rankTitle = new RegExp(
    "(?:Trainee|Rookie|Junior|Member|Experienced|Senior|Master)\\s+Rank\\s+(.+?)\\s+(?:" + giverLabelSrc + ")",
    "i"
  ).exec(rawText);
  if (rankTitle) return stripLeadingGlyph(rankTitle[1].replace(/\s+/g, " ").trim());

  const beforeGiver = new RegExp("([\\s\\S]*?)(?:" + giverLabelSrc + ")", "i").exec(rawText);
  if (!beforeGiver) return "";
  const cleaned = beforeGiver[1].replace(/\s+/g, " ").trim();
  // Ne garde que la dernière portion courte (le titre), pas tout ce qui
  // précède (récompense, échéance...), en se limitant aux derniers mots.
  const words = cleaned.split(" ");
  const tail = words.slice(-8).join(" ");
  return stripLeadingGlyph(tail.replace(RANK_TIER_PREFIX_RE, "").trim());
}

// Certaines entreprises proposent des contrats génériques dont le titre
// (client français) suit le gabarit "PALIER - TAILLE - PORTÉE" (ex : "JUNIOR
// - PETIT - STELLAIRE [50 xp]"), sans jamais nommer l'entreprise — le
// catalogue (data/mission-reputation-by-title.js) n'a que le titre anglais
// correspondant (ex : "Junior Hauler Needed for Small Shipment"), donc sans
// traduction ce titre ne correspond jamais à une entrée connue et l'estimation
// de réputation retombe sur la moyenne par donneur (moins précise). La
// "PORTÉE" (Stellaire/Interstellaire, portée système vs inter-système) n'a
// pas d'équivalent dans le catalogue anglais et est donc ignorée.
// Traductions à corriger si une capture en jeu prouve le contraire — seules
// "Junior"/"Petit"/"Moyen" sont confirmées par des captures réelles, le reste
// est une estimation raisonnable (convention habituelle de localisation FR).
function stripDiacritics(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const GENERIC_TITLE_TIER_FR_TO_EN = {
  stagiaire: "Trainee",
  debutant: "Rookie",
  junior: "Junior",
  membre: "Member",
  experimente: "Experienced",
  senior: "Senior",
  maitre: "Master",
};

const GENERIC_TITLE_SIZE_FR_TO_EN = {
  "extra petit": "Extra Small",
  petit: "Small",
  moyen: "Medium",
  grand: "Large",
  vrac: "Bulk",
};

function matchGenericTierSizeTitle(title, giver, reward) {
  if (typeof DEFAULT_MISSION_REPUTATION_BY_TITLE === "undefined") return null;
  if (!title || !giver) return null;

  const cleaned = title.replace(/^[^\p{L}]+/u, "");
  const parts = cleaned.split(/\s*-\s*/);
  if (parts.length < 3) return null;

  const tier = GENERIC_TITLE_TIER_FR_TO_EN[stripDiacritics(parts[0]).trim().toLowerCase()];
  const size = GENERIC_TITLE_SIZE_FR_TO_EN[stripDiacritics(parts[1]).trim().toLowerCase()];
  if (!tier || !size) return null;

  const tierRe = new RegExp("\\b" + tier + "\\b", "i");
  // "Small" est aussi un mot entier dans "Extra Small" : on l'exclut
  // explicitement plutôt que de confondre les deux tailles.
  const sizeRe = size === "Small" ? /(?<!Extra )\bSmall\b/i : new RegExp("\\b" + size + "\\b", "i");
  const candidates = Object.keys(DEFAULT_MISSION_REPUTATION_BY_TITLE).filter(
    (k) => tierRe.test(k) && sizeRe.test(k)
  );
  if (!candidates.length) return null;

  const giverWords = new Set(giver.toLowerCase().split(/\s+/).filter(Boolean));
  const matchesGiver = (k) =>
    DEFAULT_MISSION_REPUTATION_BY_TITLE[k].some((v) =>
      v.rep.some((r) => {
        if (!r.faction) return false;
        const factionWords = r.faction.toLowerCase().split(/\s+/).filter(Boolean);
        return factionWords.every((w) => giverWords.has(w));
      })
    );

  // Le donneur doit correspondre à l'entreprise du candidat : plusieurs
  // entreprises ont chacune leur propre gabarit "Palier - Taille..." pour un
  // même palier/taille (ex : Covalex "Junior Rank - Small Cargo Haul" vs Red
  // Wind Linehaul "Junior Hauler Needed for Small Shipment"), donc sans cette
  // vérification on risquerait d'attribuer la réputation à la mauvaise
  // entreprise plutôt que de repartir en toute sécurité sur l'estimation par
  // donneur (comportement actuel, imprécis mais jamais faux).
  const giverMatches = candidates.filter(matchesGiver);
  if (!giverMatches.length) return null;
  if (giverMatches.length === 1) return giverMatches[0];

  // Plusieurs candidats restants pour ce donneur (ex : variante "Direct" ou
  // non, indistincte depuis le titre français) : on départage par la
  // récompense exacte, comme matchKnownMissionTitle.
  const rewardNum = Number(reward) || 0;
  let best = null;
  let bestInRange = false;
  giverMatches.forEach((k) => {
    const variants = DEFAULT_MISSION_REPUTATION_BY_TITLE[k];
    const inRange =
      rewardNum > 0 &&
      variants.some((v) => v.rewardMin > 0 && rewardNum >= v.rewardMin && rewardNum <= (v.rewardMax > 0 ? v.rewardMax : v.rewardMin));
    if (best === null || (inRange && !bestInRange)) {
      best = k;
      bestInRange = inRange;
    }
  });
  return best;
}

// Recoupe le texte brut de l'OCR avec la base des titres de mission connus
// (data/mission-reputation-by-title.js, extraite du Star Citizen Wiki) : les
// titres de contrat restent en anglais même sur un client en français, donc
// une correspondance de sous-chaîne fonctionne indépendamment des soucis de
// découpage OCR. Quand plusieurs titres correspondent (un titre court peut
// être inclus dans un titre plus long), on utilise la récompense exacte lue
// pour départager, puis on préfère le titre le plus long (le plus précis) —
// cela permet d'identifier la mission avec certitude et donc sa réputation
// exacte, plutôt que de dépendre uniquement de l'extraction positionnelle.
function matchKnownMissionTitle(rawText, reward) {
  if (typeof DEFAULT_MISSION_REPUTATION_BY_TITLE === "undefined") return null;
  // "-" est parfois absent du texte OCR (ex : "Member Rank Small Cargo Haul"
  // sans tiret) alors que les titres de la base l'incluent ("Member Rank -
  // Small Cargo Haul") : on l'ignore des deux côtés pour comparer.
  const normalizeForMatch = (s) => s.replace(/[-\s]+/g, " ").toLowerCase().trim();
  const haystack = normalizeForMatch(rawText);

  let bestTitle = null;
  let bestInRange = false;
  let bestLen = 0;
  Object.keys(DEFAULT_MISSION_REPUTATION_BY_TITLE).forEach((title) => {
    const needle = normalizeForMatch(title);
    if (needle.length < 6 || !haystack.includes(needle)) return;

    const variants = DEFAULT_MISSION_REPUTATION_BY_TITLE[title];
    const inRange = reward > 0 && variants.some(
      (v) => v.rewardMin > 0 && reward >= v.rewardMin && reward <= (v.rewardMax > 0 ? v.rewardMax : v.rewardMin)
    );

    const better = bestTitle === null || (inRange && !bestInRange) || (inRange === bestInRange && needle.length > bestLen);
    if (better) {
      bestTitle = title;
      bestInRange = inRange;
      bestLen = needle.length;
    }
  });
  return bestTitle;
}

// Repli pour les titres "généricos" traduits en français (voir data/mission-
// title-aliases.js) : reconstruit le titre anglais probable à partir d'un
// modèle de phrase fixe + du donneur déjà extrait de façon fiable, puis
// vérifie qu'il existe bien tel quel dans le catalogue avant de l'utiliser.
function matchFrenchTitleTemplate(rawText, giver) {
  if (typeof FRENCH_MISSION_TITLE_TEMPLATES === "undefined") return null;
  if (typeof DEFAULT_MISSION_REPUTATION_BY_TITLE === "undefined") return null;
  if (!giver) return null;
  const haystack = rawText.replace(/\s+/g, " ").toLowerCase();

  const giverWords = new Set(giver.toLowerCase().split(/\s+/).filter(Boolean));
  for (const template of FRENCH_MISSION_TITLE_TEMPLATES) {
    if (!haystack.includes(template.frenchFragment)) continue;
    const prefixLower = template.englishPrefix.toLowerCase();
    // Le nom d'entreprise du catalogue ne correspond pas toujours mot pour
    // mot au donneur affiché (ex : donneur "Ling Family Hauling" vs titre
    // catalogue "... with Ling Hauling", le mot "Family" s'intercale) : on
    // vérifie que chaque mot du nom du catalogue apparaît bien dans le
    // donneur, plutôt qu'une sous-chaîne stricte.
    const key = Object.keys(DEFAULT_MISSION_REPUTATION_BY_TITLE).find((k) => {
      const kLower = k.toLowerCase();
      if (!kLower.startsWith(prefixLower)) return false;
      const companyWords = kLower.slice(prefixLower.length).trim().split(/\s+/).filter(Boolean);
      return companyWords.length > 0 && companyWords.every((w) => giverWords.has(w));
    });
    if (key) return key;
  }
  return null;
}

// "Proposé Par" (ou "Émis Par"/"Contracted By" selon le donneur de contrat,
// ou la langue du client) suivi du nom du donneur, jusqu'au prochain titre de
// section. Les titres de section sont toujours tout en majuscules ("UTILI.",
// "OBJECTIFS PRINCIPAUX", "DÉTAILS", "PRIMARY OBJECTIVES"...) contrairement à
// un nom de donneur (casse normale) : on s'arrête donc générale­ment au
// premier mot tout en majuscules plutôt que d'énumérer chaque titre possible
// (ex : une nouvelle section de description entre le donneur et les objectifs
// ferait sinon déborder la capture sur tout le paragraphe qui suit).
function extractGiver(normalized) {
  // Deux passes distinctes : le repère du donneur se cherche insensible à la
  // casse (/i), mais la frontière de fin (mot tout en majuscules) doit rester
  // sensible à la casse — combiner /i et /u sur \p{Lu} dans une même regex le
  // fait matcher n'importe quelle lettre (bug de canonicalisation JS), ce qui
  // coupait la capture au premier mot venu au lieu du vrai titre de section.
  const labelRe = new RegExp(
    "(?:Propos" + E_ACUTE + "\\s*Par|[E" + E_ACUTE_UP + "]mis\\s*Par|Contracted\\s*By)\\s+",
    "i"
  );
  const labelMatch = labelRe.exec(normalized);
  if (!labelMatch) return "";
  const tail = normalized.slice(labelMatch.index + labelMatch[0].length);
  const stopMatch = /\s+\p{Lu}{3,}/u.exec(tail);
  const giverText = stopMatch ? tail.slice(0, stopMatch.index) : tail;
  return giverText.trim();
}

// "RÉCOMPENSE"/"Paiement"/"Reward" selon le donneur de contrat ou la langue du
// client ... montant en aUEC (ex : ¤ 322,500). Le symbole aUEC est stylisé et
// souvent mal reconnu par l'OCR : on se base uniquement sur le nombre à
// séparateurs de milliers qui suit, avec une fenêtre large car d'autres
// libellés (Échéance, Proposé Par...) peuvent s'intercaler selon l'ordre de
// lecture choisi par l'OCR.
function extractReward(normalized) {
  const re = new RegExp(
    "(?:R" + E_ACUTE_UP + "COMPENSE|Paiement|Reward)[\\s\\S]{0,60}?([0-9]{1,3}(?:[,.\\s][0-9]{3})+)",
    "i"
  );
  const m = re.exec(normalized);
  if (!m) return "";
  return m[1].replace(/[,.\s]/g, "");
}

// Le panneau "DÉTAILS" (colonne du bas à gauche) affiche la taille maximum de
// caisse que le contrat accepte ("Taille maximum du cargo : X SCU") : le jeu
// décompose alors la quantité à récupérer en caisses de cette taille (ex : 7
// SCU à récupérer avec un plafond de 4 SCU donne des caisses de 4 + 2 + 1),
// c'est cette limite qu'on veut récupérer plutôt que deviner arbitrairement la
// plus grosse caisse standard côté rangement (voir js/cargo-packing.js).
// "carg\w*" tolère un OCR imparfait de "cargo", comme le filler entre le
// libellé et le nombre (ponctuation parasite fréquente ailleurs dans l'OCR).
function extractMaxCargoBoxSize(normalized) {
  const reFr = /Taille\s+maximum\s+du\s+carg\w*\s*[^0-9]{0,3}(\d+)\s*SCU/i;
  const reEn = /Max(?:imum)?\s+Cargo\s+Size\s*[^0-9]{0,3}(\d+)\s*SCU/i;
  // Repli : le paragraphe "Notes" (texte d'ambiance, sous le champ structuré
  // ci-dessus) redit souvent la même limite sous une autre forme ("vous savez
  // gérer des conteneurs de X SCU") — utile quand le champ structuré est mal
  // lu par l'OCR (ligne dense en accents/ponctuation) mais que cette
  // deuxième mention, elle, passe.
  const reNotesFr = /(?:conteneurs?|caisses?)\s+de\s+(\d+)\s*SCU/i;
  // Autre formulation réelle (capture confirmée) : le texte d'ambiance du
  // panneau DÉTAILS donne la limite en une phrase ("Max size will be X SCU")
  // plutôt que via le champ structuré "Max Cargo Size" ci-dessus.
  const reEnAlt = /Max(?:imum)?\s+size\s+will\s+be\s*[^0-9]{0,3}(\d+)\s*SCU/i;
  const m = reFr.exec(normalized) || reEn.exec(normalized) || reEnAlt.exec(normalized) || reNotesFr.exec(normalized);
  return m ? Number(m[1]) : null;
}

// Le jeu ajoute au nom du lieu une précision de position qui n'en fait pas
// partie : "sur <corps>" (ou "on <corps>" en anglais) pour un lieu en
// surface, "au-dessus de/d'<corps>" ou "au L4 Lagrange de <corps>" pour un
// point stellaire. "au" couvre les deux variantes ("au-dessus..." commence
// aussi par "au" suivi d'une frontière de mot sur le tiret). On coupe tout ce
// qui suit ce mot-clé.
const LOCATION_SUFFIX_RE = /\s+(?:sur|au|on)\b.*$/i;

// Un repère précis (spatioport, terminal...) situé DANS une ville qu'on ne
// suit pas individuellement (ex : "Teasa Spaceport in Lorville") — à
// l'inverse de "sur/au/on" ci-dessus, qui qualifie par un CONTEXTE parent en
// suffixe et dont on garde alors le préfixe (plus précis), "in" qualifie ici
// un repère précis PAR la ville qui le contient : seule cette ville (après
// "in") correspond à un lieu qu'on suit réellement, donc on garde le
// suffixe cette fois.
const LOCATION_IN_CITY_RE = /^.+?\bin\b\s+(.+)$/i;

// Le dernier objectif d'une liste n'a aucun mot-clé suivant pour borner sa
// capture ("from <lieu>$"/"to <lieu>$" vont jusqu'à la fin du texte reconnu)
// — pour lui, tout le bruit d'interface qui traîne après (ex : "ACCEPT
// OFFER") se retrouve collé au nom du lieu. Un nom de lieu ne contient
// jamais de point ; tout ce qui suit le premier point de la phrase captée
// n'en fait donc jamais partie.
function truncateAtSentenceEnd(text) {
  const dot = text.indexOf(".");
  return dot === -1 ? text : text.slice(0, dot);
}

function stripSystemSuffix(text) {
  const truncated = truncateAtSentenceEnd(text);
  const inCity = LOCATION_IN_CITY_RE.exec(truncated);
  if (inCity) return inCity[1].trim();
  return truncated.replace(LOCATION_SUFFIX_RE, "").trim();
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
  const commodity = stripTrailingBulletNoise(stripBracketNoise(scuMatch[2].trim()));
  const qtyMatch = /(\d+)\s*\/\s*(\d+)\s*$/.exec(beforeScu);
  if (!qtyMatch) return null;
  const location = cleanLocationEdges(stripBracketNoise(beforeScu.slice(0, qtyMatch.index)));
  return { location: stripSystemSuffix(location), quantity: Number(qtyMatch[2]), commodity };
}

// Analyse le morceau qui suit "Allez à " jusqu'au prochain mot-clé :
// "<lieu> pour récupérer : <marchandise>". Seul le lieu nous intéresse ici.
function parsePickupChunk(content) {
  const re = new RegExp("^(.+?)\\s+pour\\s+r" + E_ACUTE + "cup" + E_ACUTE + "rer\\b", "i");
  const m = re.exec(content);
  if (!m) return null;
  return stripSystemSuffix(cleanLocationEdges(stripBracketNoise(m[1])));
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

// Retire les crochets/barres verticales isolés que l'OCR insère parfois au
// milieu d'un nom de lieu sur un retour à la ligne (ex : "Avant-poste [ de
// Recherche..."), ainsi qu'une petite icône (ex : un "ⓘ" d'info) présente à
// cet endroit dans le jeu et que l'OCR lit comme une lettre isolée (ex :
// "Avant-poste i de Recherche..."). Un nom de lieu Star Citizen ne contient
// jamais de mot d'une seule lettre, donc on retire ces jetons isolés sans
// risque de couper un vrai mot du nom.
function stripBracketNoise(text) {
  return text
    .replace(/[[\]|]/g, " ")
    .split(" ")
    .filter((word) => word.length !== 1 || !/[\p{L}\p{N}]/u.test(word))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// Découpe un texte normalisé à chaque mot-clé de dépôt/retrait et regroupe les
// morceaux en objectifs, en associant chaque retrait au dépôt qui le précède
// (un ou plusieurs retraits consécutifs après un dépôt lui appartiennent,
// jusqu'au dépôt suivant) — même logique que le gabarit principal, réutilisée
// pour les autres gabarits de contrat rencontrés selon le donneur/la langue.
function extractObjectivesSequential(normalized, keywordRe, isDropoffKeyword, parseDropoff, parsePickup) {
  const tokens = normalized.split(keywordRe);
  const objectives = [];
  let current = null;
  for (let i = 1; i < tokens.length; i += 2) {
    const keyword = tokens[i].trim().toLowerCase();
    const content = tokens[i + 1] || "";
    if (isDropoffKeyword(keyword)) {
      const parsed = parseDropoff(content);
      current = parsed
        ? { dropoff: parsed.location, quantity: parsed.quantity, commodity: parsed.commodity, pickupOptions: [] }
        : null;
      if (current) objectives.push(current);
    } else if (current) {
      const loc = parsePickup(content);
      if (loc) current.pickupOptions.push(loc);
    }
  }
  return objectives;
}

// Second gabarit de contrat, utilisé par certains donneurs (ex : "Ling Family
// Hauling") : "Livrer X/Y SCU de <marchandise> à <lieu>." pour le dépôt et
// "Collecter <marchandise> à <lieu>." pour chaque lieu de retrait — au lieu de
// "Livrez à <lieu> : X/Y SCU de <marchandise>" / "Allez à <lieu> pour
// récupérer".
function parseDropoffChunkAlt(content) {
  const re = new RegExp(
    "^(\\d+)\\s*/\\s*(\\d+)\\s*SCU\\s+de\\s+(.+?)\\s+[" + A_GRAVE + "a]\\s+(.+)$",
    "i"
  );
  const m = re.exec(content);
  if (!m) return null;
  const commodity = stripTrailingBulletNoise(stripBracketNoise(m[3].trim()));
  const location = stripTrailingBulletNoise(stripSystemSuffix(stripBracketNoise(m[4])));
  return { location, quantity: Number(m[2]), commodity };
}

function parsePickupChunkAlt(content) {
  const re = new RegExp("^(?:.+?\\s+[" + A_GRAVE + "a]\\s+)?(.+)$", "i");
  const m = re.exec(content);
  if (!m) return null;
  return stripTrailingBulletNoise(stripSystemSuffix(stripBracketNoise(m[1])));
}

function extractObjectivesAlt(normalized) {
  return extractObjectivesSequential(
    normalized,
    /(Livrer\s+|Collecter\s+)/gi,
    (keyword) => keyword.startsWith("livrer"),
    parseDropoffChunkAlt,
    parsePickupChunkAlt
  );
}

// Troisième gabarit, en anglais (client du jeu en anglais, ou capture non
// traduite) : "Deliver X/Y SCU of <commodity> to <location>." pour le dépôt,
// "Collect <commodity> from <location>." pour le retrait.
function parseDropoffChunkEn(content) {
  const m = /^(\d+)\s*\/\s*(\d+)\s*SCU\s+of\s+(.+?)\s+to\s+(.+)$/i.exec(content);
  if (!m) return null;
  const commodity = stripTrailingBulletNoise(stripBracketNoise(m[3].trim()));
  const location = stripTrailingBulletNoise(stripSystemSuffix(stripBracketNoise(m[4])));
  return { location, quantity: Number(m[2]), commodity };
}

function parsePickupChunkEn(content) {
  const m = /\bfrom\s+(.+)$/i.exec(content);
  if (!m) return null;
  return stripTrailingBulletNoise(stripSystemSuffix(stripBracketNoise(m[1])));
}

function extractObjectivesEn(normalized) {
  return extractObjectivesSequential(
    normalized,
    /(Deliver\s+|Collect\s+)/gi,
    (keyword) => keyword.startsWith("deliver"),
    parseDropoffChunkEn,
    parsePickupChunkEn
  );
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
  // Certains donneurs de contrat (ou le client en anglais) utilisent un
  // gabarit de phrase différent : on retombe dessus seulement si le gabarit
  // principal ne trouve rien.
  let objectives = extractObjectives(normalized);
  if (!objectives.length) objectives = extractObjectivesAlt(normalized);
  if (!objectives.length) objectives = extractObjectivesEn(normalized);

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

  const reward = extractReward(normalized);
  const giver = extractGiver(normalized);
  const titleGuess = extractContractTitle(text);
  const knownTitle =
    matchKnownMissionTitle(text, reward) ||
    matchFrenchTitleTemplate(text, giver) ||
    matchGenericTierSizeTitle(titleGuess, giver, reward);
  const maxCargoBoxSize = extractMaxCargoBoxSize(normalized);

  return {
    raw: text,
    name: knownTitle || titleGuess,
    giver,
    cargoItems,
    reward,
    maxCargoBoxSize,
  };
}
