-- Octane licensing, owner lock-down and template storage.
-- Paste the whole file into the Supabase SQL editor of the Octane project
-- (hgwmdowavadfbctlypin) and press Run. It is safe to run again.
--
-- Rules it enforces (server side, clients cannot change them):
--   * An account's license starts at its FIRST EVER Octane login and lasts 15 days.
--     Logging out, reinstalling or deleting app data never restarts it.
--   * Only the owner can renew (+15 days each time) and see every account.
--   * Every PC an account signs in on is recorded (no limit).
--   * Owner rights match ONE exact email (no more "contains akramfariz").

-- ============================================================================
-- >>> 1. SET THE OWNER EMAIL (the exact address you sign in to Octane with) <<<
-- ============================================================================
create table if not exists public.octane_settings (
  key text primary key,
  value text not null
);
alter table public.octane_settings enable row level security; -- no policies: clients can't read or write it

insert into public.octane_settings (key, value)
values ('owner_email', 'OWNER_EMAIL_HERE')            -- <<< replace OWNER_EMAIL_HERE
on conflict (key) do update set value = excluded.value;

-- ============================================================================
-- 2. Owner check (used by licenses, cloud logs and template storage)
-- ============================================================================
create or replace function public.octane_owner()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.octane_settings s on s.key = 'owner_email'
    where u.id = auth.uid()
      and lower(u.email) = lower(trim(s.value))
  );
$$;

-- Cloud Logs used a substring match on the email; route it through the exact owner check.
create or replace function public.octane_cloud_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.octane_owner();
$$;

-- ============================================================================
-- 3. Licenses + machines
-- ============================================================================
create table if not exists public.octane_licenses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  first_login_at timestamptz not null,
  expires_at timestamptz not null,
  renewed_at timestamptz,
  renewed_by text,
  renew_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.octane_license_machines (
  user_id uuid not null references auth.users (id) on delete cascade,
  machine_id text not null,
  machine_name text,
  app_version text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, machine_id)
);

alter table public.octane_licenses enable row level security;
alter table public.octane_license_machines enable row level security;

-- Read-only for clients (own row, or everything for the owner). No insert/update/delete
-- policies: rows are only written by the security-definer functions below.
drop policy if exists "octane license read" on public.octane_licenses;
create policy "octane license read" on public.octane_licenses
  for select to authenticated
  using (user_id = auth.uid() or public.octane_owner());

drop policy if exists "octane machines read" on public.octane_license_machines;
create policy "octane machines read" on public.octane_license_machines
  for select to authenticated
  using (user_id = auth.uid() or public.octane_owner());

-- Called by the app after every sign-in / refresh. Creates the license on the first
-- ever call (15 days from the earliest known login) and records this PC.
-- p_local_first_login can only move the start EARLIER (never past "now"), so a client
-- can shorten its own window but never extend it.
create or replace function public.octane_license_claim(
  p_machine_id text default null,
  p_machine_name text default null,
  p_local_first_login timestamptz default null,
  p_app_version text default null
)
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  u_email text;
  u_created timestamptz;
  start_at timestamptz;
  lic public.octane_licenses;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select email, created_at into u_email, u_created from auth.users where id = uid;

  start_at := greatest(u_created, least(now(), coalesce(p_local_first_login, now())));
  insert into public.octane_licenses (user_id, email, first_login_at, expires_at)
  values (uid, u_email, start_at, start_at + interval '15 days')
  on conflict (user_id) do nothing;

  if p_machine_id is not null and length(p_machine_id) between 16 and 128 then
    insert into public.octane_license_machines (user_id, machine_id, machine_name, app_version)
    values (uid, p_machine_id, left(p_machine_name, 80), left(p_app_version, 32))
    on conflict (user_id, machine_id) do update
      set last_seen = now(),
          machine_name = excluded.machine_name,
          app_version = excluded.app_version;
  end if;

  select * into lic from public.octane_licenses where user_id = uid;
  return json_build_object(
    'email', lic.email,
    'first_login_at', lic.first_login_at,
    'expires_at', lic.expires_at,
    'renew_count', lic.renew_count,
    'is_owner', public.octane_owner(),
    'server_time', now()
  );
end;
$$;

-- Owner only: add exactly 15 days (from today, or from the expiry if it hasn't passed yet).
create or replace function public.octane_license_renew(p_user uuid)
returns json
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  lic public.octane_licenses;
begin
  if not public.octane_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  update public.octane_licenses
     set expires_at = greatest(expires_at, now()) + interval '15 days',
         renewed_at = now(),
         renewed_by = (select email from auth.users where id = auth.uid()),
         renew_count = renew_count + 1
   where user_id = p_user
  returning * into lic;
  if lic.user_id is null then
    raise exception 'no license for that account yet' using errcode = 'P0002';
  end if;
  return json_build_object('user_id', lic.user_id, 'expires_at', lic.expires_at, 'renew_count', lic.renew_count);
end;
$$;

-- Owner only: every account with its license and PCs.
create or replace function public.octane_license_list()
returns json
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.octane_owner() then
    raise exception 'owner only' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(row_to_json(t) order by t.expires_at)
    from (
      select l.user_id, l.email, l.first_login_at, l.expires_at, l.renewed_at, l.renew_count,
             coalesce((
               select json_agg(json_build_object(
                        'machine_id', m.machine_id, 'machine_name', m.machine_name,
                        'app_version', m.app_version, 'first_seen', m.first_seen, 'last_seen', m.last_seen)
                      order by m.last_seen desc)
               from public.octane_license_machines m where m.user_id = l.user_id
             ), '[]'::json) as machines
      from public.octane_licenses l
    ) t
  ), '[]'::json);
end;
$$;

revoke all on function public.octane_license_claim(text, text, timestamptz, text) from public, anon;
revoke all on function public.octane_license_renew(uuid) from public, anon;
revoke all on function public.octane_license_list() from public, anon;
grant execute on function public.octane_license_claim(text, text, timestamptz, text) to authenticated;
grant execute on function public.octane_license_renew(uuid) to authenticated;
grant execute on function public.octane_license_list() to authenticated;
grant execute on function public.octane_owner() to authenticated;

-- ============================================================================
-- 4. Template storage
--   octane-templates/pack.json             shared pack: any signed-in account reads, owner writes
--   octane-template-backups/<uid>/*.json   a PC's old templates: the account uploads, only the owner reads
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('octane-templates', 'octane-templates', false, 5242880, array['application/json', 'text/plain']),
  ('octane-template-backups', 'octane-template-backups', false, 5242880, array['application/json', 'text/plain'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "octane templates read" on storage.objects;
create policy "octane templates read" on storage.objects
  for select to authenticated
  using (bucket_id = 'octane-templates');

drop policy if exists "octane templates owner insert" on storage.objects;
create policy "octane templates owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'octane-templates' and public.octane_owner());

drop policy if exists "octane templates owner update" on storage.objects;
create policy "octane templates owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'octane-templates' and public.octane_owner())
  with check (bucket_id = 'octane-templates' and public.octane_owner());

drop policy if exists "octane templates owner delete" on storage.objects;
create policy "octane templates owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'octane-templates' and public.octane_owner());

drop policy if exists "octane backups insert own folder" on storage.objects;
create policy "octane backups insert own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'octane-template-backups' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "octane backups owner read" on storage.objects;
create policy "octane backups owner read" on storage.objects
  for select to authenticated
  using (bucket_id = 'octane-template-backups' and public.octane_owner());

drop policy if exists "octane backups owner delete" on storage.objects;
create policy "octane backups owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'octane-template-backups' and public.octane_owner());
