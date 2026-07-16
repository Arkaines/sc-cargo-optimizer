# Refonte graphique "Cockpit HUD" — design

> **Pour les agents :** COMPÉTENCE OBLIGATOIRE : utiliser superpowers:writing-plans pour transformer cette spec en plan d'implémentation détaillé, tâche par tâche.

**Objectif :** remplacer entièrement l'identité visuelle actuelle (navy/corail/cyan, Oswald/IBM Plex Sans) par une esthétique "cockpit / HUD sci-fi" — panneaux à coins coupés, palette quasi-noire avec un unique accent corail, typographie Rajdhani/Titillium Web — sur les deux thèmes (sombre et clair), sans changer la logique applicative, le stack (vanilla JS/CSS, zéro build), ni le comportement d'aucune fonctionnalité.

**Contexte :** cette session a déjà fait plusieurs passes de densité/compacité (header, onglet cargo) en gardant la palette "Arkaine Heinlein" (navy/corail/cyan) établie précédemment. L'utilisateur a explicitement jugé ce résultat "daté/générique" et demandé une refonte graphique complète, en acceptant de changer aussi les couleurs et les polices (contrairement aux passes précédentes qui gardaient la palette de marque comme contrainte). Direction validée visuellement via le compagnon de brainstorming (3 options de palette, 3 paires typographiques, puis une page système complète) : palette "Signal corail", typographie Rajdhani + Titillium Web.

## Contraintes globales

- Stack inchangé : scripts classiques (pas de modules sauf `js/cargo-viewer.js`), zéro build, zéro nouvelle dépendance JS. Seuls `css/style.css`, `index.html` (classes/markup, pas de logique), et les 3 pages annexes (`privacy.html`, `privacy.en.html`, `terms.html`, `terms.en.html` si elles partagent des styles) sont concernés.
- Aucun changement de comportement JS : tous les gestionnaires d'événements, IDs d'éléments (`#pack-cargo-btn`, `#mission-form`, etc.), et la logique métier restent identiques. Seules les classes CSS et éventuellement la structure de balises pure présentation (ex. wrapper pour un motif de coin coupé) peuvent changer.
- Les deux thèmes (sombre par défaut, clair via le bouton existant) restent fonctionnels et cohérents avec le même système.
- Cache-busting : bump `?v=` sur les ~23 occurrences après chaque commit de fichier modifié (convention déjà en place).
- Conformité CIG Fan Kit inchangée : bandeau de non-affiliation, badge "Made By The Community" — ne pas toucher au contenu ni à la présence de ces éléments, seulement leur habillage visuel si besoin de cohérence avec la nouvelle palette.
- Les tests existants (`node scripts/cargo-packing-tests.cjs`, 34 tests) ne testent aucune logique visuelle — ils doivent continuer à passer sans modification (preuve qu'aucune logique n'a été touchée).

## Design tokens

### Couleurs — thème sombre (par défaut)

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#0c0f16` | Fond de page |
| `--panel` | `#141821` | Fond des cartes/panneaux |
| `--panel-border` | `#2a2f38` | Bordures de panneaux, séparateurs |
| `--input-bg` | `#0c0f16` | Fond des champs de saisie (même que le fond de page, contraste avec `--panel`) |
| `--input-border` | `#3a4048` | Bordure des champs de saisie, boutons secondaires |
| `--text` | `#dbe4ea` | Texte principal |
| `--muted` | `#8a95a0` | Texte secondaire/labels (vérifié ≥ 4.5:1 sur `--bg` ET `--panel`) |
| `--accent` | `#ff7a52` | Seul accent : boutons primaires, titres de panneaux, onglet actif, focus |
| `--accent-on` | `#160800` | Texte sur fond `--accent` |
| `--success` | `#6bcf7a` | Statuts positifs ("tout rentre", confirmations) |
| `--warning` | `#e0a030` | Avertissements (surcharge, module en développement) |
| `--danger` | `#ff5568` | Actions destructives (Supprimer), erreurs — délibérément distinct de `--accent` (rouge froid vs corail chaud) |
| `--heading-font` | `"Rajdhani", "Segoe UI", system-ui, sans-serif` | Titres (h1-h3, boutons, onglets, labels de section) |
| `--body-font` | `"Titillium Web", "Segoe UI", system-ui, sans-serif` | Corps de texte, formulaires, tableaux |

### Couleurs — thème clair

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#eef1f4` | Fond de page (gris-bleu pâle, pas blanc pur — évoque un panneau d'instrument éclairé) |
| `--panel` | `#ffffff` | Fond des cartes/panneaux |
| `--panel-border` | `#c7cfd6` | Bordures de panneaux, séparateurs |
| `--input-bg` | `#f7f9fb` | Fond des champs de saisie |
| `--input-border` | `#a9b4bd` | Bordure des champs de saisie |
| `--text` | `#141821` | Texte principal (reprend le `--panel` du thème sombre, inversé) |
| `--muted` | `#5c6470` | Texte secondaire |
| `--accent` | `#a83f22` | Corail assombri pour rester ≥ 4.5:1 sur fond clair |
| `--accent-on` | `#ffffff` | Texte sur fond `--accent` |
| `--success` | `#167a2e` | |
| `--warning` | `#8a5a0a` | |
| `--danger` | `#b32036` | |

Polices identiques dans les deux thèmes.

### Typographie — échelle

| Rôle | Taille | Poids | Police |
|---|---|---|---|
| Titre de page (header h1) | 1.3rem | 700 | Rajdhani |
| Titre de panneau (h2/h3 dans une carte) | 0.95–1.1rem, majuscules, `letter-spacing: 0.02em` | 700 | Rajdhani |
| Onglet | 0.78rem, majuscules, `letter-spacing: 0.06em` | 600 | Titillium Web |
| Corps / formulaire / tableau | 0.85–0.9rem | 400 | Titillium Web |
| Label de champ (eyebrow) | 0.68rem, majuscules, `letter-spacing: 0.1em` | 600 | Titillium Web |
| Bouton | 0.8rem, majuscules, `letter-spacing: 0.05em` | 700 | Titillium Web |

Police chargée via Google Fonts (déjà le cas actuellement pour Oswald/IBM Plex Sans — même mécanisme, juste les familles qui changent) : `Rajdhani:wght@600;700` + `Titillium Web:wght@400;600;700`.

### Motif de coin coupé ("cut corner")

```css
clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
```

**Règle d'application (shape consistency lock — un seul système, pas un mélange arbitraire) :**
- **Coins coupés** : panneaux de contenu "primaires" — un panneau qui contient une action principale ou un formulaire (ex. "Nouvelle mission", "Faces accessibles de la soute", "Mon vaisseau", le futur panneau d'étape cargo). Coupe fixe de 12px sur les deux coins opposés (haut-droit, bas-gauche).
- **Coins droits (0)** : boutons, champs de saisie, badges, lignes de tableau — jamais de coupe sur des éléments interactifs répétés ou petits (une coupe sur un bouton de 2rem de large déformerait le texte).
- **Pas de carte du tout** (juste un séparateur `border-bottom`) : tableaux de données (Missions enregistrées, Historique) — cohérent avec la règle déjà en place cette session ("`.tabs` est déjà une carte, ne pas empiler du carton dans du carton").

### Densité et espacement

Conserver l'échelle de densité déjà établie cette session (header compact, paddings resserrés `.side-block`/`.tabs` à `1.1rem 1.25rem`) — la refonte change la peau (couleurs, coins, typo), pas les dimensions déjà validées. Ne pas revenir à un espacement plus généreux.

## Application par zone

- **Bandeau de non-affiliation / header** : fond `--bg`, logo + titre centrés (inchangé structurellement), bouton Discord en `--panel` avec bordure `--input-border` (bouton secondaire, pas primaire — se connecter n'est pas l'action principale de la page).
- **Barre d'onglets** : onglet actif en `--accent` avec soulignement 2px, onglets inactifs en `--muted`. Suppression du fond plein sur l'onglet actif (juste le soulignement + couleur de texte, plus HUD que "bouton actif").
- **Panneaux latéraux (`.side-block`)** : coin coupé, comme les panneaux de contenu.
- **Formulaires (Nouvelle mission, ajout de lieu)** : labels en "eyebrow" (majuscules, petit, `--muted`) au-dessus de chaque champ plutôt que labels inline classiques — cohérent avec le style JEU HUD, valide déjà dans la maquette système.
- **Tableaux (Missions enregistrées, Historique, Réputation)** : en-têtes majuscules `--muted`, lignes séparées par `--panel-border` fin, pas de fond alterné (garde la densité).
- **Boutons** : primaire = `--accent`/`--accent-on` plein ; secondaire = fond `--panel`-ish avec bordure `--input-border` ; danger = transparent + bordure + texte `--danger` (jamais confondu avec le corail de l'accent).
- **Visionneuse 3D cargo** : fond du canvas et bordure du panneau alignés sur `--bg`/`--panel-border` ; grilles fil de fer et labels Avant/Arrière/Gauche/Droite déjà en place (aucune inversion, cf. session précédente) — juste recoloration pour matcher le nouveau système, aucune logique touchée.
- **Messages de statut** (`.cargo-ok`, `.cargo-overload`, `.warning-text`) : recolorés sur `--success`/`--danger`/`--warning` respectivement, structure inchangée.
- **Emoji fonctionnels existants** (drapeaux FR/EN du sélecteur de langue, icône thème) : conservés tels quels, hors périmètre (pas de système d'icônes à introduire).

## Hors périmètre

- Aucun changement de structure HTML au-delà de ce qui est strictement nécessaire pour le motif de coin coupé (un wrapper `<div>` supplémentaire si `clip-path` ne peut pas s'appliquer directement à l'élément existant à cause de son contenu/overflow).
- Aucune nouvelle bibliothèque (pas d'icônes SVG, pas de framework d'animation).
- Aucun changement de copie/traduction (les clés i18n restent identiques, FR et EN).
- Le comportement de l'auto-sync, de l'OCR, de l'optimisation de trajet/cargo : totalement hors périmètre, uniquement l'habillage visuel.

## Vérification

1. `node scripts/cargo-packing-tests.cjs` → 34/34 (preuve qu'aucune logique n'a changé).
2. Vérification visuelle réelle (capture d'écran navigateur) de chaque onglet, thèmes sombre ET clair, avant de committer chaque étape.
3. Contraste : déjà vérifié par calcul (luminance relative WCAG) pour chaque token de cette spec sur `--bg` ET `--panel`, dans les deux thèmes — tous ≥ 4.5:1 pour du texte normal (`--danger` dark et `--accent`/`--success`/`--warning` light ont été ajustés suite à un premier jet qui échouait le seuil, ex. `--danger` dark original `#e0344a` = 4.34:1, corrigé en `#ff5568` = 6.16:1). Recalculer si une des valeurs de cette table est modifiée en cours d'implémentation.
