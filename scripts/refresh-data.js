"use strict";

// =========================================================================
// Régénère les fichiers data/*.js qui sont de simples miroirs des APIs
// publiques UEX Corp et Star Citizen Wiki (locations, commodities,
// companies, ships, scwiki-locations), pour que le dépôt lui-même reste à
// jour sans dépendre uniquement de la synchro côté client (voir
// js/uex.js/js/scwiki.js, et maybeAutoSync dans js/app.js). Prévu pour
// tourner via une GitHub Action programmée (.github/workflows/
// refresh-data.yml), qui ouvre une pull request quand ce script change
// quelque chose -- peut aussi être lancé à la main :
//
//   node scripts/refresh-data.js
//
// N'écrit QUE des fichiers qui sont déjà de purs miroirs d'API (mêmes
// filtres/mapping que le code de synchro navigateur, dupliqués ici car ce
// script tourne en Node hors navigateur -- si l'un des deux change, l'autre
// doit suivre). Ne touche PAS aux fichiers curés/enrichis à la main
// (data/distances.js, data/*-aliases.js, data/mission-reputation*.js,
// data/faction-reputation-ladders.js, data/location-planets.js) : ceux-là
// ne sont pas de simples dumps d'API et une régénération naïve écraserait
// du travail de réconciliation qui n'est pas dans l'API elle-même.
// =========================================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TODAY = new Date().toISOString().slice(0, 10);

const UEX_API_BASE = "https://api.uexcorp.uk/2.0";
const SCWIKI_API_BASE = "https://api.star-citizen.wiki/api";

async function uexGet(pathSuffix) {
  const res = await fetch(`${UEX_API_BASE}/${pathSuffix}`, { headers: { Accept: "application/json" } });
  const json = await res.json();
  if (json.status !== "ok") throw new Error(json.message || `Erreur UEX (${json.status})`);
  return json.data;
}

// --- Lieux (voir js/uex.js:buildUexLocations/syncUexLocations) ---------

function locationNameFromTerminal(t) {
  return (
    t.space_station_name || t.outpost_name || t.city_name || t.moon_name || t.planet_name || t.displayname || t.name
  );
}

function locationCategoryFromTerminal(t) {
  let base = "Planète";
  if (t.id_space_station) base = "Station";
  else if (t.id_outpost) base = "Avant-poste";
  else if (t.id_city) base = "Ville";
  else if (t.id_moon) base = "Lune (surface)";
  if (t.star_system_name && t.star_system_name !== "Stanton") base += ` - ${t.star_system_name}`;
  return base;
}

function groupKeyFromTerminal(t) {
  if (t.id_space_station) return `station-${t.id_space_station}`;
  if (t.id_outpost) return `outpost-${t.id_outpost}`;
  if (t.id_city) return `city-${t.id_city}`;
  if (t.id_moon) return `moon-${t.id_moon}`;
  if (t.id_planet) return `planet-${t.id_planet}`;
  return `terminal-${t.id}`;
}

async function fetchLocations() {
  const terminals = await uexGet("terminals");
  const byGroup = new Map();
  terminals.forEach((t) => {
    if (!t.is_available) return;
    const key = groupKeyFromTerminal(t);
    if (byGroup.has(key)) return;
    byGroup.set(key, {
      id: `uex-${key}`,
      name: locationNameFromTerminal(t),
      category: locationCategoryFromTerminal(t),
      uexTerminalId: t.id,
      orbitId: t.id_orbit || 0,
    });
  });
  return Array.from(byGroup.values()).sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  );
}

// --- Marchandises (voir js/uex.js:syncUexCommodities) -------------------

async function fetchCommodities() {
  const commodities = await uexGet("commodities");
  return commodities
    .filter((c) => c.is_available)
    .map((c) => ({ name: c.name, kind: c.kind || "", illegal: !!c.is_illegal }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Entreprises (voir js/uex.js:syncUexCompanies) -----------------------

async function fetchCompanies() {
  const companies = await uexGet("companies");
  return companies
    .map((c) => ({ name: c.name, industry: c.industry || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// data/faction-reputation-ladders.js vient d'une AUTRE API (Star Citizen
// Wiki /factions/{uuid}, voir son en-tête) que UEX companies -- il suit
// aussi de vraies factions/organisations criminelles (XenoThreat, Foxwell
// Enforcement...) qui n'ont jamais figuré dans le répertoire commercial
// UEX. Les comparer directement au catalogue UEX donnerait donc une
// majorité de faux positifs (des entités qui n'ont simplement jamais été
// des "entreprises" UEX). Le signal utile est plus étroit : une entreprise
// qui ÉTAIT dans data/companies.js jusqu'ici ET qui est aussi suivie dans
// faction-reputation-ladders.js, et qui disparaît de cette régénération --
// constaté en pratique avec "Dead Saints", toujours suivie côté réputation
// mais absente d'un coup de l'API UEX companies. Ce n'est pas au script de
// trancher (retrait définitif ou temporaire côté UEX ?) -- juste d'avertir,
// pour qu'un humain le voie dans les logs/la description de la pull
// request avant de merger.
function warnIfReputationLadderCompanyMissing(previousCompanyNames, newCompanies) {
  const laddersPath = path.join(DATA_DIR, "faction-reputation-ladders.js");
  if (!fs.existsSync(laddersPath)) return;
  const content = fs.readFileSync(laddersPath, "utf-8");
  // Cherche le "{" après la déclaration de la variable, pas le premier de
  // tout le fichier -- l'en-tête en commentaire contient lui-même un "{"
  // (le "{uuid}" de l'URL d'API documentée).
  const declIndex = content.indexOf("FACTION_REPUTATION_LADDERS");
  const jsonStart = content.indexOf("{", declIndex);
  let ladders;
  try {
    ladders = JSON.parse(content.slice(jsonStart, content.lastIndexOf("}") + 1));
  } catch (e) {
    console.warn("warnIfReputationLadderCompanyMissing: impossible de lire faction-reputation-ladders.js :", e.message);
    return;
  }
  const newNames = new Set(newCompanies.map((c) => c.name));
  const missing = Object.keys(ladders).filter((name) => previousCompanyNames.has(name) && !newNames.has(name));
  if (missing.length) {
    console.warn(
      `⚠ ${missing.length} entreprise(s) suivie(s) dans faction-reputation-ladders.js ET jusqu'ici présente(s) dans companies.js ont disparu de l'API UEX companies (à vérifier avant de merger) : ${missing.join(", ")}`
    );
  }
}

function readPreviousCompanyNames() {
  const companiesPath = path.join(DATA_DIR, "companies.js");
  if (!fs.existsSync(companiesPath)) return new Set();
  const content = fs.readFileSync(companiesPath, "utf-8");
  const names = new Set();
  const re = /\{ name: "((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(content))) names.add(JSON.parse(`"${m[1]}"`));
  return names;
}

// --- Vaisseaux (voir js/uex.js:syncUexShips) -----------------------------
// Filtre identique : un vaisseau non canonique (id_parent différent de son
// propre id) n'est gardé que si son SCU diffère de celui de son vaisseau de
// base (vraie variante à cargo distinct, ex. Ironclad Assault, Freelancer
// MAX) -- une variante purement peinture/édition (même SCU que le
// vaisseau de base) reste exclue.
async function fetchShips() {
  const vehicles = await uexGet("vehicles");
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return vehicles
    .filter((v) => {
      if (v.is_ground_vehicle || !(v.scu > 0)) return false;
      if (v.id === v.id_parent) return true;
      const parent = byId.get(v.id_parent);
      return parent ? v.scu !== parent.scu : true;
    })
    .map((v) => ({ name: v.name, scu: v.scu, company: v.company_name || "" }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// --- Lieux Star Citizen Wiki (voir js/scwiki.js:syncScwikiLocations) ----

const SCWIKI_RELEVANT_TYPES = ["Outpost", "Manmade", "Moon", "Planet", "Settlement"];

async function fetchScwikiLocations() {
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
  return collected;
}

// --- Écriture des fichiers, dans le même style que l'existant -----------

function formatEntries(entries, fields) {
  return entries
    .map((e) => `  { ${fields.map((f) => `${f}: ${JSON.stringify(e[f])}`).join(", ")} },`)
    .join("\n");
}

// locations.js/commodities.js/companies.js ont un BOM UTF-8 dans le dépôt
// (pas ships.js ni scwiki-locations.js) : le préserver évite un diff de
// tout le fichier sur la seule première ligne à chaque régénération.
const FILES_WITH_BOM = new Set(["locations.js", "commodities.js", "companies.js"]);

function writeDataFile(filename, header, varName, entries, fields) {
  const body = formatEntries(entries, fields);
  const bom = FILES_WITH_BOM.has(filename) ? "﻿" : "";
  const content = `${bom}${header}\nconst ${varName} = [\n${body}\n];\n`;
  fs.writeFileSync(path.join(DATA_DIR, filename), content, "utf-8");
  console.log(`${filename}: ${entries.length} entrées`);
}

function writeScwikiFile(entries) {
  const header = `"use strict";

// Lieux issus de l'API communautaire Star Citizen Wiki (https://api.star-citizen.wiki),
// beaucoup plus granulaire que UEX (avant-postes mineurs, points de livraison isoles,
// etc.). Utilise uniquement en secours (resolveOrCreateLocation) quand aucun lieu UEX
// ne correspond, pour donner un meilleur nom/systeme/planete au lieu cree
// automatiquement. Limite aux categories utiles pour des missions cargo (avant-postes,
// installations, lunes, planetes, villes) -- les asteroides/anomalies/etoiles sont
// exclus. Genere le ${TODAY} (scripts/refresh-data.js). Rafraichissable via "Tout synchroniser".
const DEFAULT_SCWIKI_LOCATIONS = `;
  const content = `${header}${JSON.stringify(entries)};\n`;
  fs.writeFileSync(path.join(DATA_DIR, "scwiki-locations.js"), content, "utf-8");
  console.log(`scwiki-locations.js: ${entries.length} entrées`);
}

async function main() {
  const locations = await fetchLocations();
  writeDataFile(
    "locations.js",
    `// Liste de lieux generee depuis l'API UEX Corp (https://uexcorp.space/api/documentation/).
// Un lieu par station/ville/avant-poste/lune (dedoublonne), avec l'ID de terminal UEX
// (uexTerminalId) et l'ID d'orbite (orbitId) associes, utilises pour les distances.
// Genere le ${TODAY} (scripts/refresh-data.js).`,
    "DEFAULT_LOCATIONS",
    locations,
    ["id", "name", "category", "uexTerminalId", "orbitId"]
  );

  const commodities = await fetchCommodities();
  writeDataFile(
    "commodities.js",
    `// Liste des commodites generee depuis l'API UEX Corp (https://uexcorp.space/api/documentation/).
// Genere le ${TODAY} (scripts/refresh-data.js). Utilisee pour l'autocompletion du champ marchandise des missions.`,
    "DEFAULT_COMMODITIES",
    commodities,
    ["name", "kind", "illegal"]
  );

  const previousCompanyNames = readPreviousCompanyNames();
  const companies = await fetchCompanies();
  warnIfReputationLadderCompanyMissing(previousCompanyNames, companies);
  writeDataFile(
    "companies.js",
    `// Liste des entreprises/donneurs de mission generee depuis l'API UEX Corp
// (https://uexcorp.space/api/documentation/). Genere le ${TODAY} (scripts/refresh-data.js).
// Utilisee pour l'autocompletion du champ donneur de mission.`,
    "DEFAULT_COMPANIES",
    companies,
    ["name", "industry"]
  );

  const ships = await fetchShips();
  writeDataFile(
    "ships.js",
    `// Liste des vaisseaux (capacite cargo en SCU) generee depuis l'API UEX Corp
// (https://uexcorp.space/api/documentation/). Genere le ${TODAY} (scripts/refresh-data.js).
// Seuls les vaisseaux avec une capacite cargo non nulle sont retenus ; les
// variantes purement cosmetiques/edition (meme SCU que leur vaisseau de base)
// restent exclues -- voir js/uex.js:syncUexShips et ce script:fetchShips.`,
    "DEFAULT_SHIPS",
    ships,
    ["name", "scu", "company"]
  );

  const scwikiLocations = await fetchScwikiLocations();
  writeScwikiFile(scwikiLocations);
}

main().catch((err) => {
  console.error("Échec de la régénération :", err);
  process.exit(1);
});
