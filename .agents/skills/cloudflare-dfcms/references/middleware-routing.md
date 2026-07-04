# DFCMS — middleware routing

File: `functions/_middleware.js`

## Host resolution

Collects candidates from (in order of relevance):

- `Host`, `X-Forwarded-Host`, `X-Original-Host`, `Forwarded`, Cloudflare `cf.hostMetadata`, `url.hostname`
- Prefers **tenant hostname** (e.g. `slug.staging.dfopscms.pages.dev`) over internal worker host

Uses `js/core/platformRouting.js`:

- `DFOPS_PLATFORM_TENANT_BASE_DOMAINS`
- `DFOPS_isTenantPublicHostname`
- `DFOPS_normalizeHostname`

## Edge-routed paths

Includes `/`, `/index.html`, `/router.html`, `/polityka-prywatnosci` — middleware may rewrite to template HTML + inject tenant content from Supabase.

Static assets (css, js, images, …) bypass full rewrite via extension check.

## Supabase in middleware

Server-side fetch with env `SUPABASE_URL` + `SUPABASE_ANON_KEY` to load `pages` row for SEO injection and routing decisions. Must match the environment (staging vs prod) configured in CF Pages.

## Debug

Set `SEO_DEBUG=1` in CF Pages env to enable diagnostic meta tag and `X-DFCMS-Debug` response header.
