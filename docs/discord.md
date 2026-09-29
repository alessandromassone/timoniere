# Notifiche Discord di Timoniere

Ogni modifica effettiva di `pages.status_id` genera un messaggio nel canale Discord
scelto, con numero della rivista, pagina, titolo, assegnatario, vecchio e nuovo status
e link al timone. Vale per editor singolo, copertine, modifiche multiple, Kanban
quando aggiorna le pagine collegate, e scritture dirette al database.
Un articolo senza pagine collegate non genera notifiche di pagina.
Un articolo su tre pagine genera tre messaggi quando cambia lo status delle tre pagine.

Creazione di pagine, salvataggi con lo stesso status, modifiche a titolo/posizione/warning
e rinomina degli status non generano messaggi. Impostare o rimuovere uno status
su una pagina esistente genera un messaggio. Eliminare uno status può quindi
generare notifiche per le pagine che passano a «Nessuno status».

Il sistema risiede in Supabase: non richiede bot, Edge Functions o nuove variabili
Vercel. Il push GitHub da solo **non applica la migration al database**.

## 1. GitHub Desktop

Apri il repository locale `timoniere`. L'aggiornamento comprende la migration,
questa guida, il file di attivazione, i test e la relativa dipendenza di sviluppo.
Se il commit è già preparato, premi **Push origin** sul branch `main`.
Se hai ancora i file nella scheda Changes, seleziona soltanto quelli di questo update,
usa il riepilogo `Add Discord notifications for page status changes`, premi
**Commit to main**, poi **Push origin**. Escludi i file `.DS_Store`.

## 2. Crea il webhook Discord

1. Apri il server Discord della redazione e crea o scegli un **canale testuale**,
   per esempio `#timoniere`. Evita canali forum, media o vocali per questo setup.
2. Apri **Impostazioni del server → Integrazioni → Webhook → Nuovo webhook**.
   Serve il permesso **Gestisci webhook**.
3. Nome: `Timoniere`. Seleziona il canale corretto e salva.
4. Premi **Copia URL del webhook**. Il formato è
   `https://discord.com/api/webhooks/ID/TOKEN`.
5. Conserva l'URL per il prossimo passaggio: contiene una credenziale e va inserito
   in Supabase Vault, senza salvarlo nel repository o nelle variabili `NEXT_PUBLIC_*`.

## 3. Installa la migration in Supabase

1. Apri il progetto Supabase usato da Timoniere.
2. In **Database → Extensions**, abilita `pg_net` e `pg_cron`; verifica che Vault
   sia disponibile. La migration contiene anche `CREATE EXTENSION IF NOT EXISTS`.
3. Il job ogni 5 secondi richiede Postgres Supabase **15.1.1.61 o successivo**.
   Se l'istanza è più vecchia, aggiornala prima di eseguire la migration.
4. Apri **SQL Editor → New query**, con ruolo amministrativo `postgres`.
5. Incolla **tutto** il contenuto di
   `supabase/migrations/20260929_discord_notifications.sql` e premi **Run**.
   Il database deve già avere lo schema corrente con `pages`, `articles`, `issues`
   ed `editorial_statuses` (per un database storico, applica prima le migration precedenti).
6. Le notifiche nascono disattivate: puoi completare la configurazione senza
   notificare le modifiche fatte durante la preparazione.

## 4. Salva il webhook in Vault

Apri **Vault** nel dashboard Supabase (può comparire sotto **Integrations**).
Crea un secret:

- **Name:** `timoniere_discord_webhook` (esattamente questo nome).
- **Secret / Value:** l'URL copiato da Discord, senza spazi o parametri aggiuntivi.
- **Description:** `Webhook notifiche status pagine Timoniere`.

Salva. Se il secret esiste già, modifica quello esistente.
Vault conserva il valore cifrato; il worker lo legge sul database, senza esporlo al browser.

## 5. Attiva e verifica

1. Apri `supabase/discord-enable.sql`, sostituisci l'URL di esempio con l'indirizzo
   pubblico reale di Timoniere (senza `?issue=...`), incolla la query in SQL Editor
   ed eseguila. Non serve aggiungere il webhook a questo file.
2. Apri Timoniere, scegli una pagina di prova e cambia lo status, poi salva.
3. Il primo invio parte normalmente entro circa 5 secondi. La conferma nel registro
   viene acquisita in un giro successivo. Una coda di modifiche multiple impiega
   più tempo: il worker invia un messaggio alla volta, normalmente circa uno ogni 10 secondi.
4. Controlla il messaggio Discord e il link al numero corretto.
5. Salva di nuovo senza cambiare status: non deve arrivare un altro messaggio.
6. Prova anche un cambio nel Kanban su un articolo con pagine collegate.

I messaggi non menzionano automaticamente persone o `@everyone`. Per ricevere
avvisi sul telefono, ogni membro deve abilitare le notifiche del canale Discord
(per esempio «Tutti i messaggi») e quelle dell'app sul dispositivo.

## Diagnostica e gestione

Esegui nel SQL Editor con ruolo `postgres`:

```sql
select id, page_id, created_at, attempts, delivered_at, failed_at, last_error
from timoniere_private.discord_notifications
order by id desc limit 30;

select jobname, schedule, active
from cron.job
where jobname like 'timoniere-discord-%';
```

`delivered_at` valorizzato significa che Discord ha confermato l'invio (`wait=true`).
`Webhook non configurato` o `URL webhook Discord non valido`: correggi il secret.
`Discord HTTP 404` / `401` / `403`: verifica il webhook e i permessi; il messaggio
rimane nel registro dei falliti. `429`: il worker rispetta il tempo richiesto da
Discord prima di riprovare. Timeout, errori di rete e HTTP 5xx hanno backoff
con un massimo di otto tentativi; poi il messaggio rimane tra i falliti.

Dopo aver risolto un errore permanente, puoi rimettere **un singolo evento** in coda,
sostituendo `123` con il suo ID:

```sql
update timoniere_private.discord_notifications
set failed_at = null, attempts = 0, request_id = null,
    requested_at = null, next_attempt_at = now(), last_error = null
where id = 123 and delivered_at is null and failed_at is not null;
```

Per mettere in pausa:

```sql
update timoniere_private.discord_settings set enabled = false where id;
```

Durante la pausa non vengono creati nuovi eventi e la coda esistente resta ferma.
Un invio già partito può comunque arrivare. Per riprendere imposta `enabled = true`.
Il registro degli eventi consegnati viene eliminato dopo 30 giorni, quello dei falliti
rimane disponibile; la cronologia dei due job viene conservata per sette giorni.

La consegna usa tentativi ripetuti: in un timeout ambiguo Discord potrebbe aver
ricevuto il messaggio senza restituire una conferma. Un reinvio può quindi produrre
un duplicato. La coda conserva una fotografia dei dati al momento della modifica,
anche se la pagina viene rinominata o eliminata in seguito.

## Verifica tecnica locale

```bash
npm install
npm test
npm run lint
npm run build
```

I test eseguono schema, migration, trigger e worker in Postgres tramite PGlite,
con sostituti locali per Vault, cron e HTTP. Non inviano messaggi reali.
L'abilitazione delle estensioni native e il test di consegna effettiva richiedono
il progetto Supabase e il webhook Discord configurati.

Fonti: [Discord: creazione webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks),
[Discord: invio webhook](https://docs.discord.com/developers/resources/webhook),
[Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net),
[Supabase Vault](https://supabase.com/docs/guides/database/vault),
[Supabase Cron](https://supabase.com/docs/guides/cron/quickstart).
