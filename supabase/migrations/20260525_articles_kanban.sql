create extension if not exists pgcrypto;

alter table public.editorial_statuses
add column if not exists issue_id uuid references public.issues(id) on delete cascade;

alter table public.editorial_statuses
drop constraint if exists editorial_statuses_name_key;

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

alter table public.pages
add column if not exists article_id uuid references public.articles(id) on delete set null;

create index if not exists editorial_statuses_issue_sort_idx on public.editorial_statuses(issue_id, sort_order);
create unique index if not exists editorial_statuses_issue_name_uidx on public.editorial_statuses(issue_id, name);
create index if not exists articles_issue_status_sort_idx on public.articles(issue_id, status_id, sort_order);
create index if not exists articles_issue_match_key_idx on public.articles(issue_id, match_key);
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

drop trigger if exists set_articles_updated_at on public.articles;
create trigger set_articles_updated_at
before update on public.articles
for each row
execute function public.set_updated_at();

with legacy_statuses as (
  select id, name, color, sort_order, created_at
  from public.editorial_statuses
  where issue_id is null
)
insert into public.editorial_statuses (issue_id, name, color, sort_order, created_at)
select issues.id, legacy_statuses.name, legacy_statuses.color, legacy_statuses.sort_order, legacy_statuses.created_at
from public.issues
cross join legacy_statuses
on conflict (issue_id, name) do update
set color = excluded.color,
    sort_order = excluded.sort_order;

with content_page_seed as (
  select distinct on (pages.issue_id, lower(trim(pages.title)))
    pages.issue_id,
    trim(pages.title) as title,
    lower(trim(pages.title)) as match_key,
    trim(pages.assignee) as assignee,
    pages.character_count,
    pages.position,
    legacy_status.name as legacy_status_name
  from public.pages
  left join public.editorial_statuses legacy_status
    on legacy_status.id = pages.status_id
  where pages.kind = 'content'
    and nullif(trim(pages.title), '') is not null
  order by pages.issue_id, lower(trim(pages.title)), pages.position
)
insert into public.articles (issue_id, title, match_key, assignee, character_count, status_id, sort_order)
select
  content_page_seed.issue_id,
  content_page_seed.title,
  content_page_seed.match_key,
  coalesce(content_page_seed.assignee, ''),
  content_page_seed.character_count,
  issue_status.id,
  content_page_seed.position
from content_page_seed
left join public.editorial_statuses issue_status
  on issue_status.issue_id = content_page_seed.issue_id
 and issue_status.name = content_page_seed.legacy_status_name
on conflict (issue_id, match_key) do update
set title = excluded.title,
    assignee = excluded.assignee,
    character_count = excluded.character_count,
    status_id = coalesce(excluded.status_id, public.articles.status_id),
    sort_order = least(public.articles.sort_order, excluded.sort_order);

update public.pages as pages
set status_id = issue_status.id
from public.editorial_statuses legacy_status
join public.editorial_statuses issue_status
  on issue_status.name = legacy_status.name
where pages.status_id = legacy_status.id
  and pages.issue_id = issue_status.issue_id
  and legacy_status.issue_id is null;

update public.pages as pages
set article_id = articles.id,
    title = articles.title,
    assignee = articles.assignee,
    character_count = articles.character_count,
    status_id = articles.status_id
from public.articles
where pages.kind = 'content'
  and articles.issue_id = pages.issue_id
  and articles.match_key = lower(trim(pages.title))
  and nullif(trim(pages.title), '') is not null;

delete from public.editorial_statuses
where issue_id is null;

alter table public.editorial_statuses
alter column issue_id set not null;

alter table public.articles enable row level security;

drop policy if exists "shared editorial access" on public.articles;
create policy "shared editorial access"
on public.articles
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
      and tablename = 'articles'
  ) then
    alter publication supabase_realtime add table public.articles;
  end if;
end;
$$;
