-- =========================================================================
-- Grilles de cargo communautaires (Brique 2b) — propositions + modération.
-- PRÉREQUIS : le script de la Brique 2a (docs/supabase/admin-grid-editor.sql)
-- doit avoir été exécuté (tables admins/ship_layouts, fonction is_admin()).
--
-- AVANT D'EXÉCUTER, remplace (dans l'éditeur SQL de Supabase, PAS dans ce
-- fichier du dépôt) :
--   <TON_WEBHOOK_DISCORD> par l'URL de ton webhook Discord
--   <TON_USER_ID>         par ton uuid (déjà inséré en 2a ; ré-insert sans risque)
--
-- NE COMMITTE JAMAIS ce fichier avec ces valeurs : le dépôt est PUBLIC. Une URL
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
-- remplace l'ancienne (voir l'upsert côté client).
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

-- Update/delete : admins uniquement (validation/rejet via les RPC ci-dessous).
drop policy if exists submissions_write_admin on public.layout_submissions;
create policy submissions_write_admin on public.layout_submissions
  for all using (public.is_admin()) with check (public.is_admin());

-- --- RPC : valider (ATOMIQUE) ---------------------------------------------
-- Marque la proposition approved ET upsert dans ship_layouts, en UNE
-- transaction : deux requêtes client séparées pourraient échouer à moitié et
-- laisser une proposition « validée » qui ne s'applique à personne.
-- security definer + contrôle admin EXPLICITE dans le corps (la RLS seule ne
-- protège pas un security definer).
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
-- Les « Database Webhooks » de l'UI Supabase envoient leur propre enveloppe
-- (type/record/old_record) que Discord rejette (400) : on construit donc
-- nous-mêmes le corps { "content": ... } attendu par Discord. L'URL vit ici,
-- côté serveur — JAMAIS dans le JS client (public).
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
