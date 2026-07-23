---
name: supabase-dfcms
description: >-
  Supabase workflow for the DFCMS repo — dual projects (staging/production),
  migrations, RLS, Auth, Edge Functions (Stripe, domains, cron), secrets, and
  CLI deploy. Use when touching supabase/, Edge Functions, billing_profiles,
  pages table, db push, functions deploy, supabase link, RLS policies, Auth
  URLs, or any backend task in this project. Complements the generic Supabase
  skill with DFCMS-specific project refs and safety rules.
---

# Supabase — DFCMS

## Before any change

1. Read **`docs/MASTER_CONTEXT.md`** (§1.2 środowiska, §3 migracje/deploy, §3.4 Stripe).
2. Confirm **linked project** before `db push` / `functions deploy`:

```bash
npm run supabase:linked
# or: cat supabase/.temp/project-ref
```

| Environment | `project-ref` | npm link |
|-------------|---------------|----------|
| **Staging** | `asxrsdsprrbvjvgcsckh` | `npm run supabase:link:staging` |
| **Production** | `tawywecinkubmouyprab` | `npm run supabase:link:production` |

**`git push` does not deploy Supabase** — only Cloudflare Pages. DB/Edge need explicit CLI deploy.

## Hard rules (this repo)

- **No `supabase start`** — local dev uses `npm run dev` + live Staging API (`js/core/config.js`).
- **Never push migrations to production** without merge to `main` and staging verification.
- **Never use Live Stripe keys** on Staging / localhost.
- **No SQL triggers with `http_request`** in migrations — use Dashboard Database Webhooks → `telegram-webhook`.
- **`billing_profiles`** is billing SoT; mirror `pages.billing_plan` via webhooks/sync, not ad-hoc JSON alone.
- **Service role** only in Edge Functions / server — never in static `js/` front.

## Deploy shortcuts

```bash
npm run deploy:db:staging && npm run deploy:functions:staging
# after merge to main:
npm run deploy:db:production && npm run deploy:functions:production
```

Deploy **one function**: `supabase functions deploy stripe-webhook` (after correct `link`).

## Migration workflow

```bash
npm run supabase:link:staging
supabase db pull                    # capture schema diff → supabase/migrations/
# edit or: supabase migration new descriptive_name
git push origin staging             # test front on staging.dfcms.pl
# merge main → link production → db push
```

Baseline: `supabase/migrations/20260603072317_remote_schema.sql`.

For generic Supabase security (RLS, JWT, storage policies), follow the built-in **supabase** skill checklist.

## Edge Functions (Deno)

| Function | Role |
|----------|------|
| `create-checkout` | Stripe Checkout + Turnstile |
| `create-portal-session` | Customer Portal (plan change / cancel deep links) |
| `stripe-webhook` | Subscriptions, invoices, wFirma ledger |
| `sync-stripe-subscription` | Manual sync from panel |
| `add-custom-domain` | Cloudflare Custom Hostname + DB |
| `expire-trial-pages` | Cron — trial expiry |
| `telegram-webhook` | Ops alerts (DB webhooks + cron) |
| `get-google-reviews` | Places API proxy |
| `generate-ai-content` | AI Site Generator (Gemini → draft_content) |
| `retry-wfirma-invoice` | Invoice retry |

Shared code: `supabase/functions/_shared/` (`stripeBilling.ts`, `turnstileVerification.ts`, …).

Secrets via Dashboard or `supabase secrets set` **per project** (Test Stripe on staging, Live on prod).

## Auth (local dev)

Staging Auth → URL Configuration must include `http://localhost:3000/admin.html`. Do not open panel via `file://`.

## Verification after changes

- Run/advise smoke: Checkout on Staging (card `4242…`), webhook delivery in Stripe Dashboard.
- After schema change: `supabase migration list` and test panel load (`billingProfileReady`).
- Update **`docs/MASTER_CONTEXT.md`** §4 when production behavior or deploy steps change.

## References

- Edge details & secrets checklist: [references/edge-functions.md](references/edge-functions.md)
- Key tables & RLS patterns: [references/schema-dfcms.md](references/schema-dfcms.md)
