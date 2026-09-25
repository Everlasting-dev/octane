-- Octane admin-only Cloud Logs setup.
-- Run this once in the Supabase SQL editor for the Octane project.

create extension if not exists pgcrypto;

create or replace function public.octane_cloud_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%akramfariz%';
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'octane-logs',
  'octane-logs',
  false,
  104857600,
  array['application/gzip', 'application/octet-stream', 'text/plain', 'text/csv']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.cloud_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  custom_name text not null,
  comment text not null default '',
  original_filename text not null,
  storage_path text not null unique,
  storage_encoding text not null default 'gzip',
  file_size bigint not null default 0,
  compressed_size bigint not null default 0,
  duration double precision not null default 0,
  sample_count integer not null default 0,
  channel_count integer not null default 0,
  channel_names text[] not null default '{}',
  sha256_hash text not null unique,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cloud_logs_uploaded_at_idx on public.cloud_logs (uploaded_at desc);
create index if not exists cloud_logs_hash_idx on public.cloud_logs (sha256_hash);
create index if not exists cloud_logs_user_idx on public.cloud_logs (user_id);

alter table public.cloud_logs enable row level security;

drop policy if exists "Octane admin can read cloud logs" on public.cloud_logs;
drop policy if exists "Octane admin can add cloud logs" on public.cloud_logs;
drop policy if exists "Octane admin can edit cloud logs" on public.cloud_logs;
drop policy if exists "Octane admin can delete cloud logs" on public.cloud_logs;

create policy "Octane admin can read cloud logs"
on public.cloud_logs
for select
using (public.octane_cloud_admin());

create policy "Octane admin can add cloud logs"
on public.cloud_logs
for insert
with check (public.octane_cloud_admin() and user_id = auth.uid());

create policy "Octane admin can edit cloud logs"
on public.cloud_logs
for update
using (public.octane_cloud_admin())
with check (public.octane_cloud_admin());

create policy "Octane admin can delete cloud logs"
on public.cloud_logs
for delete
using (public.octane_cloud_admin());

drop policy if exists "Octane admin can read cloud log objects" on storage.objects;
drop policy if exists "Octane admin can add cloud log objects" on storage.objects;
drop policy if exists "Octane admin can update cloud log objects" on storage.objects;
drop policy if exists "Octane admin can delete cloud log objects" on storage.objects;

create policy "Octane admin can read cloud log objects"
on storage.objects
for select
using (bucket_id = 'octane-logs' and public.octane_cloud_admin());

create policy "Octane admin can add cloud log objects"
on storage.objects
for insert
with check (bucket_id = 'octane-logs' and public.octane_cloud_admin());

create policy "Octane admin can update cloud log objects"
on storage.objects
for update
using (bucket_id = 'octane-logs' and public.octane_cloud_admin())
with check (bucket_id = 'octane-logs' and public.octane_cloud_admin());

create policy "Octane admin can delete cloud log objects"
on storage.objects
for delete
using (bucket_id = 'octane-logs' and public.octane_cloud_admin());
