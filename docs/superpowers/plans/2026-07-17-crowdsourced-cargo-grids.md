# Grilles de cargo communautaires (brique 2b) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un joueur de proposer sa disposition de grille, notifier le mainteneur sur Discord, et lui donner un onglet pour valider/rejeter ; une validation devient le défaut de tous les joueurs (upsert dans `ship_layouts`, déjà lu par la 2a).

**Architecture :** La 2a a déjà livré le socle (`admins`, `ship_layouts`, `getShipHolds`, `state.approvedShipGrids`, `getResolvedCargoGrid`, le verrouillage des contrôles sur grille publiée, la publication admin). La 2b **ajoute** : la table `layout_submissions` + RLS + RPC `approve_submission`/`reject_submission` + trigger Discord (SQL exécuté par le mainteneur), des fonctions `js/cloud.js` (proposer/lister/valider/rejeter), le bouton « Proposer cette disposition » + la porte de sortie « Proposer une correction » (déverrouillage local), et un onglet de revue admin.

**Tech Stack :** JS vanilla (scripts classiques, `cargo-viewer.js` seul module ES) ; Supabase (client `sb` public, RLS-gated) ; SQL PostgreSQL + `pg_net`.

## Global Constraints

- **La partie Supabase est INTESTABLE côté développement** (aucun accès au projet). Le SQL est livré prêt à coller ; le client **dégrade proprement** si les tables/RPC n'existent pas encore (aucune proposition = comportement actuel), exactement comme la 2a. Les tests navigateur ne couvrent que le dégradé et la logique UI locale.
- **Dépôt PUBLIC, jamais de secret.** Le SQL versionné (`docs/supabase/crowdsourced-grids.sql`) porte des **placeholders** : `<TON_WEBHOOK_DISCORD>` (URL du webhook, dans la fonction trigger, **côté serveur uniquement**) et `<TON_USER_ID>`. **L'URL du webhook ne doit JAMAIS apparaître dans le JS client** — le client est public, l'URL le serait, et n'importe qui pourrait inonder le salon.
- **RLS = seul vrai garde-fou.** La clé anon est publique ; masquer un bouton n'est pas une sécurité. Toutes les écritures sont contrôlées côté base (RLS + RPC `security definer` avec contrôle admin explicite).
- **Atomicité de la validation** : `approve_submission` marque `approved` **et** upsert dans `ship_layouts` dans **une seule transaction** (deux requêtes client séparées pourraient échouer à moitié).
- **`capacity` DÉRIVÉE** des dimensions (jamais saisie) ; `maxContainerSize` ∈ {1,2,4,8,16,24,32}. La grille proposée réutilise `getResolvedCargoGrid()` (déjà conforme).
- **Cache-busting manuel** (~23 `?v=` dans `index.html`) ; **i18n en DEUX dictionnaires** (FR puis EN).
- `node scripts/cargo-packing-tests.cjs` reste `47/47` (2b ne touche pas `cargo-packing.js`).
- Spec : `docs/superpowers/specs/2026-07-17-crowdsourced-cargo-grids-design.md`.

## Repères de code (lus, exacts)

- `js/cloud.js` : client `sb` (l.33), `cloudUserId` (l.38), motif des fetch — `fetchApprovedShipGrids` (l.241, `sb.from("ship_layouts").select(...)`), `fetchIsAdmin` (l.260), `publishShipGrid` (l.273, `sb.from("ship_layouts").upsert(...)`). `CLOUD_SYNCED_KEYS` (l.19). `isAdminUser` est un global de `js/app.js` posé par `fetchIsAdmin`.
- `js/app.js` : `getResolvedCargoGrid` est exposé par le visualiseur (`js/cargo-viewer.js:930`) et renvoie `{name, moduleKey, dimensions, capacity, maxContainerSize, position}` par module — la forme exacte d'une proposition. `getCargoViewerShipName()`, `getShipHolds()`, `getCargoViewerOrientation/Mirror()`, `renderCargoStepView()` (le `locked = !!publishedGrid && !isAdminUser`, ~l.2395). `state`/`defaultState`/`loadState` pour ajouter `cargoViewerUnlocked`. `renderAdminGridEntry` (visibilité d'un contrôle admin).
- `index.html` : 6 onglets `.tab-btn` (l.96-101), panneaux `.tab-panel`. Le SQL 2a modèle : `docs/supabase/admin-grid-editor.sql`.

---

## Task 1 : Le SQL communautaire (docs, exécuté par le mainteneur)

**Files:** Create `docs/supabase/crowdsourced-grids.sql`
**Interfaces:** Produces (consommé par Task 2) : table `layout_submissions`, RPC `approve_submission(uuid)`/`reject_submission(uuid)`, trigger Discord sur insert. `ship_layouts`/`admins`/`is_admin()` existent déjà (2a) — ce script ne les recrée pas, il s'appuie dessus.

- [ ] **Step 1 : Écrire le fichier SQL (placeholders, aucun secret)**

```sql
-- =========================================================================
-- Grilles de cargo communautaires (Brique 2b) — propositions + modération.
-- PRÉREQUIS : le script de la Brique 2a (docs/supabase/admin-grid-editor.sql)
-- doit avoir été exécuté (tables admins/ship_layouts, fonction is_admin()).
--
-- AVANT D'EXÉCUTER, remplace (dans l'éditeur Supabase, PAS dans ce fichier) :
--   <TON_WEBHOOK_DISCORD> par l'URL de ton webhook Discord
--   <TON_USER_ID>         par ton uuid (déjà inséré en 2a ; ré-insert sans risque)
-- NE COMMITTE JAMAIS ce fichier avec ces valeurs : le dépôt est public. Une URL
-- de webhook committée laisserait n'importe qui inonder ton salon Discord.
-- =========================================================================

create extension if not exists pg_net;

-- --- Table des propositions -----------------------------------------------
create table if not exists public.layout_submissions (
  id             uuid primary key default gen_random_uuid(),
  ship_name      text not null,
  grid           jsonb not null,
  orientation    smallint not null default 0,
  mirror         boolean  not null default false,
  submitted_by   uuid not null default auth.uid(),
  submitter_name text,
  status         text not null default 'pending',
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz
);

-- Une seule proposition EN ATTENTE par (joueur, vaisseau) : la nouvelle
-- remplace l'ancienne (voir l'upsert côté client, §7 du spec).
create unique index if not exists layout_submissions_one_pending
  on public.layout_submissions (submitted_by, ship_name)
  where status = 'pending';

alter table public.layout_submissions enable row level security;

-- --- RLS : layout_submissions ---------------------------------------------
-- Insert : un utilisateur connecté, seulement pour lui-même.
drop policy if exists submissions_insert_self on public.layout_submissions;
create policy submissions_insert_self on public.layout_submissions
  for insert with check (submitted_by = auth.uid());
-- Select : ses propres lignes, ou toutes si admin.
drop policy if exists submissions_select on public.layout_submissions;
create policy submissions_select on public.layout_submissions
  for select using (submitted_by = auth.uid() or public.is_admin());
-- Update : admins uniquement (la validation/le rejet passent par les RPC).
drop policy if exists submissions_update_admin on public.layout_submissions;
create policy submissions_update_admin on public.layout_submissions
  for all using (public.is_admin()) with check (public.is_admin());

-- --- RPC : valider (atomique) ---------------------------------------------
-- Marque la proposition approved ET upsert dans ship_layouts, en UNE
-- transaction. security definer + contrôle admin explicite dans le corps.
create or replace function public.approve_submission(submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare s public.layout_submissions;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  select * into s from public.layout_submissions where id = submission_id;
  if not found then
    raise exception 'submission not found';
  end if;
  update public.layout_submissions
     set status = 'approved', reviewed_at = now()
   where id = submission_id;
  insert into public.ship_layouts (ship_name, grid, orientation, mirror, updated_at)
  values (s.ship_name, s.grid, s.orientation, s.mirror, now())
  on conflict (ship_name) do update
     set grid = excluded.grid, orientation = excluded.orientation,
         mirror = excluded.mirror, updated_at = now();
end;
$$;

-- --- RPC : rejeter --------------------------------------------------------
create or replace function public.reject_submission(submission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;
  update public.layout_submissions
     set status = 'rejected', reviewed_at = now()
   where id = submission_id;
end;
$$;

-- --- Notification Discord (trigger, URL côté SERVEUR) ---------------------
-- Les « Database Webhooks » de l'UI envoient leur propre enveloppe
-- (type/record/old_record) que Discord rejette (400) : on construit donc
-- nous-mêmes le corps { "content": ... } attendu par Discord.
create or replace function public.notify_discord_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := '<TON_WEBHOOK_DISCORD>',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'content',
      format('Nouvelle proposition de grille : **%s** par %s (%s)',
             new.ship_name,
             coalesce(new.submitter_name, 'anonyme'),
             to_char(new.created_at, 'YYYY-MM-DD HH24:MI'))
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_discord on public.layout_submissions;
create trigger trg_notify_discord
  after insert on public.layout_submissions
  for each row execute function public.notify_discord_submission();

-- --- Ton compte admin (déjà fait en 2a ; ré-insert sans risque) -----------
insert into public.admins (user_id)
values ('<TON_USER_ID>')
on conflict (user_id) do nothing;
```

- [ ] **Step 2 : Auto-relecture (pas d'exécution possible côté dev)**

Vérifier : les deux placeholders présents, aucune vraie valeur ; le trigger construit `{"content": ...}` (pas l'enveloppe Supabase) ; `approve_submission` fait bien update + upsert dans le même corps `plpgsql` (atomique) ; les RPC vérifient `is_admin()`. Confirmer que le script **ne recrée pas** `admins`/`ship_layouts`/`is_admin()` (livrés en 2a) — il les consomme.

- [ ] **Step 3 : Commit** — `git add docs/supabase/crowdsourced-grids.sql && git commit -m "Zones communautaires (2b) : SQL propositions + RPC + trigger Discord (placeholders)"`

---

## Task 2 : Fonctions cloud (proposer / lister / valider / rejeter)

**Files:** Modify `js/cloud.js`
**Interfaces:**
- Consumes : `sb`, `cloudUserId`, motif des fetch existants.
- Produces (consommé par Tasks 3-4) :
  - `submitLayoutProposal(shipName, grid, orientation, mirror, submitterName) -> Promise<boolean>`
  - `fetchPendingSubmissions() -> Promise<Array>` (`[]` si erreur/absent)
  - `approveSubmission(id) -> Promise<boolean>` / `rejectSubmission(id) -> Promise<boolean>`

- [ ] **Step 1 : Écrire les fonctions (dégradation propre)**

```js
// Proposer sa disposition : upsert sur (submitted_by, ship_name) filtré pending
// (une proposition en attente par joueur+vaisseau, voir l'index SQL). En échec
// (pas connecté, table absente, RLS), renvoie false sans casser l'app.
async function submitLayoutProposal(shipName, grid, orientation, mirror, submitterName) {
  if (!sb || !cloudUserId) return false;
  const { error } = await sb.from("layout_submissions").upsert(
    {
      ship_name: shipName,
      grid,
      orientation: orientation || 0,
      mirror: !!mirror,
      submitted_by: cloudUserId,
      submitter_name: submitterName || null,
      status: "pending",
      created_at: new Date().toISOString(),
      reviewed_at: null,
    },
    { onConflict: "submitted_by,ship_name" }
  );
  if (error) {
    console.warn("submitLayoutProposal:", error.message);
    return false;
  }
  return true;
}

async function fetchPendingSubmissions() {
  if (!sb) return [];
  const { data, error } = await sb
    .from("layout_submissions")
    .select("id, ship_name, grid, orientation, mirror, submitter_name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("fetchPendingSubmissions:", error.message);
    return [];
  }
  return data || [];
}

async function approveSubmission(id) {
  if (!sb) return false;
  const { error } = await sb.rpc("approve_submission", { submission_id: id });
  if (error) {
    console.warn("approveSubmission:", error.message);
    return false;
  }
  return true;
}

async function rejectSubmission(id) {
  if (!sb) return false;
  const { error } = await sb.rpc("reject_submission", { submission_id: id });
  if (error) {
    console.warn("rejectSubmission:", error.message);
    return false;
  }
  return true;
}
```

> Note : l'`upsert` sur un index partiel `where status='pending'` peut ne pas matcher côté PostgREST selon la version. Si un vrai essai du mainteneur montre des doublons, replier sur : delete des `pending` du même `(submitted_by, ship_name)` puis insert. À vérifier au premier essai réel (intestable côté dev).

- [ ] **Step 2 : Vérifier la dégradation (headless)** — sans Supabase joignable, `fetchPendingSubmissions()` renvoie `[]`, `submitLayoutProposal(...)` renvoie `false`, aucune exception non capturée. `node --check js/cloud.js`.

- [ ] **Step 3 : Commit** — `Zones communautaires (2b) : fonctions cloud proposer/lister/valider/rejeter`

---

## Task 3 : « Proposer cette disposition » + porte de sortie + déverrouillage

**Files:** Modify `index.html` (boutons dans `.cargo-viewer-controls`), `js/app.js` (état `cargoViewerUnlocked`, handlers, verrouillage), `js/cloud.js`→`CLOUD_SYNCED_KEYS`, `js/i18n.js`.
**Interfaces:** Consumes `submitLayoutProposal` (T2), `getResolvedCargoGrid`, `getCargoViewerShipName`, `getCargoViewerOrientation/Mirror`.

- [ ] **Step 1 : État + sync** — Ajouter `cargoViewerUnlocked: {}` à `defaultState()` et `loadState()` (`parsed.cargoViewerUnlocked || {}`), et `"cargoViewerUnlocked"` à `CLOUD_SYNCED_KEYS` (`js/cloud.js`).

- [ ] **Step 2 : Boutons (HTML)** — Dans `.cargo-viewer-controls`, ajouter `#propose-layout-btn` (`data-i18n="proposeLayoutBtn"`) et `#propose-correction-btn` (`data-i18n="proposeCorrectionBtn"`), tous deux `style="display:none;"`. Cache-bust.

- [ ] **Step 3 : Visibilité + verrouillage (dans `renderCargoStepView`)** — Là où `locked = !!publishedGrid && !isAdminUser` est calculé, tenir compte du déverrouillage local :
  - `const unlocked = shipName && state.cargoViewerUnlocked[shipName];`
  - `locked = !!publishedGrid && !isAdminUser && !unlocked;`
  - `#propose-layout-btn` visible si **connecté** (`isCloudConnected()` ou `cloudUserId`) ET (`!publishedGrid` ou `unlocked` ou admin) — on ne propose que ce qu'on peut éditer.
  - `#propose-correction-btn` visible si `publishedGrid && !unlocked && !isAdminUser` (grille validée, verrouillée, connecté). Afficher aussi la mention « Disposition validée par la communauté » (réutiliser `#cargo-published-note`, texte déjà géré en 2a).

- [ ] **Step 4 : Handlers (`js/app.js`)**
  - `proposeCurrentLayout()` : `grid = getResolvedCargoGrid()` ; `ok = await submitLayoutProposal(ship, grid, orientation, mirror, getDiscordName())` ; retour visible « Proposition envoyée » / « Échec ». (`getDiscordName` = pseudo de session s'il existe, sinon `null`.)
  - `proposeCorrection(ship)` : amorce `state.cargoViewerLayout[ship]` **depuis la grille validée** (positions de `state.approvedShipGrids[ship].grid`), pose `state.cargoViewerUnlocked[ship] = true`, `saveState()`, `renderCargoStepView()` — l'édition + « Proposer » redeviennent disponibles, **localement à ce joueur**.
  - Câbler les deux boutons dans le bloc d'init.

- [ ] **Step 5 : i18n (DEUX dicts)** — `proposeLayoutBtn` (« Proposer cette disposition » / « Propose this layout »), `proposeCorrectionBtn` (« Proposer une correction » / « Propose a correction »), `proposalSent` (« Proposition envoyée, en attente de validation » / …), `proposalFailed`.

- [ ] **Step 6 : Vérif headless** — déverrouillage : sur un vaisseau à grille publiée (simulée via `state.approvedShipGrids`), le non-admin voit « Proposer une correction » et pas « Éditer » ; après `proposeCorrection`, `cargoViewerUnlocked[ship]===true`, l'édition réapparaît, et `state.cargoViewerLayout[ship]` est amorcé depuis la grille publiée. `submitLayoutProposal` stubbé pour capturer le payload (grille complète + orientation). Cache-bust + commit.

---

## Task 4 : L'onglet de revue admin

**Files:** Modify `index.html` (7ᵉ onglet `#submissions-tab`, admin-only), `js/app.js` (rendu de la liste + aperçu 3D + valider/rejeter), `js/i18n.js`.
**Interfaces:** Consumes `fetchPendingSubmissions`, `approveSubmission`, `rejectSubmission` (T2), `renderCargoViewer3D`.

- [ ] **Step 1 : L'onglet (HTML)** — Ajouter `<button ... data-tab="submissions-tab" id="submissions-tab-btn" data-i18n="submissionsTab" style="display:none;">` et le panneau `#submissions-tab` (liste `#submissions-list`, zone d'aperçu réutilisant un conteneur de visualiseur). L'onglet reste `display:none` sauf pour un admin.

- [ ] **Step 2 : Visibilité admin** — Là où `isAdminUser` devient vrai (après `fetchIsAdmin`, voir 2a), afficher `#submissions-tab-btn`. Masqué sinon (RLS = vrai garde-fou ; l'onglet n'est qu'un confort).

- [ ] **Step 3 : Rendu de la liste + aperçu + actions**
  - `renderSubmissionsTab()` : `const subs = await fetchPendingSubmissions()` ; une ligne par proposition (vaisseau, auteur, date) + « Aperçu » / « Valider » / « Rejeter ».
  - « Aperçu » : `renderCargoViewer3D(sub.grid.map(m=>({name,dimensions,capacity,maxContainerSize})), [], sub.orientation, sub.mirror, positionsFrom(sub.grid))` — modules de la proposition, **zéro caisse**, positions de la proposition (juger la grille, pas du JSON). Réutiliser le motif d'amorçage de l'éditeur admin (2a) pour les positions résolues.
  - « Valider » : `await approveSubmission(sub.id)` → succès : retirer la ligne, rafraîchir `state.approvedShipGrids` (re-fetch ou maj locale), re-rendre. « Rejeter » : `await rejectSubmission(sub.id)` → retirer la ligne.

- [ ] **Step 4 : i18n (DEUX dicts)** — `submissionsTab` (« Propositions » / « Submissions »), `submissionApprove`, `submissionReject`, `submissionPreview`, `submissionEmpty` (« Aucune proposition en attente » / …).

- [ ] **Step 5 : Vérif headless** — l'onglet est masqué pour un non-admin, visible pour un admin (`isAdminUser=true` + refresh) ; `fetchPendingSubmissions` stubbé pour renvoyer 2 propositions → 2 lignes rendues avec les 3 actions ; « Aperçu » appelle `renderCargoViewer3D` avec les bons modules ; valider/rejeter stubbés retirent la ligne. Cache-bust + commit.

---

## Notes de vérification finale (revue de branche)

- **Aucun secret** : l'URL du webhook n'est QUE dans le SQL (placeholder), jamais dans le JS. Grep `discord.com/api/webhooks` sur le JS → vide.
- **Dégradation** : tout le client marche sans les tables 2b (aucune proposition = comportement actuel). Confirmé pour chaque fonction cloud.
- **Atomicité** : la validation passe par le RPC `approve_submission` (transaction unique), jamais par deux écritures client.
- **Le mainteneur doit** exécuter `docs/supabase/crowdsourced-grids.sql` (placeholders remplis dans l'éditeur Supabase) et configurer son webhook Discord avant que la 2b ne s'active.
- `47/47` au packing (intouché).
