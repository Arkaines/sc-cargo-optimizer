"use strict";

// Alias "nom affiché en jeu (client français)" -> nom UEX (anglais), pour les
// marchandises dont le nom traduit ne correspond à rien dans data/commodities.js.
// Clé = nom français en minuscules. Constitué au fil des écarts rencontrés,
// vérifié dans le fichier de traduction du jeu (Localization/french_(france)/global.ini).
const COMMODITY_ALIASES = {
  "medmon doré": "Golden Medmon",
  "baies du soleil couchant": "Sunset Berries",
  "baies du crépuscule": "Sunset Berries",
};
