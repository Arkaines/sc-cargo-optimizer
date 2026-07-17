# Placement manuel des grilles de cargo (glisser-déposer) — conception

**Statut : à implémenter.** Brique 1 d'un chantier en deux parties (voir Section 6). Cette brique livre le placement manuel personnel ; la Brique 2 (crowdsourcing + modération des dispositions) fera l'objet d'un cycle spec + plan séparé, plus tard.

## Contexte

Le visualiseur 3D (`js/cargo-viewer.js`) affiche les soutes d'un vaisseau à partir des données FleetYards (`state.fleetyardsCargoHolds`). Mais FleetYards ne fournit **aucune position absolue** des modules de soute : les `offset` qu'il expose sont locaux au préfab répété, pas des coordonnées sur le vaisseau (constaté en direct : les 4 baies du Caterpillar partagent le même offset, l'Ironclad n'a aucun offset). Le visualiseur reconstruit donc une disposition à partir de mots-clés dans les noms de hardpoint (`front`/`rear`/`left`/`right`/`top`/`bottom`, voir `parsePositionHint`), avec trois niveaux de repli (offsets fiables → grille par mots-clés → colonne avant-arrière). Cette reconstruction reste une approximation : plusieurs vaisseaux (Ironclad, Caterpillar) ne tombent pas juste, et il n'existe pas de donnée pour faire mieux automatiquement.

Décision (de l'utilisateur) : puisque le joueur connaît la vraie disposition de son vaisseau, lui laisser **placer lui-même chaque grille au glisser-déposer**, réglage mémorisé par vaisseau et appliqué immédiatement. Même logique déjà retenue pour l'orientation avant/arrière/gauche/droite (boutons « Tourner »/« Miroir », `state.cargoViewerOrientation`/`cargoViewerMirror`) et pour les faces d'accès (`state.shipAccessFaces`, voir `2026-07-17-ship-access-faces-design.md`) : configuration par le joueur plutôt que donnée extrapolée.

**Ce que cette brique NE fait PAS** : aucune soumission/partage (Brique 2) ; pas d'empilement vertical (v1 au sol uniquement, voir Section 5) ; aucune modification de la logique de rangement (`js/cargo-packing.js`) — le placement manuel n'affecte QUE l'affichage 3D, jamais où les caisses sont calculées comme rangées.

## 1. Modèle de données et persistance

Nouveau dict dans `state`, `cargoViewerLayout`, indexé par nom de vaisseau (même motif que `shipAccessFaces`/`cargoViewerOrientation`) :

```js
state.cargoViewerLayout = {
  "Ironclad": {
    "hardpoint_cargogrid_front_left": { x: 0, z: 12.5 },
    "hardpoint_cargogrid_secure_front_middle": { x: 7.5, z: 12.5 },
    // seuls les modules RÉELLEMENT déplacés figurent ici (surcharge partielle)
  },
  // vaisseau absent du dict => 100% reconstruction auto (comportement actuel)
};
```

- **Surcharge partielle** : seuls les modules que le joueur a glissés sont mémorisés. Un module absent de la map garde sa position issue de la reconstruction auto. Un vaisseau absent du dict se comporte exactement comme aujourd'hui (aucune régression, opt-in strict).
- **Clé de module** : le nom du hardpoint (`hold.name`). Si un même nom apparaît plusieurs fois parmi les soutes affichées d'un vaisseau (cas théorique — les noms FleetYards observés sont distincts, y compris `module_01..04`), on suffixe l'occurrence : `"<name>#<i>"` où `i` est l'index d'apparition (0 pour le premier). Une fonction `moduleKey(hold, displayHolds)` **vit dans `js/cargo-viewer.js`** et centralise ce calcul : le visualiseur l'utilise à l'identique pour appliquer la disposition au rendu (Section 3) ET pour étiqueter une grille au moment du glisser (Section 4). `js/app.js` ne calcule jamais de clé — il reçoit une clé opaque du visualiseur et la stocke telle quelle.
- **Coordonnées** : `{ x, z }` dans le repère monde du visualiseur (mètres, l'axe Three.js où X = largeur gauche-droite et Z = profondeur avant-arrière ; Y vertical n'est pas stocké en v1, voir Section 5). Ce sont les mêmes `worldPos[0]`/`worldPos[2]` que la reconstruction auto produit déjà.
- **Persistance** : via `saveState()` comme le reste de l'état. On ajoute `cargoViewerLayout`, `cargoViewerOrientation` et `cargoViewerMirror` à `CLOUD_SYNCED_KEYS` (`js/cloud.js`) pour que la disposition ET l'orientation d'un joueur le suivent d'un appareil à l'autre — cohérent avec le cadrage « pour son compte ». (Aujourd'hui ces trois champs sont en localStorage seul ; les faire synchroniser est un ajout de cette brique.)
- **Migration/chargement** : `loadState()` (`js/app.js`) lit `parsed.cargoViewerLayout || {}`, comme les autres dicts. `defaultState()` l'initialise à `{}`.
- **Réinitialisation** : le bouton « Réinitialiser la disposition » (Section 2) fait `delete state.cargoViewerLayout[shipName]` puis `saveState()` → retour à 100 % auto pour ce vaisseau. Indépendant du bouton global « Réinitialiser mes données », qui vide déjà tout l'état joueur (et donc aussi ce dict).

## 2. Interaction & interface

Un bouton **« Éditer la disposition »** (`#cargo-viewer-edit-btn`) rejoint la rangée de boutons du visualiseur (`.cargo-viewer-controls` dans `index.html`, à côté de « Tourner »/« Miroir »/vues). Visible dans les mêmes conditions que le reste du panneau (un rangement affiché).

**Entrée en mode édition** (clic sur le bouton, qui passe en état actif) :
- La caméra se cale en **vue de dessus** (réutilise `setCargoViewerView("top")`).
- La **rotation** OrbitControls est désactivée (`controls.enableRotate = false`) ; le **zoom** reste actif pour cadrer l'ensemble. La rotation est rétablie à la sortie.
- Les **caisses colorées sont masquées** (on ne rend que les caissons filaires des modules) pour ne pas gêner le placement.
- Un **texte d'aide** s'affiche (« Glisse chaque grille à sa vraie place sur le vaisseau »).
- Deux boutons deviennent visibles/actifs : **« Terminer »** (`#cargo-viewer-edit-done-btn`, sort du mode) et **« Réinitialiser la disposition »** (`#cargo-viewer-reset-layout-btn`). Les boutons de vue/rotation/miroir sont masqués ou désactivés pendant l'édition (l'orientation se règle hors édition).

**Glisser une grille :**
- Clic maintenu sur un module → il devient la cible ; le curseur est projeté sur le plan horizontal Y=0, et le module suit, **aimanté sur la grille de 1,25 m** (`UNIT`). Déplacement en X (gauche-droite) et Z (avant-arrière) uniquement.
- Pendant le glisser, OrbitControls est temporairement désactivé (`controls.enabled = false`) pour que le geste ne bouge pas la caméra ; réactivé au relâchement.
- Au relâchement : la position aimantée du module est écrite dans `state.cargoViewerLayout[shipName][moduleKey]`, `saveState()` est appelé (→ localStorage + synchro cloud si connecté). La scène n'est pas entièrement reconstruite ; seuls la position du caisson (et de sa boîte de sélection invisible) sont mises à jour en direct.

**Sortie** (« Terminer ») : rotation OrbitControls rétablie, caisses ré-affichées, texte d'aide masqué, boutons de vue de retour. La disposition reste appliquée (elle est déjà persistée à chaque glisser).

**Traductions** (FR/EN, `js/i18n.js`) : `editLayoutBtn`, `editLayoutDoneBtn`, `resetLayoutBtn`, `editLayoutHint`. Mêmes conventions `data-i18n`/`data-i18n-title` que les boutons existants.

## 3. Application au rendu (`renderCargoViewer3D`)

La surcharge s'insère **après** le calcul des positions auto (`positioned`/`fallbackGrid`/`fallbackRow` → `worldPos`) et **avant** la normalisation en coordonnées positives (`minX`/`minZ`) et le calcul des bornes de scène :

```js
const layoutForShip = getCargoViewerLayout(currentShipName); // {} si absent
layout.forEach((l) => {
  const custom = layoutForShip[moduleKey(l.hold, displayHolds)];
  if (custom) {
    l.worldPos[0] = custom.x;
    l.worldPos[2] = custom.z;
    // worldPos[1] (Y) inchangé — v1 au sol
  }
});
```

- `renderCargoViewer3D` reçoit aujourd'hui `(holds, placements, rotation, mirror)` ; on ajoute un 5ᵉ paramètre `layout` = **la map de disposition déjà résolue** pour le vaisseau courant (`getCargoViewerLayout(shipName)`, ou `{}`). On passe la map, pas le nom du vaisseau : le visualiseur reste découplé de `state`/de la résolution de vaisseau (il ne connaît que des clés de modules et des positions). Le point d'appel `renderCargoStepView` (`js/app.js`) a déjà `getSelectedShip()` pour résoudre la map.
- La normalisation `minX`/`minZ` et le recentrage caméra existants s'appliquent ensuite normalement : une disposition manuelle qui déborde en coordonnées négatives est ramenée dans le cadre comme n'importe quelle position auto.
- **Caméra en édition** : `renderCargoViewer3D` ne doit pas recadrer la caméra pendant l'édition (le `frameKey` peut changer quand les bornes bougent au fil des glissers). En mode édition, on saute le bloc de recadrage caméra (garde `lastFrameKey` tel quel), pour que la vue de dessus posée à l'entrée ne saute pas à chaque déplacement.

## 4. Technique du glisser (Three.js)

- **Sélection** : les caissons sont des `LineSegments`/`Group` (fils de fer), mal cibles au raycasting. On ajoute, par module affiché, une **boîte de collision invisible** (`Mesh` `BoxGeometry` aux dimensions du module, `material.visible = false`) positionnée comme le caisson, portant une référence au module (`mesh.userData.layoutEntry = l`). Le raycaster teste ces boîtes.
- **Projection au sol** : `THREE.Raycaster.setFromCamera(ndcPointer, camera)` puis intersection avec un `THREE.Plane(normal=(0,1,0), constant=0)` (`ray.intersectPlane`) → point monde ; on en déduit la nouvelle origine du module en retranchant le décalage saisi au clic (pour que la grille ne « saute » pas sous le curseur), puis on aimante chaque coordonnée sur `Math.round(v / UNIT) * UNIT`.
- **Mise à jour live** : on déplace le `Group` caisson et sa boîte de collision (même position) sans reconstruire la scène.
- **Nettoyage** : les boîtes de collision sont ajoutées au `contentGroup` et libérées par `clearContent()` existant (dispose geometry/material) au prochain rendu complet ; elles ne sont créées qu'en mode édition (hors édition, aucun surcoût).
- **Écouteurs** : `pointerdown`/`pointermove`/`pointerup` sur le canvas du renderer, actifs seulement en mode édition (ajoutés à l'entrée, retirés à la sortie) pour ne pas interférer avec OrbitControls en usage normal.

**Interface visualiseur ↔ app** (frontière explicite) :
- `window.enterCargoLayoutEdit()` / `window.exitCargoLayoutEdit()` : posent/lèvent un drapeau interne `editingLayout` du visualiseur, puis **re-rendent l'étape courante** (via `renderCargoStepView` côté app, ou directement) pour, à l'entrée, masquer les caisses + ajouter les boîtes de collision + caler la vue de dessus + désactiver la rotation ; à la sortie, tout remettre. Appelées par les boutons « Éditer »/« Terminer » (`js/app.js`).
- `window.persistCargoModulePosition(moduleKey, x, z)` : **définie dans `js/app.js`**, appelée par le visualiseur au relâchement d'un glisser. Elle écrit `state.cargoViewerLayout[shipName][moduleKey] = { x, z }` puis `saveState()`. Le visualiseur ne touche jamais `state` directement ; il ne connaît que la clé (qu'il a lui-même produite via `moduleKey`) et la position aimantée.
- `window.resetCargoViewerLayout()` (bouton « Réinitialiser la disposition ») : dans `js/app.js`, `delete state.cargoViewerLayout[shipName]`, `saveState()`, puis re-rendu de l'étape (repart de l'auto). Reste en mode édition.

## 5. Hors périmètre v1 (différé)

- **Empilement vertical** (deux grilles superposées, ex. soutes « secure » de l'Ironclad par-dessus les grandes baies) : v1 place tout au sol (Y non éditable). Si le besoin se confirme, un réglage de hauteur viendra plus tard (poignée verticale ou champ), en réutilisant le même `cargoViewerLayout` avec un `y` optionnel.
- **Rotation d'un module individuel** (tourner une seule grille) : non prévu ; l'orientation globale du vaisseau reste couverte par « Tourner »/« Miroir ».
- **Redimensionnement** : jamais — les dimensions viennent de FleetYards, seule la position est éditable.

## 6. Rapport avec la Brique 2 (crowdsourcing)

Cette brique est autonome et utilisable seule. Elle pose les fondations de la Brique 2 : le format `cargoViewerLayout[shipName]` (map module→position) + l'orientation est exactement ce qu'une future proposition communautaire embarquera. La Brique 2 ajoutera (cycle séparé) : un bouton « Proposer cette disposition » écrivant vers une table Supabase de propositions, une file de validation côté mainteneur (avec notification), et la lecture d'une table de dispositions validées servant de défaut à tous. Rien de la Brique 2 n'est construit ici, mais le modèle de données est pensé pour s'y prêter sans refonte.

## 7. Tests & vérification

- **Non-régression métier** : `node scripts/cargo-packing-tests.cjs` doit rester à `34/34` (aucune logique de rangement touchée).
- **Vérification interactive headless** (Puppeteer, même approche que le reste du projet) :
  1. Charger un vaisseau, calculer un rangement, entrer en mode édition → vérifier vue de dessus + caisses masquées + boutons Terminer/Réinitialiser présents.
  2. Simuler un `pointerdown`/`move`/`up` sur un module → vérifier que `state.cargoViewerLayout[ship][clé]` existe, est aimanté sur 1,25 m, et que le caisson a bougé.
  3. Recharger la page (persistance) → la disposition est conservée et ré-appliquée au rendu.
  4. « Réinitialiser la disposition » → `state.cargoViewerLayout[ship]` supprimé, retour à la position auto.
  5. La caméra ne saute pas entre deux glissers (position caméra stable, comme pour Tourner/Miroir).
- **Bump du cache-busting** (`?v=` dans `index.html`) après modification des JS/CSS, comme d'habitude.
