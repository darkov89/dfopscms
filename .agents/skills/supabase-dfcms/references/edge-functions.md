# DFCMS — Edge Functions reference

## Invoke from panel

Panel calls functions via `supabase.functions.invoke(name, { body, headers: { Authorization: Bearer … } })`.

JWT required unless function has `verify_jwt = false` in `config.toml` (e.g. `stripe-webhook`, `telegram-webhook`).

## Stripe webhook URL

| Env | URL |
|-----|-----|
| Staging | `https://asxrsdsprrbvjvgcsckh.supabase.co/functions/v1/stripe-webhook` |
| Production | `https://tawywecinkubmouyprab.supabase.co/functions/v1/stripe-webhook` |

Configure **separate** webhook endpoints in Stripe Test vs Live dashboards.

## Typical secrets (names vary — check Dashboard)

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_STARTER_YEARLY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_YEARLY`
- `WFIRMA_*` (invoice ledger)
- `CF_ZONE_ID`, `CF_API_TOKEN` (add-custom-domain)
- `TURNSTILE_SECRET_KEY`, `PUBLIC_TURNSTILE_SITE_KEY`
- `CRON_SECRET` (expire-trial-pages)
- `TELEGRAM_*` (telegram-webhook)
- `GEMINI_API_KEY` (generate-ai-content; wymagany)
- `GEMINI_MODEL` (opcjonalnie; domyślnie `gemini-3.6-flash`)
- `DFCMS_ENV` (`staging` | `production` — pełne logi promptów AI tylko poza prod, chyba że `AI_LOG_PROMPTS=1`)
- `AI_LOG_PROMPTS` (opcjonalnie `1` — loguj prompt/response AI także na prod)

## Cron

### Trial expiry (wymagane)

1. Dashboard → **Database → Extensions** → włącz **pg_cron** (i **pg_net** jeśli Telegram).
2. `npm run deploy:db:staging` / `deploy:db:production` — migracja `20260704223000` rejestruje job `dfcms-expire-trial-pages` (03:00 UTC) i robi backfill `trial_blocked_at`.
3. Sprawdź: `SELECT * FROM cron.job WHERE jobname = 'dfcms-expire-trial-pages';`

### Telegram (opcjonalnie)

Edge `expire-trial-pages` — alerty kasacji. Po ustawieniu Vault (`dfcms_project_url`, `dfcms_cron_secret`) uruchom `scripts/cron-expire-trial-edge.sql` w SQL Editor (job `dfcms-expire-trial-edge`, 03:15 UTC).

Ręczny test Edge: `POST …/functions/v1/expire-trial-pages` + `Authorization: Bearer CRON_SECRET`.

## Database Webhooks

Dashboard → Database Webhooks → POST to `…/functions/v1/telegram-webhook`. Do not replicate with SQL `http_request` triggers in migrations.

## Deploy checklist

1. `npm run supabase:linked` → correct env
2. `supabase functions deploy [name]`
3. `supabase secrets set` if new env vars
4. Test invoke + Stripe webhook replay (staging first)
