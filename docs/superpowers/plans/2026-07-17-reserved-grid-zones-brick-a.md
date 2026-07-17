# Zones de grille réservées — Brique A (le rangement) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enseigner à `js/cargo-packing.js` à accepter des zones réservées (véhicule garé) et à les exclure du rangement — cellules jamais occupées, et interdiction dure de placer derrière le véhicule — sans aucune UI.

**Architecture :** Un 5ᵉ paramètre optionnel `reservations` de `simulateRoutePacking`. Au montage de chaque module : valider la réservation, pré-marquer ses cellules (pleine hauteur) dans la grille d'occupation, et injecter un obstacle permanent dans `activeBoxes`. Une garde dure, réutilisant `isBlockedFromEveryAccessibleFace`, refuse toute position que l'obstacle bloque par toutes les faces accessibles — dans `findBestPosition` et `tryStackOnExisting`.

**Tech Stack :** JavaScript vanilla (script classique, aucune dépendance). Tests via le harnais Node existant `scripts/cargo-packing-tests.cjs` (runner maison + `assert` natif, chargé dans un `vm` au contexte `{ Object, Math, Array, String }`).

## Global Constraints

- **Rétrocompat absolue :** `reservations` est le 5ᵉ argument, **optionnel**. Absent ou `{}` → comportement identique à aujourd'hui. Les **34 tests existants restent verts, inchangés**.
- **Aucune dépendance navigateur** dans `js/cargo-packing.js` (chargé dans un `vm` au contexte `{ Object, Math, Array, String }`) : pas de `document`, `window`, `localStorage`, `alert`.
- **Repère `cargo-packing.js` :** `cellDims = [x, y, z]`, **Z (index 2) est l'axe vertical**. L'empreinte réservée est sur les axes **0 et 1** ; la hauteur est **tout** l'axe 2.
- **1 SCU = 1,25 m cube.** `capacity` est TOUJOURS dérivée, jamais saisie — la brique A n'y touche pas.
- **Interdiction dure (décision utilisateur) :** une position que l'obstacle réservé bloque par TOUTES les faces accessibles est **refusée** (niveau `canPlace`/`hasValidSupport`), pas seulement pénalisée par le score de sévérité.
- **Barre verte :** `node scripts/cargo-packing-tests.cjs` doit afficher `(34 + N)/(34 + N) passed`, les 34 d'origine inchangés.
- **Une seule zone réservée par module.**
- Spec de référence : `docs/superpowers/specs/2026-07-17-reserved-grid-zones-brick-a-design.md`.

---

## Repères de code (lus, exacts au moment du plan)

- `simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces)` commence à `js/cargo-packing.js:764`. Le montage des modules est la `holds.map((h) => {...})` lignes **765–792** ; chaque module a `{ hold, cellDims, grid, depthAxis, widthAxis, heightAxis, usedCells, activeBoxes, layerUsage, faceAxes }`. `module.faceAxes` est posé ligne **790**, juste avant le `return module` ligne 791.
- `createOccupancyGrid(cellDims)` → grille `grid[x][y][z]` de `null`. `markPlaced(grid, pos, size, value)` remplit un pavé avec `value`. `canPlace` rejette toute cellule non nulle (`if (grid[x][y][z]) return false`).
- Une entrée `activeBoxes` réelle a la forme `{ position, size, dropoffStop, missionId }` (créée lignes **1054–1059**).
- `isBlockedFromEveryAccessibleFace(faceAxesList, blockerPos, blockerSize, targetPos, targetSize)` (ligne **301**) : `true` si `blocker` bloque `target` par TOUTES les faces de la liste. C'est le prédicat de la garde dure.
- `findBestPosition(grid, cellDims, box, depthAxis, dropoffStop, activeBoxes, layerUsage, idealDepth, restriction, missionId, faceAxes)` (ligne **450**). Boucle de balayage lignes **472–499** : pour chaque `pos`/`size`, `if (!canPlace(...)) continue; if (!hasValidSupport(...)) continue;` puis construit `candidate`. `effectiveFaceAxes` (locale, ligne **454**) et `activeBoxes` (paramètre) sont disponibles.
- `tryStackOnExisting(existingBoxes, box, dropoffStop, missionId)` (ligne **512**) : empile sur une caisse déjà posée. `m = other.placement.module` porte `m.activeBoxes` et `m.faceAxes`. Le `markPlaced` de pose est ligne **521**.
- Retour de `simulateRoutePacking` : `{ placements, unplaced, conflicts, peakStepIndex }` (ligne **1085**). Chaque `placement` = `{ module (=hold), position, size, box, entry, pickupStop, dropoffStop, conflict }`.
- Harnais de test : `scripts/cargo-packing-tests.cjs`. `loadCargoPacking()` renvoie un `ctx` avec toutes les fonctions ; `test(name, fn)` enregistre ; on appelle `ctx.simulateRoutePacking(entries, holds, stepCount[, accessFaces, reservations])`. `holds = [{ name, dimensions:{x,y,z}, capacity, maxContainerSize }]`. Le runner est en bas du fichier.

**Helper de test à réutiliser** (le définir une fois en haut de la zone des nouveaux tests, voir Task 1 étape 1) :

```js
// Vrai si un placement occupe au moins une cellule du pavé réservé
// [rx, ry, 0]..[rx+rsx, ry+rsy, hauteur[ sur les axes 0 et 1 (Z ignoré :
// la réservation est pleine hauteur, donc tout chevauchement XY compte).
function overlapsReserved(placement, rx, ry, rsx, rsy) {
  const [px, py] = placement.position;
  const [sx, sy] = placement.size;
  const sepX = px + sx <= rx || rx + rsx <= px;
  const sepY = py + sy <= ry || ry + rsy <= py;
  return !(sepX || sepY);
}
```

---

## Task 1 : Admission des réservations — exclusion dure des cellules

**Files:**
- Modify: `js/cargo-packing.js` (montage des modules dans `simulateRoutePacking`, ~765–792 ; signature ligne 764)
- Test: `scripts/cargo-packing-tests.cjs` (ajouter des `test(...)` avant le bloc runner en bas)

**Interfaces:**
- Consumes : `simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces)`, `createOccupancyGrid`, `markPlaced`, `cellsFromDimensions`.
- Produces (consommé par Task 2) :
  - Signature élargie `simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces, reservations)`.
  - Une constante fichier `RESERVED_CELL` (valeur sentinelle non nulle) marquant les cellules réservées dans la grille.
  - Sur chaque module concerné, une entrée dans `module.activeBoxes` de forme `{ position:[x0,y0,0], size:[sx,sy,cellDims[2]], dropoffStop: Infinity, reserved: true }`.
  - Une fonction fichier `resolveReservation(reservations, hold, cellDims)` → `{ x0, y0, sx, sy }` validé, ou `null`.

- [ ] **Step 1 : Écrire les tests qui échouent (exclusion, module entier, invalide ignoré, rétrocompat, pas d'empilement sur le véhicule, usedCells)**

Ajouter dans `scripts/cargo-packing-tests.cjs`, juste avant le bloc runner final, d'abord le helper `overlapsReserved` (ci-dessus), puis :

```js
// ===== Brique A : zones réservées — admission (Task 1) ====================

// Un gros module bien large ; sans réservation une caisse se place en (0,0).
test("reserved: crate never occupies a reserved cell", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 6.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: { x0: 0, y0: 0, sx: 2, sy: 2 } };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.placements.forEach((p) => {
    assert.ok(!overlapsReserved(p, 0, 0, 2, 2), "un placement recouvre la zone réservée");
  });
});

// Réserver tout le module = ce module ne peut rien accueillir.
test("reserved: whole module reserved -> nothing placed there", () => {
  const ctx = loadCargoPacking();
  const holds = [
    { name: "full", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
    { name: "free", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 },
  ];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { full: { x0: 0, y0: 0, sx: 2, sy: 2 } };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  const inFull = r.placements.filter((p) => p.module.name === "full");
  assert.strictEqual(inFull.length, 0, "une caisse s'est placée dans le module entièrement réservé");
  assert.strictEqual(r.placements.length, 1, "la caisse aurait dû aller dans le module libre");
});

// Une réservation invalide est ignorée (comportement = sans réservation).
test("reserved: invalid reservation is ignored", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const base = ctx.simulateRoutePacking(entries, holds, 2);
  const bad = [
    { bay: { x0: 0, y0: 0, sx: 99, sy: 1 } }, // déborde
    { bay: { x0: 0, y0: 0, sx: 0, sy: 1 } }, // taille nulle
    { bay: { x0: 0, y0: 0, sx: 1.5, sy: 1 } }, // non entier
    { bay: { x0: -1, y0: 0, sx: 1, sy: 1 } }, // négatif
  ];
  bad.forEach((reservations) => {
    const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
    assert.strictEqual(r.placements.length, base.placements.length);
    assert.strictEqual(r.unplaced.length, base.unplaced.length);
  });
});

// Rétrocompat : appel SANS le 5e argument identique à avant (déjà couvert par
// les 34 tests ; on l'affirme aussi explicitement ici sur un cas simple).
test("reserved: omitting reservations keeps prior behaviour", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 2, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const a = ctx.simulateRoutePacking(entries, holds, 2);
  const b = ctx.simulateRoutePacking(entries, holds, 2, undefined, {});
  assert.deepStrictEqual(b.placements.map((p) => p.position), a.placements.map((p) => p.position));
});

// Pleine hauteur : rien ne repose sur une colonne réservée (§5.1).
test("reserved: nothing stacks on the reserved column", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 2.5, y: 1.25, z: 2.5 }, capacity: 999, maxContainerSize: 32 }];
  // Beaucoup de petites caisses : sans réservation certaines s'empilent (z>0).
  const entries = [{ quantity: 4, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: { x0: 0, y0: 0, sx: 1, sy: 1 } };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.placements.forEach((p) => {
    assert.ok(!overlapsReserved(p, 0, 0, 1, 1), "une caisse occupe la colonne réservée (empilée ou non)");
  });
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `node scripts/cargo-packing-tests.cjs`
Expected : les nouveaux tests **échouent** (le 5ᵉ paramètre est ignoré, donc des caisses tombent dans les cellules « réservées »). Les 34 d'origine passent toujours. Sortie du type `34/39 passed` (ou un compte reflétant les 5 nouveaux en échec).

- [ ] **Step 3 : Implémenter l'admission des réservations**

Dans `js/cargo-packing.js`, définir la sentinelle et le résolveur **avant** `simulateRoutePacking` (par ex. juste avant sa ligne 764) :

```js
// Valeur sentinelle occupant une cellule réservée à un véhicule garé (brique
// A). Non nulle -> canPlace la rejette comme occupée. Sans .scu ni .dropoffStop
// (contrairement à une vraie caisse) : si elle atteignait par erreur
// canStackOn/hasValidSupport, `<= undefined` renvoie false -> refus sûr. La
// réservation étant pleine hauteur, aucune cellule n'existe au-dessus d'elle,
// donc ce cas ne se produit pas — la sentinelle est une ceinture-bretelle.
const RESERVED_CELL = { reserved: true };

// Valide et normalise la réservation d'un module. Renvoie { x0, y0, sx, sy }
// (empreinte en cellules sur les axes 0 et 1) ou null si absente/invalide.
// Le packer ne fait jamais confiance à son entrée : une empreinte hors module,
// de taille nulle/négative, ou non entière, est ignorée (traitée comme absente)
// plutôt que de faire planter le rangement.
function resolveReservation(reservations, hold, cellDims) {
  if (!reservations) return null;
  const r = reservations[hold.name];
  if (!r) return null;
  const { x0, y0, sx, sy } = r;
  // Entier fini, sans dépendre de `Number` (le contexte vm du harnais de test
  // n'expose que { Object, Math, Array, String } comme variables globales —
  // `Number.isInteger` n'y est pas garanti). `v * 0 === 0` est vrai seulement
  // pour un nombre fini (Infinity*0 et NaN*0 valent NaN) ; `Math.floor(v) === v`
  // exige l'entier. N'utilise que typeof, l'arithmétique et Math : toujours dispo.
  const isCell = (v) => typeof v === "number" && v * 0 === 0 && Math.floor(v) === v;
  if (![x0, y0, sx, sy].every(isCell)) return null;
  if (sx < 1 || sy < 1 || x0 < 0 || y0 < 0) return null;
  if (x0 + sx > cellDims[0] || y0 + sy > cellDims[1]) return null;
  return { x0, y0, sx, sy };
}
```

Élargir la signature (ligne 764) :

```js
function simulateRoutePacking(cargoEntries, holds, stepCount, accessFaces, reservations) {
```

Dans la `holds.map((h) => {...})`, **après** la pose de `module.faceAxes` (ligne 790) et **avant** `return module` (ligne 791), insérer :

```js
    // Zone réservée à un véhicule garé (brique A) : obstacle permanent pleine
    // hauteur. On pré-marque ses cellules (rien ne s'y range) ET on l'injecte
    // dans activeBoxes comme obstacle qui ne part jamais (dropoffStop=Infinity),
    // pour la garde dure d'accès de findBestPosition/tryStackOnExisting.
    const reservation = resolveReservation(reservations, h, cellDims);
    if (reservation) {
      const { x0, y0, sx, sy } = reservation;
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
    }
```

- [ ] **Step 4 : Lancer les tests, vérifier qu'ils passent**

Run: `node scripts/cargo-packing-tests.cjs`
Expected : `39/39 passed` (34 d'origine inchangés + 5 nouveaux). Si un test d'origine casse, l'obstacle a fui dans un chemin non prévu — lire §5.2 du spec et recenser les itérations de `activeBoxes`.

- [ ] **Step 5 : Vérifier que l'obstacle n'est jamais livré ni signalé (lecture + assertion)**

Confirmer par lecture que la boucle de livraison (`boxes.filter((b) => b.dropoffStop === step && b.active)`) et la boucle de conflits n'itèrent que sur `boxes`, jamais sur `activeBoxes` pour y *sélectionner* une entrée à livrer/signaler (l'obstacle n'est pas dans `boxes`). Ajouter un test qui verrouille l'invariant :

```js
test("reserved: the parked-vehicle obstacle is never a reported conflict", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 3.75, y: 1.25, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const reservations = { bay: { x0: 0, y0: 0, sx: 1, sy: 1 } };
  const r = ctx.simulateRoutePacking(entries, holds, 2, undefined, reservations);
  r.conflicts.forEach((c) => assert.ok(c.entry, "un conflit sans entry = l'obstacle réservé a fui dans les conflits"));
});
```

Run: `node scripts/cargo-packing-tests.cjs` → `40/40 passed`.

- [ ] **Step 6 : Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Zones réservées (brique A) : admission + exclusion dure des cellules"
```

---

## Task 2 : La barrière dure — interdire de placer derrière le véhicule

**Files:**
- Modify: `js/cargo-packing.js` (`findBestPosition` boucle ~472–499 ; `tryStackOnExisting` ~512–528)
- Test: `scripts/cargo-packing-tests.cjs`

**Interfaces:**
- Consumes (de Task 1) : entrées `{ position, size, dropoffStop: Infinity, reserved: true }` dans `module.activeBoxes` ; `isBlockedFromEveryAccessibleFace`.
- Produces : garde dure refusant toute position bloquée par toutes les faces accessibles par un obstacle `reserved`, dans les deux chemins de pose.

- [ ] **Step 1 : Écrire les tests qui échouent (barrière dure, face latérale ouverte, sévérité nulle)**

Ajouter dans `scripts/cargo-packing-tests.cjs` :

```js
// ===== Brique A : barrière dure d'accès (Task 2) ==========================

// Module long en profondeur, une seule face accessible (arrière, coord 0 de
// l'axe le plus long). Réservation près de l'accès : une caisse ne peut pas se
// glisser DERRIÈRE (plus loin sur l'axe d'accès) — elle serait inaccessible.
// accessFaces limité à une face pour que le blocage soit total.
test("reserved: hard barrier — nothing placed behind the vehicle (single face)", () => {
  const ctx = loadCargoPacking();
  // Module 1 cellule en largeur (axe 0) et hauteur (axe 2), 4 en profondeur
  // (axe 1, le plus long -> depthAxis). Une seule face accessible : "back" =
  // depthAxis "near" (coord 0). La réservation occupe la profondeur 0 (y0=0
  // sur l'axe 1), à l'accès : toute cellule libre (profondeur 1..3) est DERRIÈRE
  // elle -> bloquée par la seule face -> refusée par la barrière dure.
  const holds = [{ name: "bay", dimensions: { x: 1.25, y: 5.0, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  const accessFaces = { back: true }; // clé réelle (voir moduleFaceAxes) ; défaut aussi = { back:true }
  const reservations = { bay: { x0: 0, y0: 0, sx: 1, sy: 1 } };
  const r = ctx.simulateRoutePacking(entries, holds, 2, accessFaces, reservations);
  // La seule caisse ne peut être ni dans la réservation ni derrière : non placée.
  assert.strictEqual(r.placements.length, 0, "une caisse a été placée derrière le véhicule");
  assert.strictEqual(r.unplaced.length, 1, "la caisse aurait dû rester non placée");
});

// Même géométrie, mais DEUX faces accessibles dont une non bloquée par la
// réservation -> la caisse redevient plaçable (on n'a pas court-circuité la
// logique de faces).
test("reserved: an unblocked access face still allows placement", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 1.25, y: 5.0, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [{ quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 1, maxCargoBoxSize: 1 }];
  // Accès aux DEUX extrémités de l'axe de profondeur : "back" (near, coord 0)
  // ET "front" (far, coord max). La réservation à la profondeur 0 ne bloque pas
  // depuis "front" -> une caisse en profondeur 1..3 reste atteignable.
  const accessFaces = { back: true, front: true };
  const reservations = { bay: { x0: 0, y0: 0, sx: 1, sy: 1 } };
  const r = ctx.simulateRoutePacking(entries, holds, 2, accessFaces, reservations);
  assert.strictEqual(r.placements.length, 1, "la caisse devrait être atteignable par la face non bloquée");
  assert.ok(!overlapsReserved(r.placements[0], 0, 0, 1, 1));
});

// Effet nul du score : une réservation qui ne bloque PERSONNE laisse le
// rangement identique à sans réservation.
test("reserved: a reservation that blocks nobody leaves packing unchanged", () => {
  const ctx = loadCargoPacking();
  const holds = [{ name: "bay", dimensions: { x: 6.25, y: 2.5, z: 1.25 }, capacity: 999, maxContainerSize: 32 }];
  const entries = [
    { quantity: 1, commodity: "A", pickupStop: 0, dropoffStop: 2, maxCargoBoxSize: 1 },
    { quantity: 1, commodity: "B", pickupStop: 1, dropoffStop: 3, maxCargoBoxSize: 1 },
  ];
  const base = ctx.simulateRoutePacking(entries, holds, 4);
  // Réservation dans un coin éloigné où rien ne se serait de toute façon placé
  // et qui ne borde aucune caisse posée (à ajuster si le placement de base
  // l'atteint : la choisir hors des cellules réellement occupées par `base`).
  const reservations = { bay: { x0: 4, y0: 0, sx: 1, sy: 1 } };
  const r = ctx.simulateRoutePacking(entries, holds, 4, undefined, reservations);
  const occupied = base.placements.some((p) => overlapsReserved(p, 4, 0, 1, 1));
  assert.ok(!occupied, "cas de test mal choisi : la réservation touche une caisse du rangement de base");
  assert.deepStrictEqual(r.placements.map((p) => p.position), base.placements.map((p) => p.position));
  assert.strictEqual(r.conflicts.length, base.conflicts.length);
});
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `node scripts/cargo-packing-tests.cjs`
Expected : « hard barrier » échoue (sans garde, la caisse se place derrière le véhicule, `placements.length === 1`). « unblocked face » et « blocks nobody » peuvent déjà passer (la Task 1 pré-marque les cellules, et le pré-marquage seul suffit à ces deux cas) — c'est normal ; ils verrouillent qu'on ne casse rien.

- [ ] **Step 3 : Implémenter la garde dure dans `findBestPosition`**

Dans `js/cargo-packing.js`, boucle de balayage de `findBestPosition`, **juste après** les deux gardes existantes (`if (!canPlace(...)) continue;` et `if (!hasValidSupport(...)) continue;`, lignes ~480–481) :

```js
          // Barrière dure d'un véhicule garé (brique A) : une position que
          // l'obstacle réservé bloque par TOUTES les faces accessibles est
          // refusée (l'espace derrière lui est inutilisable — décision
          // utilisateur), contrairement au score de sévérité qui ne fait que
          // classer des positions autorisées. Réutilise le prédicat d'accès
          // existant, sans le modifier.
          if (
            activeBoxes.some(
              (ab) =>
                ab.reserved &&
                isBlockedFromEveryAccessibleFace(effectiveFaceAxes, ab.position, ab.size, pos, size)
            )
          )
            continue;
```

- [ ] **Step 4 : Implémenter la même garde dans `tryStackOnExisting`**

Dans `tryStackOnExisting`, boucle des orientations, **juste avant** le
`if (canPlace(m.grid, ...) && hasValidSupport(...))` (ligne ~520) :

```js
      // Même barrière dure qu'en findBestPosition : ne pas empiler à un endroit
      // que le véhicule garé rend inaccessible par toutes les faces. En
      // pratique la caisse-base a déjà passé la garde et l'empilement partage
      // son empreinte horizontale ; on la remet par cohérence/robustesse.
      if (
        m.activeBoxes.some(
          (ab) =>
            ab.reserved &&
            isBlockedFromEveryAccessibleFace(m.faceAxes, ab.position, ab.size, pos, size)
        )
      )
        continue;
```

- [ ] **Step 5 : Lancer les tests, vérifier qu'ils passent**

Run: `node scripts/cargo-packing-tests.cjs`
Expected : `43/43 passed` (40 après Task 1 + 3 nouveaux). Les 34 d'origine restent inchangés.

- [ ] **Step 6 : Commit**

```bash
git add js/cargo-packing.js scripts/cargo-packing-tests.cjs
git commit -m "Zones réservées (brique A) : barrière dure d'accès derrière le véhicule"
```

---

## Notes de vérification finale (pour la revue de branche)

- **`assignMissionZones` reste inconscient des réservations** : limitation connue et validée (§5.3 du spec). La correction est garantie par le pré-marquage + la garde dure, pas par le zonage. Ne pas « corriger » le zonage dans cette brique.
- **Repère d'axes** : toute la brique A vit dans le repère `cargo-packing.js` (axes 0/1 horizontaux, 2 vertical). La conversion depuis la vue 3D est le problème de la brique B — ne rien assumer d'autre ici.
- **Barre verte finale** attendue : `43/43 passed`, dont les 34 d'origine strictement inchangés (mêmes noms, mêmes assertions).
