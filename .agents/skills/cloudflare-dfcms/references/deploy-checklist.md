# DFCMS — front deploy checklist

## Before push (panel UI)

```bash
npm run build:admin    # if admin/partials/ changed
git add admin.html admin/partials/
```

Bump cache buster in `admin/partials/01-head.html` when `adminApp.js` logic changes (`?v=YYYYMMDD`).

## Staging release

- [ ] `git push origin staging`
- [ ] CF Pages build succeeded (no build command required — static)
- [ ] `npm run deploy:functions:staging` if Edge changed
- [ ] Smoke: login, public `{slug}.staging…`, checkout Test mode

## Production release

- [ ] Merge `staging` → `main`
- [ ] `git push origin main`
- [ ] `npm run deploy:db:production` (if migrations)
- [ ] `npm run deploy:functions:production` (if Edge changed)
- [ ] CF Pages Production env: Supabase prod URL + anon key
- [ ] Stripe Live webhook → prod `stripe-webhook` URL

## What Cloudflare does NOT build

- No PostCSS/Tailwind pipeline (CDN Tailwind in panel — known debt)
- No bundling of `adminApp.js` — served as static file
