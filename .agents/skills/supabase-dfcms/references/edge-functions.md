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

## Cron

`expire-trial-pages` — configure Supabase Cron / scheduled invoke with `CRON_SECRET`. See MASTER_CONTEXT TO-DO if not yet on prod.

## Database Webhooks

Dashboard → Database Webhooks → POST to `…/functions/v1/telegram-webhook`. Do not replicate with SQL `http_request` triggers in migrations.

## Deploy checklist

1. `npm run supabase:linked` → correct env
2. `supabase functions deploy [name]`
3. `supabase secrets set` if new env vars
4. Test invoke + Stripe webhook replay (staging first)
