-- =========================================================================
-- Grilles de cargo publiées + admins (Brique 2a).
-- À exécuter tel quel dans l'éditeur SQL de Supabase.
--
-- AVANT D'EXÉCUTER : remplace <TON_USER_ID> (tout en bas) par ton uuid,
-- visible dans Supabase > Authentication > Users après t'être connecté une
-- fois via Discord sur l'app.
--
-- NE COMMITTE JAMAIS ce fichier avec ton vrai user_id : le dépôt est public.
-- =========================================================================

-- --- Tables ---------------------------------------------------------------

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.ship_layouts (
  ship_name   text primary key,
  grid        jsonb not null,
  orientation smallint not null default 0,
  mirror      boolean  not null default false,
  updated_at  timestamptz not null default now()
);

alter table public.admins       enable row level security;
alter table public.ship_layouts enable row level security;

-- --- Qui est admin ? ------------------------------------------------------
-- Fonction utilitaire : évite de répéter le sous-select dans chaque policy.
-- STABLE + security definer pour pouvoir lire admins sans que la policy de
-- admins ne se rappelle elle-même en boucle.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- --- RLS : admins ---------------------------------------------------------
-- Un joueur peut savoir s'il est admin (sa propre ligne), sans lire la liste.
drop policy if exists admins_select_self on public.admins;
create policy admins_select_self on public.admins
  for select using (user_id = auth.uid());

-- --- RLS : ship_layouts ---------------------------------------------------
-- Lecture PUBLIQUE (y compris anon non connecté) : l'app doit pouvoir lire
-- les grilles sans compte.
drop policy if exists ship_layouts_select_public on public.ship_layouts;
create policy ship_layouts_select_public on public.ship_layouts
  for select using (true);

-- Écriture réservée aux admins. C'est le seul vrai garde-fou : la clé anon
-- est publique et le client n'est jamais digne de confiance.
drop policy if exists ship_layouts_write_admin on public.ship_layouts;
create policy ship_layouts_write_admin on public.ship_layouts
  for all using (public.is_admin()) with check (public.is_admin());

-- --- Ton compte admin -----------------------------------------------------
-- Remplace <TON_USER_ID> puis exécute.
insert into public.admins (user_id)
values ('<TON_USER_ID>')
on conflict (user_id) do nothing;
