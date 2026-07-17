# Grilles de cargo communautaires (proposition + modération) — conception

**Statut : à implémenter.** Brique 2 du chantier commencé avec le placement manuel (`2026-07-17-manual-cargo-grid-placement-design.md`, livré : placement perso au glisser, x/y/z, aimanté 1 SCU, mémorisé par vaisseau et synchronisé sur le compte).

## Contexte et objectif

FleetYards ne fournit aucune position réelle pour les modules de soute ; la reconstruction automatique par mots-clés est une approximation souvent fausse (Ironclad, Caterpillar). La Brique 1 laisse chaque joueur corriger son vaisseau — mais uniquement **pour lui**. Chaque joueur refait donc le même travail dans son coin, et le mainteneur n'en profite jamais.

**Objectif** : un joueur propose sa disposition, le mainteneur est notifié sur Discord, la valide, et elle devient le défaut de **tous les joueurs**.

**Objectif de fond (décision utilisateur)** : les grilles validées sont stockées **entièrement** dans Supabase (définitions **et** positions) et servent **à la place de FleetYards** pour ce vaisseau. Chaque validation détache un vaisseau de plus de FleetYards — l'app s'en émancipe progressivement, et pourra à terme héberger des grilles que FleetYards ne connaît pas.

**Revers assumé** : un vaisseau détaché ne bénéficie plus des corrections automatiques de FleetYards (si un patch change une soute, la copie Supabase reste figée jusqu'à ce qu'un joueur propose une correction — ce que la porte de sortie permet).

## 1. Modèle de données (Supabase)

Trois tables. Le SQL complet est fourni au mainteneur, qui l'exécute lui-même (aucun accès à son projet côté développement).

### `admins`
| colonne | type |
|---|---|
| `user_id` | `uuid` primary key (référence `auth.users`) |

Le mainteneur y insère son propre `user_id` (Supabase → Authentication → Users, après sa connexion Discord). Sert à la fois aux règles RLS et à l'affichage de l'onglet admin.

### `layout_submissions` — les propositions
| colonne | type |
|---|---|
| `id` | `uuid` pk, `gen_random_uuid()` |
| `ship_name` | `text not null` |
| `grid` | `jsonb not null` — la grille complète résolue (voir §3) |
| `orientation` | `smallint not null default 0` (0-3) |
| `mirror` | `boolean not null default false` |
| `submitted_by` | `uuid not null default auth.uid()` |
| `submitter_name` | `text` — pseudo Discord, pour la liste admin |
| `status` | `text not null default 'pending'` — `pending` \| `approved` \| `rejected` |
| `created_at` | `timestamptz not null default now()` |
| `reviewed_at` | `timestamptz` |

### `ship_layouts` — les grilles validées
| colonne | type |
|---|---|
| `ship_name` | `text` primary key |
| `grid` | `jsonb not null` |
| `orientation` | `smallint not null default 0` |
| `mirror` | `boolean not null default false` |
| `approved_at` | `timestamptz not null default now()` |
| `source_submission` | `uuid` référence `layout_submissions(id)` |

`ship_name` en clé primaire : **une seule grille validée par vaisseau**, la validation d'une nouvelle proposition remplace la précédente (`upsert`). C'est ce qui rend une correction post-patch possible.

## 2. RLS et RPC

**RLS — c'est le seul vrai garde-fou.** La clé anon est publique et le client n'est jamais digne de confiance : masquer un bouton n'est pas une sécurité. Toute la protection est dans la base.

- `ship_layouts` : `select` **public** (y compris anon, non connecté — l'app doit pouvoir lire les grilles sans compte). `insert`/`update`/`delete` : admins uniquement.
- `layout_submissions` : `insert` réservé aux utilisateurs connectés et seulement pour eux-mêmes (`submitted_by = auth.uid()`) ; `select` de ses propres lignes, ou de toutes si admin ; `update` admins uniquement.
- `admins` : `select` limité à sa propre ligne (un joueur peut savoir s'il est admin, sans lire la liste).

**Deux fonctions RPC** (`security definer`, contrôle admin explicite dans le corps) :
- `approve_submission(submission_id uuid)` — marque la proposition `approved` **et** fait l'`upsert` dans `ship_layouts`, **dans une seule transaction**. L'atomicité est indispensable : deux requêtes séparées depuis le client pourraient échouer à moitié et laisser une proposition « validée » qui ne s'applique à personne.
- `reject_submission(submission_id uuid)` — marque `rejected`.

## 3. Forme de la grille (`grid`)

Un tableau, un objet par module :

```json
[
  {
    "key": "hardpoint_cargogrid_front_left",
    "name": "hardpoint_cargogrid_front_left",
    "dimensions": { "x": 7.5, "y": 25.0, "z": 7.5 },
    "capacity": 720,
    "maxContainerSize": 32,
    "position": { "x": 0, "y": 0, "z": 12.5 }
  }
]
```

- `dimensions`, `capacity`, `maxContainerSize` : mêmes champs et mêmes unités que ceux que `js/fleetyards.js` produit aujourd'hui, pour que `js/cargo-packing.js` fonctionne **sans aucune modification** quand la grille vient de Supabase.
- `position` : la position **résolue** du module dans le repère du visualiseur (l'origine/coin, comme `worldPos`), pas la surcharge partielle.

**Conséquence importante** : la disposition perso (`state.cargoViewerLayout`) est une surcharge **partielle** — seuls les modules déplacés y figurent, les autres tiennent leur position de la reconstruction automatique faite au rendu. Une proposition doit contenir **tous** les modules, donc `js/cargo-viewer.js` doit exposer les positions résolues du dernier rendu (nouveau `window.getResolvedCargoGrid()` → le tableau ci-dessus). Rien ne les expose aujourd'hui.

**Bénéfice** : une grille validée porte des positions exactes pour tous ses modules → pour ce vaisseau, le visualiseur **ne reconstruit plus rien**, il place. La reconstruction ne sert plus qu'aux vaisseaux non encore validés.

## 4. Notification Discord

Un **trigger SQL** sur `insert` dans `layout_submissions` appelle `pg_net.http_post` vers l'URL de webhook Discord du mainteneur, avec un corps `{"content": "..."}` (vaisseau, auteur, date, lien vers l'app).

Pourquoi un trigger et pas les « Database Webhooks » de l'interface Supabase : ceux-ci envoient leur propre enveloppe (`type`/`record`/`old_record`), que Discord rejette (400) — Discord impose sa forme de corps. Le trigger permet de construire exactement le JSON attendu.

L'URL du webhook vit **dans la fonction SQL, côté serveur**. Elle ne doit jamais passer dans le JS : le client étant public, l'URL le serait aussi et n'importe qui pourrait inonder le salon Discord.

Nécessite `create extension if not exists pg_net;` (disponible sur Supabase).

## 5. Côté app — récupération et priorité

`runFullSync()` (`js/app.js`) récupère `ship_layouts` et le met en cache dans `state.approvedShipGrids = { [shipName]: { grid, orientation, mirror } }` — même motif que `state.fleetyardsCargoHolds` (cache local, relecture périodique). Lecture publique : marche déconnecté.

**Source des soutes d'un vaisseau** : grille validée (mappée vers la forme attendue) **sinon** FleetYards **sinon** rien. C'est le point exact du détachement progressif : un vaisseau validé n'interroge plus FleetYards.

Mise en œuvre : `getShipCargoHolds(shipName)` vit dans `js/fleetyards.js` et reste **inchangé** — ce fichier ne parle que de FleetYards, y brancher Supabase mélangerait deux sources dans un module qui n'en connaît qu'une. On ajoute à la place un résolveur dans `js/app.js` :

```js
// Soutes du vaisseau, grille validée d'abord (Supabase), FleetYards ensuite.
// C'est ici que se fait le détachement : un vaisseau validé n'utilise plus
// du tout les données FleetYards.
function getShipHolds(shipName) {
  const approved = state.approvedShipGrids[shipName];
  if (approved) return approved.grid.map((m) => ({
    name: m.name,
    dimensions: m.dimensions,
    capacity: m.capacity,
    maxContainerSize: m.maxContainerSize,
  }));
  return typeof getShipCargoHolds === "function" ? getShipCargoHolds(shipName) : null;
}
```

`getShipCargoHolds` n'a qu'**un seul appelant** aujourd'hui (`js/app.js:2243`, dans `runCargoPacking`) : c'est la seule ligne à basculer sur `getShipHolds`.

**Positions dans le visualiseur** : grille validée (positions exactes) > disposition perso (surcharge partielle) > reconstruction automatique.

**Orientation/miroir** : ceux de la grille validée s'appliquent et sont verrouillés, sauf déverrouillage (§6).

## 6. Verrouillage et porte de sortie

- **Vaisseau sans grille validée** : comportement actuel — « Éditer la disposition » disponible, plus un nouveau bouton **« Proposer cette disposition »** (visible seulement si connecté).
- **Vaisseau avec grille validée, non déverrouillé** : « Éditer la disposition », « Tourner » et « Miroir » sont **masqués**. Mention « Disposition validée par la communauté ». Un bouton discret **« Proposer une correction »**.
- **« Proposer une correction »** : amorce `state.cargoViewerLayout[ship]` **à partir de la grille validée** (le joueur corrige à partir d'elle, il ne repart pas de zéro), pose `state.cargoViewerUnlocked[ship] = true`, et rend l'édition + « Proposer cette disposition » disponibles. Ce déverrouillage est **local à ce joueur** et ne change rien pour les autres.

`cargoViewerUnlocked` rejoint `CLOUD_SYNCED_KEYS` (comme les autres réglages du visualiseur).

**Motivation** (décision utilisateur, après discussion) : Star Citizen patche les vaisseaux ; un verrouillage strict rendrait toute grille validée définitive côté joueurs et tarirait les propositions pour ce vaisseau, laissant au seul mainteneur la charge de repérer et refaire chaque vaisseau modifié.

## 7. Proposer une disposition

Bouton « Proposer cette disposition » (uniquement si connecté) → `insert` dans `layout_submissions` avec `ship_name`, `grid` (via `getResolvedCargoGrid()`), `orientation`, `mirror`, `submitter_name` (pseudo Discord de la session).

Retour visible : « Proposition envoyée, en attente de validation ». Une proposition `pending` du même joueur pour le même vaisseau est **remplacée** (pas d'empilement de doublons) — l'insert se fait en `upsert` sur `(submitted_by, ship_name) where status = 'pending'`.

## 8. Onglet admin

Visible uniquement si le compte connecté figure dans `admins`. Contenu :
- La liste des propositions `pending` : vaisseau, auteur, date.
- Un **aperçu 3D** de la proposition sélectionnée : réutilise `renderCargoViewer3D(holds, [], orientation, mirror, layout)` avec les modules de la proposition et **aucune caisse**. C'est ce qui permet de juger une grille au lieu de valider du JSON en aveugle.
- **Valider** (`approve_submission`) / **Rejeter** (`reject_submission`).

L'onglet n'est qu'un confort : la RLS refuse les écritures d'un non-admin même s'il forçait l'affichage.

## 9. Hors périmètre

- **Créer une grille de zéro** (ajouter/supprimer/redimensionner des modules, pour un vaisseau que FleetYards ignore) : c'est la suite logique du détachement, mais une brique à part. Ici on ne fait que **déplacer** des modules existants.
- **Historique/versions** des grilles validées : une seule ligne par vaisseau, la validation remplace.
- **Vote/réputation communautaire** : la modération humaine est le seul filtre.
- **Interface d'administration des admins** : la table `admins` se remplit à la main en SQL.

## 10. Tests et vérification

- **Non-régression** : `node scripts/cargo-packing-tests.cjs` doit rester `34/34` — le rangement ne doit pas changer selon que les soutes viennent de FleetYards ou de Supabase (mêmes champs, mêmes unités).
- **Vérification navigateur (headless)** : verrouillage (boutons masqués quand une grille validée existe), porte de sortie (« Proposer une correction » déverrouille et amorce depuis la grille validée), priorité (grille validée > perso > auto), et que `getResolvedCargoGrid()` renvoie bien **tous** les modules avec des positions.
- **Limite honnête** : la partie Supabase (RLS, RPC, trigger Discord) **ne peut pas être testée côté développement** — pas d'accès au projet. Elle se valide au premier essai réel du mainteneur. Le SQL sera fourni prêt à exécuter, et le code client dégradera proprement si les tables n'existent pas encore (pas de grille validée = comportement actuel).

## 11. Livraison du SQL et gestion des secrets

**Décision (utilisateur)** : le mainteneur exécute le SQL lui-même dans l'éditeur SQL de Supabase. Aucun accès à son projet n'est donné au développement — ni clé `service_role`, ni mot de passe Postgres, ni CLI. C'est le choix le plus sûr : ces identifiants contournent la RLS (lecture/écriture/suppression sur les données de tous les joueurs) et le dépôt est **public**, donc une fuite serait immédiate et définitive. (La clé `anon` de `js/cloud.js` est publique par conception — c'est l'inverse ; elle n'ouvre que ce que la RLS autorise.)

**Forme de la livraison** : le SQL est versionné dans le dépôt, en **`docs/supabase/crowdsourced-grids.sql`**, avec des **placeholders** à la place des valeurs sensibles :

- `<TON_WEBHOOK_DISCORD>` — l'URL du webhook, dans le corps de la fonction du trigger.
- `<TON_USER_ID>` — l'`uuid` du mainteneur, pour l'`insert` dans `admins`.

Le mainteneur substitue ces deux valeurs **au moment de coller** dans l'éditeur Supabase. **Elles ne doivent jamais être committées** : le dépôt étant public, une URL de webhook committée permettrait à n'importe qui d'inonder le salon Discord. Le fichier versionné documente donc le schéma sans jamais porter de secret.

**Étapes pour le mainteneur** :
1. Ouvrir `docs/supabase/crowdsourced-grids.sql`, y remplacer les deux placeholders par ses vraies valeurs (dans l'éditeur Supabase, pas dans le fichier du dépôt).
2. Exécuter le script (tables, RLS, RPC, trigger, `pg_net`).
3. Récupérer son `user_id` dans Supabase → Authentication → Users (après s'être connecté une fois via Discord).
