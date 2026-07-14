"use strict";

// Reproduit le pipeline OCR reel (js/ocr.js) en Node, sans navigateur :
// - decoupe bandeau du haut / colonne de droite avec sharp (memes ratios
//   que cropImageToCanvas/runOcrOnMissionScreenshot : 22% hauteur, 45% largeur)
// - lance tesseract.js sur chaque decoupe
// - passe le texte brut obtenu dans le vrai parseOcrText (js/ocr.js) + les
//   fonctions de reputation/alias de js/app.js (extraites telles quelles)

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const IMAGES_DIR = "C:\\Users\\djour\\OneDrive\\Images\\ScreenShotAdobe\\Optimisation OCR";

function extractFunctionSource(fileText, functionName) {
  const startRe = new RegExp("function\\s+" + functionName + "\\s*\\(");
  const startMatch = startRe.exec(fileText);
  if (!startMatch) throw new Error("Fonction introuvable dans app.js : " + functionName);
  let i = startMatch.index;
  const braceStart = fileText.indexOf("{", i);
  let depth = 0;
  let j = braceStart;
  for (; j < fileText.length; j++) {
    if (fileText[j] === "{") depth++;
    else if (fileText[j] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return fileText.slice(i, j + 1);
}

function buildSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);

  const dataFiles = [
    "data/commodity-aliases.js",
    "data/mission-reputation.js",
    "data/mission-reputation-by-title.js",
    "data/mission-title-aliases.js",
  ];
  dataFiles.forEach((rel) => {
    const src = fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8");
    vm.runInContext(src, sandbox, { filename: rel });
  });

  const ocrSrc = fs.readFileSync(path.join(PROJECT_ROOT, "js/ocr.js"), "utf8");
  vm.runInContext(ocrSrc, sandbox, { filename: "js/ocr.js" });

  // Fonctions de app.js reutilisees telles quelles (pas de dependance DOM) :
  // reprises par extraction de source plutot que d'evaluer tout app.js
  // (qui appelle localStorage/document au chargement du module).
  const appSrc = fs.readFileSync(path.join(PROJECT_ROOT, "js/app.js"), "utf8");
  [
    "effectiveRewardMax",
    "pickReputationVariant",
    "findTitleReputationVariants",
    "findGiverReputationVariants",
    "estimateMissionReputation",
    "formatReputationGain",
    "resolveCommodityName",
  ].forEach((fnName) => {
    const fnSrc = extractFunctionSource(appSrc, fnName);
    vm.runInContext(fnSrc, sandbox, { filename: "js/app.js#" + fnName });
  });

  return sandbox;
}

async function cropBuffer(imagePath, left, top, width, height) {
  return sharp(imagePath).extract({ left, top, width, height }).png().toBuffer();
}

async function ocrMissionScreenshot(imagePath) {
  const meta = await sharp(imagePath).metadata();
  const w = meta.width;
  const h = meta.height;

  const topBandHeight = Math.round(h * 0.22);
  const rightColumnLeft = Math.round(w * 0.45);

  const [topLeftBuf, topRightBuf, rightBuf] = await Promise.all([
    cropBuffer(imagePath, 0, 0, rightColumnLeft, topBandHeight),
    cropBuffer(imagePath, rightColumnLeft, 0, w - rightColumnLeft, topBandHeight),
    cropBuffer(imagePath, rightColumnLeft, topBandHeight, w - rightColumnLeft, h - topBandHeight),
  ]);

  const [topLeftResult, topRightResult, rightResult] = await Promise.all([
    Tesseract.recognize(topLeftBuf, "fra+eng"),
    Tesseract.recognize(topRightBuf, "fra+eng"),
    Tesseract.recognize(rightBuf, "fra+eng"),
  ]);

  return `${topLeftResult.data.text}\n${topRightResult.data.text}\n${rightResult.data.text}`;
}

async function main() {
  const files = fs
    .readdirSync(IMAGES_DIR)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();

  const sandbox = buildSandbox();

  for (const file of files) {
    const imagePath = path.join(IMAGES_DIR, file);
    console.log("\n" + "=".repeat(80));
    console.log(file);
    console.log("=".repeat(80));

    const rawText = await ocrMissionScreenshot(imagePath);
    console.log("--- TEXTE BRUT OCR ---");
    console.log(rawText);

    sandbox.__rawText = rawText;
    const parsed = vm.runInContext("parseOcrText(__rawText)", sandbox);
    console.log("--- PARSED ---");
    console.log(JSON.stringify(parsed, null, 2));

    sandbox.__parsed = parsed;
    const rep = vm.runInContext(
      "estimateMissionReputation({ name: __parsed.name, giver: __parsed.giver, reward: __parsed.reward })",
      sandbox
    );
    sandbox.__rep = rep;
    const repText = vm.runInContext("formatReputationGain(__rep)", sandbox);
    console.log("--- REPUTATION ESTIMEE ---");
    console.log(repText || "(aucune)");

    sandbox.__cargoItems = parsed.cargoItems;
    const resolvedCommodities = vm.runInContext(
      "__cargoItems.map((c) => ({ raw: c.commodity, resolved: resolveCommodityName(c.commodity) }))",
      sandbox
    );
    console.log("--- MARCHANDISES RESOLUES ---");
    console.log(JSON.stringify(resolvedCommodities, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
