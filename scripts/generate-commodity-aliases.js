"use strict";

// Régénère data/commodity-aliases.js à partir du fichier de traduction du jeu
// (Localization/french_(france)/global.ini, installé avec le client Star
// Citizen), plutôt que d'ajouter les alias un par un à la main au fil des
// rencontres en jeu. Comme ce fichier est mis à jour à chaque patch, relancer
// ce script après une mise à jour du jeu suffit à garder les alias à jour
// (ex : "Sunset Berries" est passé de "Baies du Soleil Couchant" à "Baies du
// Crépuscule" entre deux patchs — l'ancien alias était devenu obsolète sans
// qu'on s'en aperçoive).
//
// Usage : node scripts/generate-commodity-aliases.js [chemin vers global.ini]
// Par défaut, le chemin d'installation Windows standard du client LIVE.
//
// Le fichier de traduction est fourni par le projet communautaire SPEED0U /
// SCEFRA sous licence CC BY-NC-ND 4.0 (non commercial, pas de modification) :
// on ne lit et n'en extrait ici qu'une table de correspondance de noms
// (donnée factuelle), jamais le texte du fichier lui-même, qui n'est ni
// copié ni commité dans ce dépôt.
//
// Ne fait correspondre que les clés qui suivent le schéma mécanique observé
// (nom anglais normalisé -> "items_commodities_<nomCamelCase>[_ore|_raw]") :
// une poignée d'entrées au nommage interne irrégulier (ex : "AcryliPlex
// Composite" -> clé "acryliplex", ou les items exotiques comme les cornes de
// Kopion) ne seront pas trouvées automatiquement et resteront à ajouter à la
// main si elles apparaissent un jour dans une mission — comme avant, mais
// pour un tout petit reste au lieu de la totalité.

const fs = require("fs");
const path = require("path");

const DEFAULT_INI_PATH =
  "C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\data\\Localization\\french_(france)\\global.ini";

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCommodityKeys(iniText) {
  // "items_commodities_ammocrate,P=Caisse de munitions" : le suffixe ",P"
  // (variante plurielle) n'affecte pas l'identité de l'objet, on l'ignore.
  const re = /^items_commodities_([A-Za-z0-9_]+?)(,[A-Za-z]+)?=(.*)$/gm;
  // Certaines clés ont à la fois une forme normale et une forme suffixée
  // (ex : "hephaestanite_raw" ET "hephaestanite_raw,P") — le suffixe (",P"...)
  // marque une variante d'affichage (pluriel/UI compacte) distincte, pas une
  // correction : on garde toujours la forme normale quand elle existe, plutôt
  // que de dépendre arbitrairement de l'ordre des lignes dans le fichier.
  const entries = new Map(); // clé -> { value, bare }
  let m;
  while ((m = re.exec(iniText))) {
    const rawKey = m[1];
    if (rawKey.endsWith("_desc")) continue;
    const key = rawKey.toLowerCase();
    const bare = !m[2];
    const existing = entries.get(key);
    if (existing && existing.bare && !bare) continue;
    entries.set(key, { value: m[3].trim(), bare });
  }
  const map = new Map();
  entries.forEach((entry, key) => map.set(key, entry.value));
  return map;
}

// Découpe "Agricium (Ore)" en base "Agricium" + suffixe "ore" : ces variantes
// ont leur propre clé dédiée dans le fichier de traduction ("agricium_ore").
function splitBaseSuffix(name) {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name);
  if (!m) return { base: name, suffix: null };
  return { base: m[1].trim(), suffix: normalize(m[2]) };
}

function findFrenchValue(name, keyMap) {
  const { base, suffix } = splitBaseSuffix(name);
  const normBase = normalize(base);
  const key = suffix ? `${normBase}_${suffix}` : normBase;
  if (keyMap.has(key)) return keyMap.get(key);
  // Certaines variantes utilisent "_raw" côté catalogue mais "_ore" côté jeu
  // (ou l'inverse selon la commodité) : on retente avec l'autre suffixe.
  if (suffix === "raw" && keyMap.has(`${normBase}_ore`)) return keyMap.get(`${normBase}_ore`);
  if (suffix === "ore" && keyMap.has(`${normBase}_raw`)) return keyMap.get(`${normBase}_raw`);
  return null;
}

function main() {
  const iniPath = process.argv[2] || DEFAULT_INI_PATH;
  if (!fs.existsSync(iniPath)) {
    console.error(`Fichier de traduction introuvable : ${iniPath}`);
    console.error("Ce script doit être lancé sur une machine avec le client Star Citizen installé,");
    console.error("ou en passant le chemin du global.ini en argument.");
    process.exit(1);
  }

  const iniText = fs.readFileSync(iniPath, "utf8");
  const keyMap = parseCommodityKeys(iniText);

  const commoditiesPath = path.join(__dirname, "..", "data", "commodities.js");
  const code = fs.readFileSync(commoditiesPath, "utf8");
  const commodities = new Function(code + "\nreturn DEFAULT_COMMODITIES;")();

  const aliases = new Map(); // frenchLower -> englishName
  const unmatched = [];
  commodities.forEach(({ name }) => {
    const frenchValue = findFrenchValue(name, keyMap);
    if (!frenchValue) {
      unmatched.push(name);
      return;
    }
    if (frenchValue.toLowerCase() === name.toLowerCase()) return; // pas traduit, pas besoin d'alias
    const key = frenchValue.trim().toLowerCase();
    if (aliases.has(key) && aliases.get(key) !== name) {
      console.warn(`Collision ignorée : "${frenchValue}" correspond à la fois à "${aliases.get(key)}" et "${name}"`);
      return;
    }
    aliases.set(key, name);
  });

  const sortedKeys = Array.from(aliases.keys()).sort();
  const lines = sortedKeys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(aliases.get(k))},`);

  const output = `"use strict";

// Alias "nom affiché en jeu (client français)" -> nom UEX (anglais), pour les
// marchandises dont le nom traduit ne correspond à rien dans data/commodities.js.
// Clé = nom français en minuscules.
//
// Généré automatiquement par scripts/generate-commodity-aliases.js à partir du
// fichier de traduction du jeu (Localization/french_(france)/global.ini) —
// relancer ce script après une mise à jour du client pour resynchroniser
// (voir le script pour le détail des quelques entrées non résolues
// automatiquement, à ajouter ici à la main si elles apparaissent en mission).
const COMMODITY_ALIASES = {
${lines.join("\n")}
};
`;

  fs.writeFileSync(path.join(__dirname, "..", "data", "commodity-aliases.js"), output);
  console.log(`data/commodity-aliases.js régénéré : ${aliases.size} alias.`);
  if (unmatched.length) {
    console.log(`\n${unmatched.length} commodités sans correspondance automatique (à vérifier à la main si besoin) :`);
    unmatched.forEach((n) => console.log(`  - ${n}`));
  }
}

main();
