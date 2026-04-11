# Timoniere

Web app per creare, modificare e condividere timoni editoriali di riviste.

La persistenza dei dati e la sincronizzazione multiutente sono gestite da Supabase:

- Postgres salva numeri, pagine, stati e warning.
- Supabase Realtime aggiorna i client collegati allo stesso numero.
- Le variabili pubbliche `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` collegano il frontend al progetto online.

## Funzionalita incluse

- Creazione di nuovi numeri editoriali.
- Creazione di pagine singole o doppie.
- Drag and drop delle pagine interne con rinumerazione automatica.
- Copertina e quarta fisse, fuori dal flusso drag and drop.
- Prima e ultima pagina interna visualizzate come pagine sole.
- Dati per pagina: articolo, assegnatario, battute, status, warning e nota warning.
- Status editoriali modificabili dall'interfaccia.
- Link condivisibile al numero aperto.

## Setup locale

1. Installa le dipendenze:

```bash
npm install
```

2. Crea un progetto su [Supabase](https://supabase.com).

3. In Supabase apri **SQL Editor**, crea una nuova query, incolla il contenuto di `supabase/schema.sql` ed eseguila.

4. Copia `.env.example` in `.env.local`:

```bash
cp .env.example .env.local
```

5. In Supabase vai in **Project Settings > API** e inserisci in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

6. Avvia la web app:

```bash
npm run dev
```

Di default sara disponibile su `http://localhost:3000`.

## Aggiornare un database gia creato

Se hai gia lanciato la prima versione dello schema, apri **Supabase > SQL Editor** ed esegui anche:

```text
supabase/migrations/20260411_cover_quartino.sql
```

Questa migration trasforma la vecchia gestione copertina/quarta in un quartino completo:

- III
- IV
- I
- II

I nuovi numeri creati dopo questa modifica nascono gia con le quattro pagine di copertina.

## Hosting online con Vercel

1. Crea un repository GitHub con questi file.

2. Vai su [Vercel](https://vercel.com), scegli **Add New Project** e importa il repository.

3. In **Project Settings > Environment Variables** aggiungi:

```bash
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

4. Fai il deploy. Vercel rileva Next.js automaticamente.

5. Apri l'URL pubblico generato da Vercel. Da quel momento chi ha il link puo vedere e modificare gli stessi dati.

## Nota sui permessi

Lo schema incluso abilita policy pubbliche di lettura e scrittura per partire subito con un timone condiviso da redazione.

Per un uso di produzione conviene aggiungere autenticazione Supabase e policy piu strette, per esempio:

- solo utenti autenticati possono leggere e scrivere;
- ogni redazione vede solo i propri numeri;
- alcuni utenti possono modificare gli stati, altri solo le pagine.

La struttura del database e del frontend e gia compatibile con questo passo successivo.
