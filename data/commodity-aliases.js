"use strict";

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
  "aliments transformés": "Processed Food",
  "aslarite (brut)": "Aslarite (Raw)",
  "beryl (brut)": "Beryl (Raw)",
  "bexalite (brut)": "Bexalite (Raw)",
  "cadeaux de fête": "Party Favors",
  "carapace de scarabée pierre": "Stone Bug Shell",
  "corindum (brut)": "Corundum (Raw)",
  "diamond (brut)": "Diamond (Raw)",
  "fer": "Iron",
  "fer (ore)": "Iron (Ore)",
  "feux d'artifice": "Fireworks",
  "fournitures médicales": "Medical Supplies",
  "hephaes. (brut)": "Hephaestanite (Raw)",
  "laranite (ore)": "Laranite (Raw)",
  "matériaux de construction": "Construction Materials",
  "medmon doré": "Golden Medmon",
  "medsticks lifecure": "LifeCure Medsticks",
  "mousse thermique": "Thermalfoam",
  "nourriture fraîche": "Fresh Food",
  "peaux d'osoian": "Osoian Hides",
  "pod revenant": "Revenant Pod",
  "quanta. (brut)": "Quantainium (Raw)",
  "quartz (brut)": "Quartz (Raw)",
  "sadaryx (brut)": "Sadaryx (Raw)",
  "stileron (ore)": "Stileron (Raw)",
  "taranite (brut)": "Taranite (Raw)",
  "tirtium": "Tritium",
};
