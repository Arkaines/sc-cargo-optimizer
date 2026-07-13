"use strict";

// =========================================================================
// Reconnaissance de texte (OCR) sur une capture d'écran du contrat en jeu.
// Tourne entièrement dans le navigateur via Tesseract.js (WebAssembly) :
// aucune image n'est envoyée à un service externe.
// =========================================================================

async function runOcrOnImage(imageSource) {
  const {
    data: { text },
  } = await Tesseract.recognize(imageSource, "eng+fra");
  return text;
}

// Analyse du texte brut reconnu pour en extraire les champs de mission.
// Le format exact de l'écran de contrat n'a pas encore été calibré sur un
// vrai exemple : cette fonction ne fait pour l'instant qu'un best-effort
// minimal (texte brut affiché tel quel) et sera affinée dès qu'un
// échantillon réel (capture + texte attendu) sera fourni.
function parseOcrText(text) {
  return {
    raw: text,
    name: "",
    giver: "",
    commodity: "",
    cargo: "",
    reward: "",
  };
}
