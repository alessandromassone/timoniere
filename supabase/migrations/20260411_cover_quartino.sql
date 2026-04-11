alter table public.pages
drop constraint if exists pages_kind_check;

update public.pages
set kind = 'cover_1',
    title = case when title = '' or title = 'Copertina' then 'Prima di copertina' else title end,
    position = -2
where kind = 'cover_front';

update public.pages
set kind = 'cover_4',
    title = case when title = '' or title = 'Quarta' then 'Quarta di copertina' else title end,
    position = -3
where kind = 'cover_back';

alter table public.pages
add constraint pages_kind_check
check (kind in ('cover_3', 'cover_4', 'cover_1', 'cover_2', 'content'));

insert into public.pages (issue_id, position, kind, title, assignee, character_count, status_id)
select id, -4, 'cover_3', 'Terza di copertina', '', null, null
from public.issues
where not exists (
  select 1
  from public.pages
  where pages.issue_id = issues.id
    and pages.kind = 'cover_3'
);

insert into public.pages (issue_id, position, kind, title, assignee, character_count, status_id)
select id, -3, 'cover_4', 'Quarta di copertina', '', null, null
from public.issues
where not exists (
  select 1
  from public.pages
  where pages.issue_id = issues.id
    and pages.kind = 'cover_4'
);

insert into public.pages (issue_id, position, kind, title, assignee, character_count, status_id)
select id, -2, 'cover_1', 'Prima di copertina', '', null, null
from public.issues
where not exists (
  select 1
  from public.pages
  where pages.issue_id = issues.id
    and pages.kind = 'cover_1'
);

insert into public.pages (issue_id, position, kind, title, assignee, character_count, status_id)
select id, -1, 'cover_2', 'Seconda di copertina', '', null, null
from public.issues
where not exists (
  select 1
  from public.pages
  where pages.issue_id = issues.id
    and pages.kind = 'cover_2'
);
