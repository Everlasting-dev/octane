-- Octane: license window 15 -> 30 days.
--
-- Run this once in the Supabase SQL editor (project hgwmdowavadfbctlypin) if
-- supabase/licenses.sql is already deployed. It only replaces the claim and
-- renew functions; tables, the owner email and existing records are untouched.
-- New accounts get 30 days from their first ever sign-in; renew adds 30 days.

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
  values (uid, u_email, start_at, start_at + interval '30 days')
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
     set expires_at = greatest(expires_at, now()) + interval '30 days',
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

-- Optional: give accounts that are still on their first, unrenewed 15-day
-- window the full 30 days. Remove the leading "--" to run it.
-- update public.octane_licenses
--    set expires_at = first_login_at + interval '30 days'
--  where renew_count = 0
--    and expires_at = first_login_at + interval '15 days';
