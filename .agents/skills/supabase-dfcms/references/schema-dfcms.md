# DFCMS — schema & RLS (skrót)

## Core tables

| Table | Purpose |
|-------|---------|
| `pages` | Tenant site: `slug`, `theme`, `content`, `draft_content`, `custom_domain`, `billing_plan`, trial flags |
| `billing_profiles` | Stripe SoT: `stripe_customer_id`, `stripe_subscription_id`, `status`, plan tier |
| `superadmins` | God Mode operators — extra RLS on `pages` |
| `analytics_events` | Optional telemetry |
| `wfirma_invoice_ledger` | Invoice sync state |

## Content contract

- **`draft_content`** — panel autosave; **`content`** — published (public reads this).
- Preview: `dfcms_preview=1` + owner session only.
- Schema helpers: `js/core/contentSchema.js`, `contentUpgrader.js`.

## Billing UI

- Panel: `js/core/billingProfileView.js` + `planUtils.js` → `billingSubscriptionView`.
- Active paid = non-empty `stripe_subscription_id` + status `active`|`trialing` in `billing_profiles`.

## RLS mindset

- Anon read on `pages` is tightly scoped (published content, not drafts).
- Owner writes via `auth.uid()` matching page owner.
- Never authorize from `user_metadata` — use `app_metadata` or DB columns.

Full security notes: `docs/MASTER_CONTEXT.md` §1.5, §2.
