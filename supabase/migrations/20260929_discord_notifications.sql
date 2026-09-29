-- Run after the articles/kanban migration. No credentials belong in this file.
begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

create schema if not exists timoniere_private;
revoke all on schema timoniere_private from public, anon, authenticated;

create table if not exists timoniere_private.discord_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  app_url text,
  next_send_at timestamptz not null default now()
);
insert into timoniere_private.discord_settings (id) values (true) on conflict do nothing;

create table if not exists timoniere_private.discord_notifications (
  id bigint generated always as identity primary key,
  page_id uuid not null,
  issue_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  request_id bigint,
  requested_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text
);
create index if not exists discord_notifications_pending_idx
  on timoniere_private.discord_notifications (id)
  where delivered_at is null and failed_at is null;
alter table timoniere_private.discord_settings enable row level security;
alter table timoniere_private.discord_notifications enable row level security;
revoke all on all tables in schema timoniere_private from public, anon, authenticated;
revoke all on all sequences in schema timoniere_private from public, anon, authenticated;

create or replace function timoniere_private.queue_page_status_notification()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  settings timoniere_private.discord_settings%rowtype;
  issue_title text;
  previous_status text;
  current_status text;
  page_label text;
  notification jsonb;
  embed jsonb;
begin
  select * into settings from timoniere_private.discord_settings where id;
  if not coalesce(settings.enabled, false) then return new; end if;

  select title into issue_title from public.issues where id = new.issue_id;
  -- Deleting an entire issue must not produce removal notifications.
  if issue_title is null then return new; end if;
  select name into previous_status from public.editorial_statuses where id = old.status_id;
  select name into current_status from public.editorial_statuses where id = new.status_id;
  previous_status := coalesce(previous_status, old.status_id::text, 'Nessuno status');
  current_status := coalesce(current_status, new.status_id::text, 'Nessuno status');

  page_label := case new.kind
    when 'cover_1' then 'I' when 'cover_front' then 'I'
    when 'cover_2' then 'II' when 'cover_3' then 'III'
    when 'cover_4' then 'IV' when 'cover_back' then 'IV'
    else null end;
  if page_label is null then
    select numbered.label::text into page_label from (
      select id, row_number() over (order by position, created_at, id) as label
      from public.pages where issue_id = new.issue_id and kind = 'content'
    ) numbered where numbered.id = new.id;
  end if;

  embed := jsonb_build_object(
    'title', 'Status pagina aggiornato',
    'color', 5025616,
    'timestamp', clock_timestamp(),
    'fields', jsonb_build_array(
      jsonb_build_object('name', 'Numero', 'value', left(issue_title, 1024)),
      jsonb_build_object('name', 'Pagina', 'value', coalesce(page_label, '?'), 'inline', true),
      jsonb_build_object('name', 'Articolo', 'value', left(coalesce(nullif(btrim(new.title), ''), 'Senza titolo'), 1024)),
      jsonb_build_object('name', 'Prima', 'value', left(previous_status, 1024), 'inline', true),
      jsonb_build_object('name', 'Ora', 'value', left(current_status, 1024), 'inline', true),
      jsonb_build_object('name', 'Assegnato a', 'value', left(coalesce(nullif(btrim(new.assignee), ''), 'Non assegnato'), 1024))
    )
  );
  -- Six bounded fields keep the total embed below Discord's 6000 character limit.
  if settings.app_url ~ '^https?://[^?#]+$' then
    embed := embed || jsonb_build_object('url', rtrim(settings.app_url, '/') || '/?issue=' || new.issue_id::text);
  end if;
  notification := jsonb_build_object('username', 'Timoniere',
    'allowed_mentions', jsonb_build_object('parse', jsonb_build_array()),
    'embeds', jsonb_build_array(embed));
  insert into timoniere_private.discord_notifications (page_id, issue_id, payload)
    values (new.id, new.issue_id, notification);
  return new;
end;
$$;

drop trigger if exists queue_discord_page_status on public.pages;
create trigger queue_discord_page_status after update on public.pages
for each row when (old.status_id is distinct from new.status_id)
execute function timoniere_private.queue_page_status_notification();

create or replace function timoniere_private.deliver_discord_notifications()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  settings timoniere_private.discord_settings%rowtype;
  event timoniere_private.discord_notifications%rowtype;
  response record;
  webhook_url text;
  new_request_id bigint;
  retry_seconds double precision;
begin
  -- Serialize cron and manual invocations, including across transactions.
  select * into settings from timoniere_private.discord_settings where id for update;
  if not coalesce(settings.enabled, false) then return; end if;

  select * into event from timoniere_private.discord_notifications
    where delivered_at is null and failed_at is null order by id limit 1 for update;
  if not found then return; end if;

  if event.request_id is not null then
    select * into response from net._http_response where id = event.request_id;
    if not found then
      if event.requested_at > now() - interval '2 minutes' then return; end if;
      update timoniere_private.discord_notifications set request_id = null,
        last_error = 'Risposta HTTP mancante o scaduta', next_attempt_at = now() + interval '30 seconds'
        where id = event.id;
    elsif response.status_code between 200 and 299 then
      update timoniere_private.discord_notifications set delivered_at = now(), last_error = null
        where id = event.id;
    else
      retry_seconds := least(3600, 10 * power(2, event.attempts));
      if response.status_code = 429 then
        begin
          retry_seconds := greatest(retry_seconds, (response.content::jsonb ->> 'retry_after')::double precision);
        exception when others then null;
        end;
        update timoniere_private.discord_settings
          set next_send_at = now() + make_interval(secs => retry_seconds) where id;
      end if;
      update timoniere_private.discord_notifications set request_id = null,
        next_attempt_at = now() + make_interval(secs => retry_seconds),
        failed_at = case when (response.status_code between 400 and 499 and response.status_code <> 429)
          or event.attempts >= 8 then now() else null end,
        -- Do not persist raw HTTP error text, which can contain the secret URL.
        last_error = case when response.status_code is null then 'Errore di rete o timeout'
          else 'Discord HTTP ' || response.status_code::text end
        where id = event.id;
    end if;
    -- Recover a lost response only a bounded number of times as well.
    update timoniere_private.discord_notifications set failed_at = now()
      where id = event.id and delivered_at is null and request_id is null and attempts >= 8;
    return;
  end if;

  if event.next_attempt_at > now() or settings.next_send_at > now() then return; end if;
  select decrypted_secret into webhook_url from vault.decrypted_secrets
    where name = 'timoniere_discord_webhook';
  if webhook_url is null then
    update timoniere_private.discord_notifications set last_error = 'Webhook non configurato' where id = event.id;
    return;
  end if;
  if webhook_url !~ '^https://discord[.]com/api(/v[0-9]+)?/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
    update timoniere_private.discord_notifications set last_error = 'URL webhook Discord non valido' where id = event.id;
    return;
  end if;
  new_request_id := net.http_post(url := webhook_url, params := '{"wait": true}'::jsonb,
    body := event.payload, headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000);
  update timoniere_private.discord_notifications set request_id = new_request_id,
    requested_at = now(), attempts = attempts + 1, last_error = null where id = event.id;
  update timoniere_private.discord_settings set next_send_at = now() + interval '5 seconds' where id;
end;
$$;

revoke all on all functions in schema timoniere_private from public, anon, authenticated;
select cron.schedule('timoniere-discord-notifications', '5 seconds',
  'select timoniere_private.deliver_discord_notifications()');
-- Keep delivered payloads for 30 days; retain pending and failed events for diagnosis.
select cron.schedule('timoniere-discord-cleanup', '0 3 * * *',
  $job$delete from timoniere_private.discord_notifications where delivered_at < now() - interval '30 days';
  delete from cron.job_run_details where jobid in (
    select jobid from cron.job where jobname in ('timoniere-discord-notifications', 'timoniere-discord-cleanup')
  ) and end_time < now() - interval '7 days';$job$);

commit;
