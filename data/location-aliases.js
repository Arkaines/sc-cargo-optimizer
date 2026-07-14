"use strict";

// Alias "texte affiché en jeu (client français)" -> id de lieu UEX, pour les
// cas où le nom vu dans une capture d'écran (traduction française) ne
// correspond pas au nom UEX (anglais) utilisé dans data/locations.js.
// Clé = slug du texte français (voir slugify() dans app.js). Constitué au fil
// des écarts rencontrés en jeu, en vérifiant le libellé exact dans le fichier
// de traduction du jeu (Localization/french_(france)/global.ini).
const LOCATION_ALIASES = {
  "avant-poste-de-recherche-rayari-anvik": "uex-outpost-39",
};
