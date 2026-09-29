-- Run in Supabase SQL Editor only AFTER storing the webhook in Vault and
-- applying migrations/20260929_discord_notifications.sql.
-- Replace the example URL with your actual Timoniere URL (no query string).
update timoniere_private.discord_settings
set enabled = true,
    app_url = 'https://IL-TUO-TIMONIERE.vercel.app',
    next_send_at = now()
where id;
