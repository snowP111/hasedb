-- HaseDB – Umbau für zwei Personen (einmal im Supabase SQL Editor ausführen, Projekt „Hase Project“)
-- Bestehende Daten bleiben erhalten: vorhandene Reviews und Smoke-Counter-Tage werden dem
-- ZUERST angelegten Konto (Lucas) zugeordnet. Das Skript darf mehrfach laufen.
--
-- Danach gilt:
--   hases     – gemeinsame Sortenliste, beide dürfen alles bearbeiten (wie bisher)
--   reviews   – ein Review pro Person und Sorte; beide sehen alle, jeder ändert nur seins
--   rauchtage – Smoke-Counter pro Person; beide sehen alle (für den Vergleich), jeder ändert nur seine
--   profile   – Anzeigename pro Person
--   orte      – Orte der Karte; privat (nur selbst) oder geteilt (beide sehen sie), ändern nur der Ersteller
--
-- Hinweis: Die alte Mac-App (JavaFX) kann danach keine Smoke-Counter-Tage mehr speichern.

begin;

-- ---------------------------------------------------------------- Profile
create table if not exists public.profile (
  user_id   uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  name      text not null check (char_length(btrim(name)) between 1 and 40),
  geaendert timestamptz not null default now()
);
alter table public.profile enable row level security;
drop policy if exists "profile: alle lesen"   on public.profile;
drop policy if exists "profile: eigenes anlegen" on public.profile;
drop policy if exists "profile: eigenes ändern"  on public.profile;
create policy "profile: alle lesen"      on public.profile for select to authenticated using (true);
create policy "profile: eigenes anlegen" on public.profile for insert to authenticated with check (auth.uid() = user_id);
create policy "profile: eigenes ändern"  on public.profile for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- Sorten (gemeinsam)
alter table public.hases add column if not exists erstellt_von uuid default auth.uid() references auth.users (id) on delete set null;
-- Spalte hases.review bleibt als Sicherung stehen (wird von der neuen App nicht mehr geschrieben).

-- ---------------------------------------------------------------- Reviews je Person
create table if not exists public.reviews (
  hase_id   bigint not null references public.hases (id) on delete cascade,
  user_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  text      text   not null default '',
  geaendert timestamptz not null default now(),
  primary key (hase_id, user_id)
);
alter table public.reviews enable row level security;
drop policy if exists "reviews: alle lesen"     on public.reviews;
drop policy if exists "reviews: eigene anlegen" on public.reviews;
drop policy if exists "reviews: eigene ändern"  on public.reviews;
drop policy if exists "reviews: eigene löschen" on public.reviews;
create policy "reviews: alle lesen"     on public.reviews for select to authenticated using (true);
create policy "reviews: eigene anlegen" on public.reviews for insert to authenticated with check (auth.uid() = user_id);
create policy "reviews: eigene ändern"  on public.reviews for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reviews: eigene löschen" on public.reviews for delete to authenticated using (auth.uid() = user_id);

-- bisherige Reviews → erstes Konto
insert into public.reviews (hase_id, user_id, text)
select h.id, (select id from auth.users order by created_at limit 1), btrim(h.review)
from public.hases h
where btrim(coalesce(h.review, '')) <> ''
on conflict (hase_id, user_id) do nothing;

-- ---------------------------------------------------------------- Smoke-Counter je Person
alter table public.rauchtage add column if not exists user_id uuid references auth.users (id) on delete cascade;
update public.rauchtage set user_id = (select id from auth.users order by created_at limit 1) where user_id is null;
alter table public.rauchtage alter column user_id set not null;
alter table public.rauchtage alter column user_id set default auth.uid();
alter table public.rauchtage drop constraint if exists rauchtage_pkey;
alter table public.rauchtage add constraint rauchtage_pkey primary key (user_id, datum);

drop policy if exists "nur angemeldet"            on public.rauchtage;
drop policy if exists "rauchtage: alle lesen"     on public.rauchtage;
drop policy if exists "rauchtage: eigene anlegen" on public.rauchtage;
drop policy if exists "rauchtage: eigene ändern"  on public.rauchtage;
drop policy if exists "rauchtage: eigene löschen" on public.rauchtage;
create policy "rauchtage: alle lesen"     on public.rauchtage for select to authenticated using (true);
create policy "rauchtage: eigene anlegen" on public.rauchtage for insert to authenticated with check (auth.uid() = user_id);
create policy "rauchtage: eigene ändern"  on public.rauchtage for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "rauchtage: eigene löschen" on public.rauchtage for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------- Orte (Karte)
create table if not exists public.orte (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  kategorie  text not null default 'sonstiges',
  notiz      text not null default '',
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  geteilt    boolean not null default false,
  erstellt   timestamptz not null default now(),
  geaendert  timestamptz not null default now()
);
alter table public.orte add column if not exists geteilt boolean not null default false;
create index if not exists orte_user_idx on public.orte (user_id);
alter table public.orte enable row level security;
drop policy if exists "orte: eigene und geteilte lesen" on public.orte;
drop policy if exists "orte: eigene anlegen"            on public.orte;
drop policy if exists "orte: eigene ändern"             on public.orte;
drop policy if exists "orte: eigene löschen"            on public.orte;
create policy "orte: eigene und geteilte lesen" on public.orte for select to authenticated using (auth.uid() = user_id or geteilt);
create policy "orte: eigene anlegen"            on public.orte for insert to authenticated with check (auth.uid() = user_id);
create policy "orte: eigene ändern"             on public.orte for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "orte: eigene löschen"            on public.orte for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------- Rechte (nur angemeldet, nie anonym)
revoke all on public.profile, public.reviews, public.orte from anon;
grant select, insert, update          on public.profile   to authenticated;
grant select, insert, update, delete  on public.reviews   to authenticated;
grant select, insert, update, delete  on public.rauchtage to authenticated;
grant select, insert, update, delete  on public.orte      to authenticated;
grant select, insert, update, delete  on public.hases     to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
