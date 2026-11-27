-- HaseDB – Umbau für mehrere Personen in Gruppen (einmal im Supabase SQL Editor ausführen, Projekt „Hase Project“)
-- Voraussetzung: umbau-zwei-personen.sql wurde schon ausgeführt.
-- WICHTIG: ausführen, BEVOR weitere Konten angelegt werden – die beiden bisherigen Konten
-- (Lucas und patong) werden hier zu einer gemeinsamen Gruppe zusammengefasst.
-- Das Skript darf mehrfach laufen.
--
-- Danach gilt:
--   profile.gruppe – wer zusammengehört. Lucas + patong = eine Gruppe, jedes neue Konto = eigene Gruppe.
--                    Nur hier im SQL Editor änderbar (die App kann die Gruppe nicht ändern).
--   hases          – Sortenliste je Gruppe: jede Gruppe sieht und bearbeitet nur ihre eigenen Sorten
--   reviews        – nur zu Sorten der eigenen Gruppe; jeder ändert nur seine
--   rauchtage      – unverändert: alle sehen alle (Vergleich), jeder ändert nur seine
--   orte           – „für alle sichtbar“ (geteilt) sehen alle; private Orte sieht die eigene Gruppe
--                    (bei Lucas + patong also beide, bei allen anderen nur die Person selbst)
--
-- Neues Konto in eine bestehende Gruppe aufnehmen (nur falls gewünscht), z. B.:
--   update public.profile set gruppe = (select gruppe from public.profile where name = 'Lucas')
--   where user_id = '<ID des neuen Kontos>';

begin;

-- ---------------------------------------------------------------- Gruppen
alter table public.profile add column if not exists gruppe uuid;

-- die beiden bisherigen Konten → Gruppe des ersten Kontos (Lucas)
update public.profile
set gruppe = (select id from auth.users order by created_at limit 1)
where gruppe is null
  and user_id in (select id from auth.users order by created_at limit 2);

-- Gruppe einer Person (ohne Profil: eigene Gruppe = eigene ID)
create or replace function public.gruppe_von(u uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce((select p.gruppe from public.profile p where p.user_id = u), u)
$$;
create or replace function public.meine_gruppe() returns uuid
language sql stable security definer set search_path = public as $$
  select public.gruppe_von(auth.uid())
$$;
revoke all on function public.gruppe_von(uuid), public.meine_gruppe() from public, anon;
grant execute on function public.gruppe_von(uuid), public.meine_gruppe() to authenticated;

-- Aus der App heraus kann niemand seine Gruppe wählen oder wechseln
create or replace function public.profil_gruppe_schuetzen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;            -- SQL Editor / Verwaltung: alles erlaubt
  if tg_op = 'INSERT' then
    new.gruppe := coalesce((select gruppe from public.profile where user_id = new.user_id), new.user_id);
  else
    new.gruppe := old.gruppe;
  end if;
  return new;
end $$;
drop trigger if exists profil_gruppe on public.profile;
create trigger profil_gruppe before insert or update on public.profile
  for each row execute function public.profil_gruppe_schuetzen();

-- bestehende Profile ohne Gruppe (sollte es nicht geben) → eigene Gruppe
update public.profile set gruppe = user_id where gruppe is null;
alter table public.profile alter column gruppe set not null;

-- ---------------------------------------------------------------- Sorten je Gruppe
alter table public.hases add column if not exists gruppe uuid;
update public.hases set gruppe = (select id from auth.users order by created_at limit 1) where gruppe is null;
alter table public.hases alter column gruppe set not null;
alter table public.hases alter column gruppe set default public.meine_gruppe();
create index if not exists hases_gruppe_idx on public.hases (gruppe);

-- Neue Sorten landen immer in der eigenen Gruppe, Sorten wechseln nie die Gruppe
create or replace function public.hase_gruppe_setzen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then new.gruppe := public.meine_gruppe(); else new.gruppe := old.gruppe; end if;
  return new;
end $$;
drop trigger if exists hase_gruppe on public.hases;
create trigger hase_gruppe before insert or update on public.hases
  for each row execute function public.hase_gruppe_setzen();

alter table public.hases enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'hases' loop
    execute format('drop policy %I on public.hases', p.policyname);
  end loop;
end $$;
create policy "hases: eigene Gruppe" on public.hases for all to authenticated
  using (gruppe = public.meine_gruppe()) with check (gruppe = public.meine_gruppe());

-- ---------------------------------------------------------------- Reviews nur zu Sorten der eigenen Gruppe
drop policy if exists "reviews: alle lesen"           on public.reviews;
drop policy if exists "reviews: eigene Gruppe lesen"  on public.reviews;
drop policy if exists "reviews: eigene anlegen"       on public.reviews;
drop policy if exists "reviews: eigene ändern"        on public.reviews;
create policy "reviews: eigene Gruppe lesen" on public.reviews for select to authenticated
  using (exists (select 1 from public.hases h where h.id = hase_id and h.gruppe = public.meine_gruppe()));
create policy "reviews: eigene anlegen" on public.reviews for insert to authenticated
  with check (auth.uid() = user_id and exists (select 1 from public.hases h where h.id = hase_id and h.gruppe = public.meine_gruppe()));
create policy "reviews: eigene ändern" on public.reviews for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- Orte: für alle oder für die eigene Gruppe
drop policy if exists "orte: eigene und geteilte lesen" on public.orte;
drop policy if exists "orte: Gruppe und geteilte lesen" on public.orte;
create policy "orte: Gruppe und geteilte lesen" on public.orte for select to authenticated
  using (geteilt or auth.uid() = user_id or public.gruppe_von(user_id) = public.meine_gruppe());

commit;
