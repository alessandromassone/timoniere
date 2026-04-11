create extension if not exists pgcrypto;

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.editorial_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  position integer not null default 0,
  kind text not null default 'content' check (kind in ('cover_3', 'cover_4', 'cover_1', 'cover_2', 'content')),
  title text not null default '',
  assignee text not null default '',
  character_count integer check (character_count is null or character_count >= 0),
  status_id uuid references public.editorial_statuses(id) on delete set null,
  warning_enabled boolean not null default false,
  warning_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pages_issue_position_idx on public.pages(issue_id, position);
create index if not exists pages_status_idx on public.pages(status_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_issues_updated_at on public.issues;
create trigger set_issues_updated_at
before update on public.issues
for each row
execute function public.set_updated_at();

drop trigger if exists set_pages_updated_at on public.pages;
create trigger set_pages_updated_at
before update on public.pages
for each row
execute function public.set_updated_at();

insert into public.editorial_statuses (name, color, sort_order)
values
  ('da scrivere', '#fff13d', 10),
  ('scritto', '#77d84d', 20),
  ('revisione 1', '#f59b2f', 30),
  ('revisione 2', '#51d6d1', 40),
  ('impaginato', '#48a858', 50),
  ('editabile su InCopy', '#55aeb8', 60)
on conflict (name) do nothing;

alter table public.issues enable row level security;
alter table public.editorial_statuses enable row level security;
alter table public.pages enable row level security;

drop policy if exists "shared editorial access" on public.issues;
create policy "shared editorial access"
on public.issues
for all
using (true)
with check (true);

drop policy if exists "shared editorial access" on public.editorial_statuses;
create policy "shared editorial access"
on public.editorial_statuses
for all
using (true)
with check (true);

drop policy if exists "shared editorial access" on public.pages;
create policy "shared editorial access"
on public.pages
for all
using (true)
with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'issues'
  ) then
    alter publication supabase_realtime add table public.issues;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'editorial_statuses'
  ) then
    alter publication supabase_realtime add table public.editorial_statuses;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pages'
  ) then
    alter publication supabase_realtime add table public.pages;
  end if;
end;
$$;
