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
  issue_id uuid not null references public.issues(id) on delete cascade,
  name text not null,
  color text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (issue_id, name)
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  title text not null,
  match_key text not null,
  assignee text not null default '',
  character_count integer check (character_count is null or character_count >= 0),
  status_id uuid references public.editorial_statuses(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issue_id, match_key)
);

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  article_id uuid references public.articles(id) on delete set null,
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

create index if not exists editorial_statuses_issue_sort_idx on public.editorial_statuses(issue_id, sort_order);
create index if not exists articles_issue_status_sort_idx on public.articles(issue_id, status_id, sort_order);
create index if not exists articles_issue_match_key_idx on public.articles(issue_id, match_key);
create index if not exists pages_issue_position_idx on public.pages(issue_id, position);
create index if not exists pages_status_idx on public.pages(status_id);
create index if not exists pages_article_idx on public.pages(article_id);

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

drop trigger if exists set_articles_updated_at on public.articles;
create trigger set_articles_updated_at
before update on public.articles
for each row
execute function public.set_updated_at();

alter table public.issues enable row level security;
alter table public.editorial_statuses enable row level security;
alter table public.articles enable row level security;
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

drop policy if exists "shared editorial access" on public.articles;
create policy "shared editorial access"
on public.articles
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
      and tablename = 'articles'
  ) then
    alter publication supabase_realtime add table public.articles;
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
