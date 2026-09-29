import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Execute the real Postgres schema, triggers and worker. Only Supabase's native
// extensions are replaced: HTTP is captured locally and never sent to Discord.
test('Discord notification database integration', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated;
    create schema vault; create schema net; create schema cron;
    create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
    create table net.requests (id bigint generated always as identity, url text, body jsonb, params jsonb);
    create table net._http_response (id bigint, status_code integer, content text);
    create function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)
      returns bigint language sql as $$
      insert into net.requests (url, body, params) values (url, body, params) returning id;
      $$;
    create table cron.job (jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text);
    create table cron.job_run_details (jobid bigint, end_time timestamptz);
    create function cron.schedule(jobname text, schedule text, command text) returns bigint language sql as $$
      insert into cron.job (jobname, schedule, command) values (jobname, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid;
      $$;
    create publication supabase_realtime;
  `);
  const withoutExtensions = (sql) => sql.replace(/^create extension[^;]+;/gm, '');
  await db.exec(withoutExtensions(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')));
  const migration = withoutExtensions(await readFile(new URL('../supabase/migrations/20260929_discord_notifications.sql', import.meta.url), 'utf8'));
  await db.exec(migration);
  await db.exec(migration);
  const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
  const count = () => scalar('select count(*)::int from timoniere_private.discord_notifications');
  const issue = await scalar("insert into public.issues(title, slug) values ('Iconografie 42', 'test') returning id");
  const statusA = await scalar(`insert into public.editorial_statuses(issue_id,name,color) values ('${issue}', 'da scrivere','#fff13d') returning id`);
  const statusB = await scalar(`insert into public.editorial_statuses(issue_id,name,color) values ('${issue}', 'scritto','#77d84d') returning id`);
  const page = await scalar(`insert into public.pages(issue_id, position, title, status_id) values ('${issue}',10,'Articolo di prova','${statusA}') returning id`);
  const worker = () => db.exec('select timoniere_private.deliver_discord_notifications()');
  const latest = async () => (await db.query('select * from timoniere_private.discord_notifications order by id desc limit 1')).rows[0];
  let secondEventId;

  await t.test('migration is repeatable and disabled by default', async () => {
    assert.equal(await scalar('select count(*)::int from cron.job'), 2);
    await db.exec(`update public.pages set status_id = '${statusB}' where id = '${page}'`);
    assert.equal(await count(), 0);
    await db.exec("update timoniere_private.discord_settings set enabled = true, app_url = 'https://timoniere.example'");
  });
  await t.test('unchanged status, edits and inserts do not notify', async () => {
    await db.exec(`update public.pages set title = 'Nuovo titolo', status_id = '${statusB}' where id = '${page}'`);
    await db.exec(`insert into public.pages(issue_id,position,status_id) values ('${issue}',20,'${statusA}')`);
    assert.equal(await count(), 0);
  });
  await t.test('real status change captures payload, page number and null status', async () => {
    await db.exec(`update public.pages set status_id = null where id = '${page}'`);
    const event = await latest();
    const embed = event.payload.embeds[0];
    assert.equal(embed.fields.find((f) => f.name === 'Pagina').value, '1');
    assert.equal(embed.fields.find((f) => f.name === 'Prima').value, 'scritto');
    assert.equal(embed.fields.find((f) => f.name === 'Ora').value, 'Nessuno status');
    assert.equal(embed.url, `https://timoniere.example/?issue=${issue}`);
    assert.deepEqual(event.payload.allowed_mentions, { parse: [] });
  });
  await t.test('rollback also rolls back notification', async () => {
    const before = await count();
    await db.exec(`begin; update public.pages set status_id = '${statusB}' where id = '${page}'; rollback;`);
    assert.equal(await count(), before);
  });
  await t.test('anonymous page writes work but private data and worker are inaccessible', async () => {
    await db.exec('grant usage on schema public to anon; grant select, update on public.pages to anon');
    await db.exec(`set role anon; update public.pages set status_id = '${statusA}' where id = '${page}'; reset role;`);
    assert.equal(await count(), 2);
    secondEventId = (await latest()).id;
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from timoniere_private.discord_settings'), /permission denied/);
    await assert.rejects(worker(), /permission denied/);
    await db.exec('reset role');
  });
  await t.test('missing or invalid webhook retains queue without attempting HTTP', async () => {
    await worker();
    assert.equal(await scalar('select count(*)::int from net.requests'), 0);
    await db.exec("insert into vault.decrypted_secrets values ('timoniere_discord_webhook','https://evil.example/webhook')");
    await worker();
    assert.equal(await scalar('select count(*)::int from net.requests'), 0);
    await db.exec("update vault.decrypted_secrets set decrypted_secret = 'https://discord.com/api/webhooks/123/fake-test-token'");
  });
  await t.test('wait=true, successful confirmation and no duplicate dispatch while in flight', async () => {
    await worker(); await worker();
    assert.equal(await scalar('select count(*)::int from net.requests'), 1);
    assert.deepEqual(await scalar('select params from net.requests limit 1'), { wait: true });
    await db.exec('insert into net._http_response values (1,200,\'{}\')');
    await worker();
    assert.ok(await scalar('select delivered_at from timoniere_private.discord_notifications where id=1'));
  });
  await t.test('rate limit respects retry_after and resumes after delay', async () => {
    await db.exec("update timoniere_private.discord_settings set next_send_at = now() - interval '1 second'");
    await worker();
    await db.exec('insert into net._http_response values (2,429,\'{"retry_after": 120}\')');
    await worker(); await worker();
    assert.equal(await scalar('select count(*)::int from net.requests'), 2);
    assert.equal(await scalar(`select last_error from timoniere_private.discord_notifications where id=${secondEventId}`), 'Discord HTTP 429');
    assert.ok(await scalar(`select next_attempt_at >= now() + interval '119 seconds' from timoniere_private.discord_notifications where id=${secondEventId}`));
    await db.exec(`update timoniere_private.discord_settings set next_send_at = now(); update timoniere_private.discord_notifications set next_attempt_at = now() where id=${secondEventId}`);
    await worker();
    assert.equal(await scalar('select count(*)::int from net.requests'), 3);
    await db.exec("insert into net._http_response values (3,200,'{}')");
    await worker();
  });
  await t.test('bulk updates create one event per changed page; unchanged repeat does not', async () => {
    const before = await count();
    await db.exec(`update public.pages set status_id = '${statusB}' where issue_id = '${issue}'`);
    assert.equal(await count(), before + 2);
    await db.exec(`update public.pages set status_id = '${statusB}' where issue_id = '${issue}'`);
    assert.equal(await count(), before + 2);
  });
  await t.test('permanent HTTP errors stop retrying and allow the next page through', async () => {
    await db.exec('update timoniere_private.discord_settings set next_send_at = now()');
    await worker();
    await db.exec("insert into net._http_response values (4,404,'{}')");
    await worker();
    assert.ok(await scalar('select failed_at from timoniere_private.discord_notifications where request_id is null and last_error = \'Discord HTTP 404\''));
    await db.exec('update timoniere_private.discord_settings set next_send_at = now()');
    await worker();
    assert.equal(await scalar('select count(*)::int from net.requests'), 5);
  });
  await t.test('network failure and lost response retry, with bounded attempts', async () => {
    await db.exec('insert into net._http_response values (5,null,null)');
    await worker();
    assert.equal((await latest()).last_error, 'Errore di rete o timeout');
    await db.exec('update timoniere_private.discord_notifications set next_attempt_at = now() where delivered_at is null and failed_at is null; update timoniere_private.discord_settings set next_send_at=now()');
    await worker();
    await db.exec("update timoniere_private.discord_notifications set requested_at = now() - interval '3 minutes', attempts = 8 where request_id=6");
    await worker();
    assert.ok((await latest()).failed_at);
  });
  await t.test('covers, oversized text, article synchronization and cleanup', async () => {
    const cover = await scalar(`insert into public.pages(issue_id, kind, title) values ('${issue}', 'cover_1', repeat('x',8000)) returning id`);
    await db.exec(`update public.pages set status_id='${statusB}' where id='${cover}'`);
    const embed = (await latest()).payload.embeds[0];
    assert.equal(embed.fields.find((f) => f.name==='Pagina').value, 'I');
    assert.equal(embed.fields.find((f) => f.name==='Articolo').value.length, 1024);
    const article = await scalar(`insert into public.articles(issue_id,title,match_key,status_id) values ('${issue}','Articolo','articolo','${statusB}') returning id`);
    await db.exec(`update public.pages set article_id='${article}' where kind='content'`);
    const before = await count();
    // These are the same two database writes performed by the Kanban UI.
    await db.exec(`update public.articles set status_id='${statusA}' where id='${article}'; update public.pages set status_id='${statusA}' where article_id='${article}'`);
    assert.equal(await count(), before+2);
    await db.exec("update timoniere_private.discord_notifications set delivered_at=now()-interval '31 days' where id=1");
    await db.exec(await scalar("select command from cron.job where jobname='timoniere-discord-cleanup'"));
    assert.equal(await scalar('select count(*)::int from timoniere_private.discord_notifications where id=1'),0);
  });
  await t.test('deleting an issue does not enqueue cascading status removals', async () => {
    const before = await count();
    await db.exec(`delete from public.issues where id='${issue}'`);
    assert.equal(await count(), before);
  });
});
