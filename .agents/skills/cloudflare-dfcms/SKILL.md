---
name: cloudflare-dfcms
description: >-
  Cloudflare Pages and Pages Functions for DFCMS — deploy via git, middleware
  routing, CSP, tenant hostnames, Custom Hostnames (SaaS), verify-domain API,
  and environment variables. Use when editing functions/_middleware.js,
  Cloudflare Pages deploy, preview URLs, custom domains, CSP/HSTS, edge routing
  for templates, or diagnosing staging.dfcms.pl / pages.dev / dfcms.pl behavior.
---

# Cloudflare — DFCMS

## Before any change

1. Read **`docs/CONTEXT.md`** (§1.2, §3.5 deploy, routing paths §1.3).
2. DFCMS front is **static** — no CF build step for JS bundling. Exception: **`admin.html` is generated** — run `npm run build:admin` after editing `admin/partials/`, then commit `admin.html`.

## Deploy model

| Branch | CF Pages env | Typical URL |
|--------|--------------|-------------|
| `staging` | Preview / staging project | `staging.dfcms.pl`, `*.pages.dev` |
| `main` | Production | `dfcms.pl`, `{slug}.dfcms.pl`, `dfopscms.pages.dev` |

```bash
git push origin staging   # → staging front
git push origin main      # → production front
```

**Push ≠ Supabase.** DB/Edge deploy separately (`npm run deploy:functions:*`).

## Pages Functions

| Path | File | Role |
|------|------|------|
| All HTML/assets | `functions/_middleware.js` | Tenant routing, SEO meta, CSP, Supabase fetch for public pages |
| `/api/verify-domain` | `functions/api/verify-domain.js` | CNAME check before Custom Hostname |

Middleware imports shared routing: `js/core/platformRouting.js`, `publishedThemes.js`.

### Environment variables (Cloudflare Pages dashboard)

Required for middleware public site proxy:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Set **per environment** (Preview vs Production) to match Staging vs Production Supabase — same split as `js/core/config.js`.

Optional: `SEO_DEBUG=1` — injects debug meta / `X-DFCMS-Debug` header.

## Routing rules (mental model)

- **`{slug}.dfcms.pl`** — tenant template without `?site=` (middleware resolves slug from host).
- **Apex `dfcms.pl?site=slug`** — preview/demo only; not primary tenant URL.
- **`*.pages.dev`** — Staging Supabase + staging routing patterns.
- **`localhost:3000`** — Staging Supabase; use `npm run dev`, not `file://`.
- Invalid / missing tenant → **404 HTML**, not marketing landing.

Public URL cleanup: `publicSiteApp.cleanTenantPublicUrl()`.

## Custom domains (client `.pl` / `.com`)

1. Panel „Zapisz i sprawdź” → Edge `add-custom-domain` (Custom Hostname **apex + www**, SSL `txt`; duplicate 1406 = OK) → `pages.custom_domain`.
2. DNS u klienta w **2 krokach** (`dnsInstructions.step`): (1) **TXT** `_cf-custom-hostname` + **CNAME** `www` → `proxy.dfcms.pl` — **bez A na @**; (2) po działającym www → **A** `@` → `172.67.154.121` + `104.21.66.9`. DNS w CF klienta → **DNS only**.
3. Status `active` **tylko** gdy CF apex+www mają `status` i `ssl.status` = `active`.
4. **SaaS Worker:** route **`*/*`** (nie `dfcms.pl/*`) + Fallback Origin; inaczej custom hostname → Error 522.
5. DoH `GET /api/verify-domain` — informacyjnie; nie ustawia zielonej OK.

Secrets for CF API live in **Supabase Edge** (`CF_ZONE_ID`, `CF_API_TOKEN`), not in static front.

## Security headers (middleware)

CSP allows Supabase, Stripe, Google Maps, GTM/GA4, Meta Pixel, Sentry, Calendly, CDN assets. Also sets HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, Referrer/Permissions Policy.

When adding a new third-party script domain, update CSP in `_middleware.js` and test on staging.

## Common pitfalls

| Symptom | Likely cause |
|---------|----------------|
| Panel OK, public 404 on subdomain | Middleware host detection / slug not in DB |
| Wrong Supabase on pages.dev | Preview env vars point to prod (or reverse) |
| Admin changes not visible | Forgot `npm run build:admin` before push |
| CSP console errors | New origin not whitelisted in middleware |

## Verification after changes

- Test: staging subdomain, `?site=` on apex, one custom domain flow, panel preview link.
- Update **`docs/CONTEXT.md`** §4 if routing or deploy behavior changes.

## References

- Middleware flow & host candidates: [references/middleware-routing.md](references/middleware-routing.md)
- Deploy checklist: [references/deploy-checklist.md](references/deploy-checklist.md)
