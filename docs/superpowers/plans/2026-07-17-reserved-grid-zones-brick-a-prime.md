# Zones de grille réservées — Brique A′ — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire passer le contrat des réservations de `cargo-packing.js` d'une empreinte unique indexée par `hold.name` à une **liste** d'empreintes indexée par la clé désambiguïsée **`moduleKey`** — levant les deux limitations (soutes homonymes, un seul véhicule par soute) sans toucher la barrière dure.

**Architecture :** L'admission des réservations dans `simulateRoutePacking` devient : (1) calculer la clé `moduleKey(hold, holds)` du module (réplique de la fonction du visualiseur, ajoutée à `cargo-packing.js`) ; (2) lire `reservations[moduleKey]` comme un **tableau** ; (3) valider chaque empreinte et **boucler** le pré-marquage + l'injection d'obstacle. La barrière dure (`findBestPosition`/`tryStackOnExisting`) est **inchangée** : elle fait déjà `activeBoxes.some(ab => ab.reserved && …)`, qui gère N obstacles.

**Tech Stack :** JavaScript vanilla (script classique). Tests via `scripts/cargo-packing-tests.cjs` (runner maison + `assert`, chargé dans un `vm` au contexte `{ Object, Math, Array, String }`).

## Global Constraints

- **Rétrocompat absolue :** `reservations` reste le 5ᵉ argument optionnel. Absent / `{}` / clé absente / liste vide → comportement identique. Les **34 tests d'origine (pré-brique-A) restent verts ET inchangés**.
- **Aucune dépendance navigateur** : contexte `vm` = `{ Object, Math, Array, String }`. Pas de `Number`/`isFinite` global ; la réplique de `moduleKey` n'utilise que `Array.filter/indexOf` et des comparaisons de chaînes.
- **Repère packing :** `cellDims = [x, y, z]`, Z (index 2) vertical. Empreinte sur axes 0 et 1, hauteur = tout l'axe 2.
- **Ne PAS toucher** : la barrière dure (les deux gardes `some(ab.reserved…)`), le score `worstConflictDropoff`, `assignMissionZones`.
- **`moduleKey` doit être la réplique EXACTE** de `js/cargo-viewer.js:294-299` (duplication assumée, à garder synchronisée — même esprit que `syncUexShips`/`fetchShips`, voir `CLAUDE.md`).
- Spec : `docs/superpowers/specs/2026-07-17-reserved-grid-zones-brick-a-prime-design.md`.

---

## Repères de code (lus, exacts au moment du plan)

- `RESERVED_CELL = { reserved: true }` — `js/cargo-packing.js:797`.
- `resolveReservation(reservations, hold, cellDims)` — `js/cargo-packing.js:804-819` (à **remplacer** par `resolveReservations`, au pluriel).
- Montage du module dans `simulateRoutePacking` — la `holds.map((h) => {…})` commence `js/cargo-packing.js:822` ; `module.faceAxes` posé ligne **847** ; le bloc réservation actuel (résolution unique + pré-marquage + push) lignes **848-865** ; `return module` ligne **866**.
- La signature `simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces, reservations)` — ligne **821**. Le tableau `holds` complet est disponible dans le scope de la `.map`.
- `moduleKey` du visualiseur — `js/cargo-viewer.js:294-299` :
  ```js
  function moduleKey(hold, holds) {
    const name = hold.name || "";
    const sameName = holds.filter((h) => (h.name || "") === name);
    if (sameName.length <= 1) return name;
    return `${name}#${sameName.indexOf(hold)}`;
  }
  ```
- Les **9 tests de la brique A** (à reshaper) — `scripts/cargo-packing-tests.cjs`, tous entre le helper `overlapsReserved` (ligne 730) et le bloc runner. Leurs formes de réservation actuelles :
  - l.745 `{ bay: { x0: 0, y0: 0, sx: 2, sy: 2 } }`
  - l.760 `{ full: { x0: 0, y0: 0, sx: 2, sy: 2 } }`
  - l.771-776 (test « invalid ») un tableau `bad` de 4 objets `{ bay: { … } }`
  - l.803 `{ bay: { x0: 0, y0: 0, sx: 1, sy: 1 } }`
  - l.814 `{ bay: { x0: 0, y0: 0, sx: 1, sy: 1 } }`
  - l.835 `{ bay: { x0: 0, y0: 0, sx: 1, sy: 1 } }`
  - l.853 `{ bay: { x0: 0, y0: 0, sx: 1, sy: 1 } }`
  - l.872 `{ bay: { x0: 0, y0: 1, sx: 1, sy: 1 } }`

---

## Task 1 : Contrat liste + clé `moduleKey`

**Files:**
- Modify: `js/cargo-packing.js` (remplacer `resolveReservation` ~804-819 ; ajouter `moduleKey` près de là ; réécrire le bloc réservation ~848-865)
- Test: `scripts/cargo-packing-tests.cjs` (reshaper les 9 réservations existantes ; ajouter 4 tests)

**Interfaces:**
- Consumes : `RESERVED_CELL`, `markPlaced`, `cellsFromDimensions`, `depthAxisIndex`, `moduleAxes`, `accessibleFaceAxes`.
- Produces (consommé par la brique B) :
  - Contrat `reservations = { [moduleKey(hold, holds)]: [ {x0,y0,sx,sy}, ... ] }`.
  - `moduleKey(hold, holds)` (fonction fichier dans `cargo-packing.js`, réplique exacte du visualiseur).
  - `resolveReservations(reservations, hold, holds, cellDims)` → tableau d'empreintes valides (`[]` si rien).

- [ ] **Step 1 : Reshaper les 9 réservations des tests brique A vers la forme liste (les fait échouer)**

Dans `scripts/cargo-packing-tests.cjs`, envelopper chaque valeur de réservation dans un tableau. Remplacements exacts (chaque `{ clé: { … } }` → `{ clé: [ { … } ] }`) :

```js
// l.745
const reservations = { bay: [{ x0: 0, y0: 0, sx: 2, sy: 2 }] };
// l.760
const reservations = { full: [{ x0: 0, y0: 0, sx: 2, sy: 2 }] };
// l.803
const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
// l.814
const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
// l.835
const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
// l.853
const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] };
// l.872
const reservations = { bay: [{ x0: 0, y0: 1, sx: 1, sy: 1 }] };
```

Pour le test « invalid reservation is ignored » (le tableau `bad`, ~l.771-776), envelopper chaque cas dans une liste — l'intention devient « une empreinte invalide dans une liste est écartée » :

```js
  const bad = [
    { bay: [{ x0: 0, y0: 0, sx: 99, sy: 1 }] }, // déborde
    { bay: [{ x0: 0, y0: 0, sx: 0, sy: 1 }] }, // taille nulle
    { bay: [{ x0: 0, y0: 0, sx: 1.5, sy: 1 }] }, // non entier
    { bay: [{ x0: -1, y0: 0, sx: 1, sy: 1 }] }, // négatif
  ];
```

Le test « omitting reservations » (l.788) n'a pas de réservation à reshaper — le laisser tel quel.

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `node scripts/cargo-packing-tests.cjs`
Expected : les tests reshapés **échouent** (le code actuel lit `reservations[hold.name]` comme un objet et lit `.x0` sur un **tableau** → `undefined` → `resolveReservation` renvoie `null` → aucune réservation appliquée → les assertions d'exclusion cassent). Les 34 d'origine passent toujours.

- [ ] **Step 3 : Ajouter `moduleKey` (réplique exacte) dans `cargo-packing.js`**

Juste avant `RESERVED_CELL` (~l.797), ajouter :

```js
// Clé désambiguïsée d'un module — RÉPLIQUE EXACTE de moduleKey dans
// js/cargo-viewer.js (module ES, non importable ici). Les deux côtés (rendu et
// rangement) doivent la calculer identiquement pour un même `holds`, sinon une
// réservation posée sur une soute ne serait pas retrouvée par le packer. À
// garder synchronisée avec le visualiseur (duplication assumée, cf. CLAUDE.md).
function moduleKey(hold, holds) {
  const name = hold.name || "";
  const sameName = holds.filter((h) => (h.name || "") === name);
  if (sameName.length <= 1) return name;
  return `${name}#${sameName.indexOf(hold)}`;
}
```

- [ ] **Step 4 : Remplacer `resolveReservation` par `resolveReservations` (liste, clé moduleKey)**

Remplacer intégralement la fonction `resolveReservation` (~l.799-819) par :

```js
// Valide et normalise la LISTE de réservations d'un module (une empreinte par
// véhicule garé). Lue sous la clé désambiguïsée moduleKey (soutes homonymes
// indépendantes). Renvoie un tableau des empreintes valides ({x0,y0,sx,sy}) ;
// [] si aucune. Le packer ne fait jamais confiance à son entrée : une empreinte
// hors module, de taille nulle/négative, ou non entière, est écartée (pas de
// plantage). Une valeur non-tableau (clé absente, forme inattendue) -> [].
function resolveReservations(reservations, hold, holds, cellDims) {
  if (!reservations) return [];
  const list = reservations[moduleKey(hold, holds)];
  if (!Array.isArray(list)) return [];
  // Entier fini sans dépendre de `Number` (contexte vm restreint) : `v*0===0`
  // écarte Infinity/NaN, `Math.floor(v)===v` exige l'entier.
  const isCell = (v) => typeof v === "number" && v * 0 === 0 && Math.floor(v) === v;
  const out = [];
  for (const r of list) {
    if (!r) continue;
    const { x0, y0, sx, sy } = r;
    if (![x0, y0, sx, sy].every(isCell)) continue;
    if (sx < 1 || sy < 1 || x0 < 0 || y0 < 0) continue;
    if (x0 + sx > cellDims[0] || y0 + sy > cellDims[1]) continue;
    out.push({ x0, y0, sx, sy });
  }
  return out;
}
```

- [ ] **Step 5 : Boucler le montage sur la liste**

Remplacer le bloc réservation actuel (~l.848-865, du commentaire « Zone réservée… » jusqu'à la fermeture du `if (reservation) { … }`) par :

```js
    // Zones réservées à des véhicules garés (brique A′) : 0..N obstacles
    // permanents pleine hauteur par module. Chacun pré-marque ses cellules
    // (rien ne s'y range) ET s'injecte dans activeBoxes comme obstacle qui ne
    // part jamais (dropoffStop=Infinity), pour la garde dure d'accès de
    // findBestPosition/tryStackOnExisting (inchangée : elle fait some(reserved)).
    resolveReservations(reservations, h, holds, cellDims).forEach(({ x0, y0, sx, sy }) => {
      const size = [sx, sy, cellDims[2]];
      markPlaced(module.grid, [x0, y0, 0], size, RESERVED_CELL);
      // Pas de mise à jour de usedCells : ce compteur suit les caisses rangées,
      // pas l'espace physiquement indisponible.
      module.activeBoxes.push({
        position: [x0, y0, 0],
        size,
        dropoffStop: Infinity, // jamais retiré (aucun step === Infinity)
        reserved: true,
      });
    });
```

- [ ] **Step 6 : Lancer les tests, vérifier que les reshapés repassent**

Run: `node scripts/cargo-packing-tests.cjs`
Expected : de nouveau `43/43 passed` (34 d'origine + 9 brique-A reshapés, tous verts). `node --check js/cargo-packing.js` propre.

- [ ] **Step 7 : Ajouter les 4 tests A′**

Ajouter dans `scripts/cargo-packing-tests.cjs`, avant le bloc runner :

```js
// ===== Brique A′ : clé moduleKey + liste par module ======================

// Deux empreintes disjointes dans un même module : aucune caisse ne les occupe.
test("reserved A': two footprints in one module are both excluded", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 1, sy: 1 }, { x0: 4, y0: 1, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.placements.forEach((p) => {
    assert.ok(!overlapsReserved(p, 0, 0, 1, 1), "caisse dans la 1re empreinte réservée");
    assert.ok(!overlapsReserved(p, 4, 1, 1, 1), "caisse dans la 2e empreinte réservée");
  });
});

// Soutes homonymes indépendantes : réserver "bay#1" ne touche pas "bay" (index 0).
test("reserved A': homonymous holds are keyed independently", () => {
  const ctx = loadCargoPacking();
  const holds = [
    { name: "bay", dimensions: { x: 2.5, y: 1.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
    { name: "bay", dimensions: { x: 2.5, y: 1.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
  ];
  const entries = [{ quantity: 2, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  // Réservation UNIQUEMENT sur le 2e hold (clé "bay#1").
  const reservations = { "bay#1": [{ x0: 0, y0: 0, sx: 2, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  // Le 2e hold (index 1) est entièrement réservé -> aucune caisse ; tout va au 1er.
  // On distingue les deux holds homonymes par identité d'objet du hold placé.
  const inSecond = r.placements.filter((p) => p.module === holds[1]);
  assert.strictEqual(inSecond.length, 0, "une caisse a atterri dans le hold réservé bay#1");
});

// Liste vide et clé absente : identiques à sans réservation.
test("reserved A': empty list and missing key behave like no reservation", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 2, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const base = ctx.simulateRoutePacking(entries, holds, 2);
  const empty = ctx.simulateRoutePacking(entries, holds, 2, undefined, { bay: [] });
  const missing = ctx.simulateRoutePacking(entries, holds, 2, undefined, { other: [{ x0: 0, y0: 0, sx: 1, sy: 1 }] });
  assert.deepStrictEqual(empty.placements.map((p) => p.position), base.placements.map((p) => p.position));
  assert.deepStrictEqual(missing.placements.map((p) => p.position), base.placements.map((p) => p.position));
});

// Une empreinte invalide dans une liste par ailleurs valide : seule la valide s'applique.
test("reserved A': an invalid footprint in a list is skipped, valid ones apply", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: [{ x0: 0, y0: 0, sx: 99, sy: 1 }, { x0: 0, y0: 0, sx: 1, sy: 1 }] };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  // La bonne (0,0,1,1) est exclue ; la mauvaise est ignorée (pas de plantage).
  r.placements.forEach((p) => assert.ok(!overlapsReserved(p, 0, 0, 1, 1)));
  assert.strictEqual(r.placements.length, 1, "la caisse doit se placer ailleurs, pas disparaître");
});
```

- [ ] **Step 8 : Lancer les tests, vérifier qu'ils passent**

Run: `node scripts/cargo-packing-tests.cjs`
Expected : `47/47 passed` (34 d'origine + 9 brique-A reshapés + 4 A′). Les 34 d'origine strictement inchangés.

- [ ] **Step 9 : Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Zones réservées (brique A′) : clé moduleKey + liste d'empreintes par module"
```

---

## Notes de vérification finale (revue de branche)

- **La barrière dure et le score ne doivent PAS avoir changé** — diff `findBestPosition`, `tryStackOnExisting`, `worstConflictDropoff` : zéro modification. Seuls `resolveReservation`→`resolveReservations`, l'ajout de `moduleKey`, et la boucle de montage changent.
- **`moduleKey` réplique fidèle** de `js/cargo-viewer.js:294-299` (même sortie pour un même `holds`).
- **Rétrocompat** : les 34 tests d'origine inchangés, verts.
- **Barre finale** attendue : `47/47 passed`.
