# Socle des grilles Supabase + éditeur admin — conception (Brique 2a)

**Statut : à implémenter.** Brique 2a d'un chantier en deux parties :
- **2a (ce document)** : le socle (grilles dans Supabase, détachement de FleetYards) + l'éditeur de grilles réservé au mainteneur.
- **2b** : le crowdsourcing (propositions des joueurs, notification Discord, onglet de revue, porte de sortie) — voir `2026-07-17-crowdsourced-cargo-grids-design.md`, qui s'appuie sur ce socle.

Prérequis livré : `2026-07-17-manual-cargo-grid-placement-design.md` (placement manuel au glisser, x/y/z, aimanté 1 SCU).

## Contexte et objectif

FleetYards ne donne aucune position réelle des modules de soute ; la reconstruction par mots-clés est fausse pour plusieurs vaisseaux (Ironclad, Caterpillar). Pire, FleetYards ne connaît pas tous les vaisseaux, et ses définitions peuvent être incomplètes.

**Objectif** : le mainteneur édite lui-même la grille d'un vaisseau (déplacer, ajouter, supprimer, redimensionner des modules) et la publie ; elle devient la grille de référence pour **tous les joueurs**, **à la place de FleetYards** pour ce vaisseau.

C'est le détachement progressif voulu : chaque vaisseau publié cesse de dépendre de FleetYards. À terme l'app peut héberger des vaisseaux que FleetYards ignore.

**Pourquoi cette brique avant le crowdsourcing** : les grilles de l'Ironclad et du Caterpillar sont fausses aujourd'hui. Avec cet éditeur, le mainteneur les corrige une fois pour tout le monde, sans attendre de proposition. Le crowdsourcing (2b) sert ensuite à passer à l'échelle (112 vaisseaux ne se font pas à la main).

**Revers assumé** : un vaisseau publié ne reçoit plus les corrections automatiques de FleetYards. Si un patch change une soute, la copie Supabase reste figée jusqu'à ce que le mainteneur la reprenne (ou, en 2b, qu'un joueur propose une correction).

## 1. Socle Supabase

Deux tables.

### `admins`
| colonne | type |
|---|---|
| `user_id` | `uuid` primary key (référence `auth.users`) |

Le mainteneur y insère son propre `user_id` (Supabase → Authentication → Users, après une connexion Discord). Sert aux règles RLS **et** à l'affichage de l'éditeur.

### `ship_layouts` — les grilles publiées
| colonne | type |
|---|---|
| `ship_name` | `text` primary key |
| `grid` | `jsonb not null` — la grille complète (voir §2) |
| `orientation` | `smallint not null default 0` (0-3) |
| `mirror` | `boolean not null default false` |
| `updated_at` | `timestamptz not null default now()` |

`ship_name` en clé primaire : **une seule grille publiée par vaisseau**, republier remplace (`upsert`). C'est ce qui permet de reprendre un vaisseau après un patch.

### RLS
**La RLS est le seul vrai garde-fou.** La clé anon est publique et le client n'est jamais digne de confiance : masquer l'éditeur n'est pas une sécurité.

- `ship_layouts` : `select` **public**, y compris anon non connecté (l'app doit lire les grilles sans compte). `insert`/`update`/`delete` : **admins uniquement**.
- `admins` : `select` limité à sa propre ligne (un joueur peut savoir s'il est admin sans lire la liste).

Pas de fonction RPC dans cette brique : le mainteneur écrit `ship_layouts` directement, la RLS suffit. (Les RPC `approve_submission`/`reject_submission` appartiennent à 2b, où l'atomicité proposition+publication devient nécessaire.)

## 2. Forme de la grille (`grid`)

Un tableau, un objet par module :

```json
[
  {
    "name": "hardpoint_cargogrid_front_left",
    "dimensions": { "x": 7.5, "y": 25.0, "z": 7.5 },
    "capacity": 720,
    "maxContainerSize": 32,
    "position": { "x": 0, "y": 0, "z": 12.5 }
  }
]
```

- `name` : identifiant du module, **unique dans la grille**. Sert de clé (le `moduleKey` du visualiseur). Pour un module créé de zéro, l'éditeur génère un nom libre mais unique.
- `dimensions`, `capacity`, `maxContainerSize` : **mêmes champs et mêmes unités** que ce que produit `js/fleetyards.js`, pour que `js/cargo-packing.js` fonctionne **sans aucune modification** quand la grille vient de Supabase.
- `position` : position résolue du module (l'origine/coin, comme `worldPos`), en mètres.

### `capacity` est calculée, jamais saisie

**Vérifié sur les 284 soutes de tous les vaisseaux FleetYards : 284/284, aucune exception :**

```
capacity = (dimensions.x / 1.25) * (dimensions.y / 1.25) * (dimensions.z / 1.25)
```

C'est le volume en cellules SCU (1 SCU = un cube de 1,25 m). L'éditeur **ne demande donc jamais la capacité** : il la dérive des dimensions et l'affiche en direct. Une grille incohérente (capacité ne correspondant pas au volume) devient impossible à saisir, et on ne peut pas diverger de la convention FleetYards.

### `maxContainerSize`

Non dérivable (c'est une règle de jeu, pas une géométrie). Les valeurs réellement observées chez FleetYards sont **1, 2, 4, 8, 16, 24, 32** → **liste déroulante** de ces 7 valeurs, pas un champ libre.

## 3. Côté app — récupération et priorité

`runFullSync()` (`js/app.js`) récupère `ship_layouts` et le met en cache dans `state.approvedShipGrids = { [shipName]: { grid, orientation, mirror } }` — même motif que `state.fleetyardsCargoHolds` (cache local relu périodiquement). Lecture publique : fonctionne déconnecté, et l'absence de table/réseau doit dégrader proprement (aucune grille publiée = comportement actuel).

**Source des soutes.** `getShipCargoHolds(shipName)` vit dans `js/fleetyards.js` et reste **inchangé** — ce fichier ne parle que de FleetYards, y brancher Supabase mélangerait deux sources dans un module qui n'en connaît qu'une. On ajoute un résolveur dans `js/app.js` :

```js
// Soutes du vaisseau : grille publiée (Supabase) d'abord, FleetYards ensuite.
// C'est ici que se fait le détachement — un vaisseau publié n'utilise plus du
// tout les données FleetYards.
function getShipHolds(shipName) {
  const published = state.approvedShipGrids[shipName];
  if (published) return published.grid.map((m) => ({
    name: m.name,
    dimensions: m.dimensions,
    capacity: m.capacity,
    maxContainerSize: m.maxContainerSize,
  }));
  return typeof getShipCargoHolds === "function" ? getShipCargoHolds(shipName) : null;
}
```

`getShipCargoHolds` n'a qu'**un seul appelant** aujourd'hui (`js/app.js:2243`, dans `runCargoPacking`) : c'est la seule ligne à basculer sur `getShipHolds`.

**Positions dans le visualiseur** : grille publiée (positions exactes, **aucune reconstruction**) > disposition perso (surcharge partielle, Brique 1) > reconstruction automatique. Une grille publiée porte une position pour chaque module : pour ce vaisseau le visualiseur ne devine plus rien, il place.

**Orientation/miroir** : ceux de la grille publiée s'appliquent.

## 4. Verrouillage pour les non-admins

Vaisseau **avec** grille publiée : « Éditer la disposition », « Tourner » et « Miroir » sont **masqués** pour un joueur normal, et une mention indique que la grille est officielle. La grille publiée fait autorité.

Vaisseau **sans** grille publiée : comportement actuel inchangé (placement perso disponible).

**Limite temporaire assumée** : dans cette brique, un joueur n'a **aucun recours** si une grille publiée lui semble fausse — la porte de sortie (« Proposer une correction ») arrive avec 2b. C'est acceptable ici parce que le seul auteur des grilles est le mainteneur, qui peut corriger immédiatement.

## 5. L'éditeur admin

**Accès** : au chargement, si connecté, l'app lit sa ligne dans `admins` → `state.isAdmin`. L'éditeur n'apparaît que pour un admin. Ce n'est qu'un confort d'affichage : la RLS refuse de toute façon les écritures d'un non-admin.

**Entrée** : un bouton **« Éditer la grille (admin) »** dans l'onglet « Optimisation du cargo », près du sélecteur de vaisseau — **pas** dans le panneau du visualiseur.

La raison est structurante : le panneau du visualiseur est masqué tant qu'aucun rangement n'est calculé (`renderCargoStepView` le cache si `cargoPackState` est nul). Or **on édite le vaisseau, pas la cargaison** : l'admin doit pouvoir corriger la grille d'un vaisseau sans avoir créé la moindre mission — et ce sera le cas normal pour un vaisseau que FleetYards ignore, où il n'y a rien à ranger. Ouvrir l'éditeur **force donc l'affichage du visualiseur** et y rend le brouillon, indépendamment de `cargoPackState`.

**Ce qui est rendu** : l'éditeur affiche le **brouillon de grille** (`adminGridDraft`), pas un rangement — donc `renderCargoViewer3D(brouillon, [], orientation, mirror, positionsDuBrouillon)` avec **zéro caisse**. Le mode édition de la Brique 1 est réutilisé tel quel pour le glisser (vue préréglée, glisser dans le plan regardé, donc hauteur comprise) ; l'éditeur y ajoute ses contrôles.

**Amorçage** : à l'ouverture, la grille éditée part de — dans l'ordre — la grille publiée si elle existe, sinon les soutes FleetYards résolues (dimensions + positions reconstruites), sinon une grille vide. Le mainteneur corrige donc à partir de l'existant plutôt que de repartir de zéro, et un vaisseau inconnu de FleetYards démarre vide.

**Opérations** :
- **Déplacer** : le glisser de la Brique 1, inchangé (aimanté 1 SCU, dans le plan regardé, donc hauteur comprise).
- **Sélectionner** : cliquer un module le sélectionne (mise en évidence) et affiche son panneau.
- **Redimensionner** : trois champs numériques en **cellules SCU** (ex. `6 × 20 × 6`), pas en mètres — c'est ainsi que le jeu et FleetYards raisonnent. Les dimensions stockées restent en mètres (`cellules × 1,25`). La **capacité calculée s'affiche à côté et se met à jour en direct**.
- **`maxContainerSize`** : liste déroulante (1, 2, 4, 8, 16, 24, 32).
- **Ajouter** : bouton « Ajouter une grille » → nouveau module de 1×1×1 cellule, `maxContainerSize` 1, posé à l'origine, nom généré unique ; à dimensionner et placer ensuite.
- **Supprimer** : bouton sur le module sélectionné.
- **Publier** : bouton explicite **« Publier la grille »** → `upsert` dans `ship_layouts`. **Pas d'enregistrement automatique** : une grille à moitié éditée ne doit jamais partir chez tous les joueurs.
- **Annuler** : quitter sans publier ne change rien pour personne.

**Nom des modules** : l'éditeur garantit l'unicité des `name` dans la grille (c'est la clé). Renommer n'est pas proposé — inutile, et un renommage casserait la correspondance avec les dispositions perso existantes.

## 6. Hors périmètre (2a)

- **Crowdsourcing** : propositions joueurs, notification Discord, onglet de revue, porte de sortie → 2b.
- **Historique/versions** d'une grille : une ligne par vaisseau, republier remplace.
- **Rotation d'un module isolé** : non prévu ; l'orientation globale reste « Tourner »/« Miroir ».
- **Modifier la capacité à la main** : impossible par conception (dérivée des dimensions, §2).

## 7. Tests et vérification

- **Non-régression** : `node scripts/cargo-packing-tests.cjs` doit rester `34/34`. Le rangement ne doit pas changer selon que les soutes viennent de FleetYards ou de Supabase — mêmes champs, mêmes unités.
- **Vérification navigateur (headless)** : la capacité dérivée suit les dimensions ; ajouter/supprimer/redimensionner modifie bien la grille en cours ; « Publier » envoie la grille attendue ; un vaisseau avec grille publiée masque les contrôles d'édition pour un non-admin ; priorité publiée > perso > auto ; l'absence de grille publiée laisse le comportement actuel intact.
- **Limite honnête** : la partie Supabase (RLS, droits admin réels) **ne peut pas être testée côté développement** — aucun accès au projet. Elle se valide au premier essai réel du mainteneur. Le code client doit dégrader proprement si les tables n'existent pas encore.
- **Test de la dérivation** : `capacity = (x/1.25)*(y/1.25)*(z/1.25)` est vérifiable hors navigateur — à couvrir par un test Node aux côtés de la suite existante.

## 8. Livraison du SQL et gestion des secrets

**Décision (utilisateur)** : le mainteneur exécute le SQL lui-même dans l'éditeur SQL de Supabase. Aucun accès au projet n'est donné au développement — ni clé `service_role`, ni mot de passe Postgres, ni CLI. Ces identifiants contournent la RLS (lecture/écriture/suppression sur les données de tous les joueurs) et le dépôt est **public** : une fuite serait immédiate et définitive. (La clé `anon` de `js/cloud.js` est publique par conception — elle n'ouvre que ce que la RLS autorise.)

Le SQL est versionné en **`docs/supabase/admin-grid-editor.sql`**, avec un **placeholder** `<TON_USER_ID>` pour l'`insert` dans `admins`. Le mainteneur substitue la valeur **au moment de coller** dans l'éditeur Supabase ; elle n'entre jamais dans le dépôt.

(2b ajoutera un second script contenant, lui, l'URL du webhook Discord — secret à ne surtout pas committer, le dépôt étant public.)

**Étapes pour le mainteneur** :
1. Se connecter une fois via Discord sur l'app, puis récupérer son `user_id` dans Supabase → Authentication → Users.
2. Ouvrir `docs/supabase/admin-grid-editor.sql`, remplacer `<TON_USER_ID>` par cette valeur **dans l'éditeur Supabase**, et exécuter.
