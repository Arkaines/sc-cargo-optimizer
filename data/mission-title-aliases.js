"use strict";

// Le client français traduit les titres de contrat (contrairement à ce qu'on
// pensait au départ) — mais souvent de façon peu littérale, donc une simple
// table figée "titre français complet -> titre anglais complet" ne tient pas
// la route pour les contrats "généricos" dont le titre inclut le nom d'une
// entreprise variable (ex : "Opportunité de Transport de Fret chez Ling
// Hauling"). On a exploré un pont automatique via le champ debug_name de
// l'API Star Citizen Wiki croisé avec les clés du fichier de traduction local
// (Localization/french_(france)/global.ini) : les schémas de nommage ne se
// correspondent pas assez proprement pour être fiables (préfixes/segments
// différents entre les deux systèmes), donc on est reparti sur des modèles
// construits à la main, au fil des rencontres, comme data/commodity-aliases.js.
//
// Chaque modèle associe un FRAGMENT FIXE du titre français (sans le nom de
// l'entreprise, qui varie) à son équivalent anglais dans le catalogue
// (data/mission-reputation-by-title.js). Le nom de l'entreprise est repris du
// champ "donneur" déjà extrait de façon fiable ("Émis Par"/"Proposé Par"),
// plutôt que d'essayer de le relire depuis le titre lui-même (sujet aux
// erreurs OCR, ex : "Ling" lu "Lin").
const FRENCH_MISSION_TITLE_TEMPLATES = [
  {
    frenchFragment: "opportunité de transport de fret chez",
    englishPrefix: "Cargo Hauling Opportunity with",
  },
  {
    frenchFragment: "opportunité de transport de fret avec",
    englishPrefix: "Cargo Hauling Opportunity with",
  },
];
