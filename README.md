# DFOPS CMS (dfopscms)

Lekki CMS pod strony wizytówkowe: statyczny front (HTML + JavaScript), treść w **Supabase**, hosting na **Cloudflare Pages**, płatności **Stripe**.

## Dokumentacja

| Plik | Po co |
|------|--------|
| [`docs/MASTER_CONTEXT.md`](docs/MASTER_CONTEXT.md) | Stan techniczny: architektura, środowiska, Edge, migracje, Stripe, changelog |
| [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md) | Plany post-MVP: architektura V2, UX, backlog ticketów |

**Supabase w dev:** bez Dockera; `js/core/config.js` kieruje localhost na projekt **Staging** (`asxrsdsprrbvjvgcsckh`). Szczegóły: [`docs/MASTER_CONTEXT.md`](docs/MASTER_CONTEXT.md) §3.

## Szybki start

```bash
npm install
npm run dev
```

Front: **http://localhost:3000** (`serve`). Nie otwieraj `admin.html` z `file://` — Auth i Edge wymagają HTTP(S).

## Struktura (skrót)

| Ścieżka | Znaczenie |
|--------|-----------|
| `admin.html` (root) | **Generowany** panel CMS — `npm run build:admin` ze źródeł `admin/partials/` |
| `admin/partials/` | Źródła HTML panelu (36 plików); edytuj tutaj, nie w korzeniu |
| `js/features/admin/` | Źródła logiki panelu (mixiny); `npm run build:admin-js` → `adminApp.js` |
| `js/core/`, `js/features/` | Logika klienta (`config.js`, `pageRepository.js`, `adminApp.js`, …) |
| `data/seeds/demo_pages.json` | 6 demo katalogowych (`demo-beauty` … `demo-consultant`) — fallback na **localhost** gdy brak wiersza w Staging DB; SoT w migracji `20260616150000_*` |
| `functions/_middleware.js` | Middleware **Cloudflare Pages** |
| `supabase/functions/` | **Supabase Edge Functions** (Deno) |
| `supabase/migrations/` | Migracje DB (baseline: `20260603072317_remote_schema.sql`) |
| `docs/MASTER_CONTEXT.md`, `docs/PRODUCT_ROADMAP.md` | Kontekst techniczny i roadmap post-MVP |
| `index.html`, `router.html`, … (root) | Pozostałe wejścia statyczne (Cloudflare Pages) |
| `scripts/` | Generatory: demo seeds, **`build:admin`**, **`build:admin-js`**, `build:panel` |

## Panel CMS — edycja i build przed pushem

Cloudflare Pages serwuje **wygenerowane** pliki z gita (bez kroku build na CI). Przy zmianach panelu:

| Edytujesz | Build | Commituj |
|-----------|-------|----------|
| `admin/partials/*.html` | `npm run build:admin` | partials + `admin.html` |
| `js/features/admin/**` | `npm run build:admin-js` | źródła + `js/features/adminApp.js` |
| oba | `npm run build:panel` | wszystko powyżej |

**Nie edytuj ręcznie** `admin.html` ani `adminApp.js` w korzeniu — mają baner `GENERATED`.

## Konfiguracja

1. **Przeglądarka:** `js/core/config.js` — URL Supabase, klucz anon, routing Staging/Production po hoście.
2. **Lokalnie (dokumentacja zespołu):** skopiuj [`.env.example`](.env.example) → `.env.development` / `.env.production` (gitignored).
3. **Cloudflare Pages:** `SUPABASE_URL`, `SUPABASE_ANON_KEY` per środowisko.
4. **Edge Secrets:** Stripe, wFirma, Cloudflare — `supabase secrets set` (nigdy w repo).

## Deploy

| Warstwa | Komenda / akcja |
|---------|------------------|
| Front Staging | `git push origin staging` |
| Front Production | `git push origin main` |
| DB + Edge Staging | `npm run deploy:db:staging` · `npm run deploy:functions:staging` |
| DB + Edge Production | `npm run deploy:db:production` · `npm run deploy:functions:production` |

Pełna checklista: [`docs/MASTER_CONTEXT.md`](docs/MASTER_CONTEXT.md) §3.5.

## Demo katalogowe

- **Źródło prawdy (DB):** migracja [`supabase/migrations/20260616150000_seed_demo_catalog_pages.sql`](supabase/migrations/20260616150000_seed_demo_catalog_pages.sql).
- **Localhost bez wiersza w Supabase:** [`data/seeds/demo_pages.json`](data/seeds/demo_pages.json) — `pageRepository.loadDemoSeedAsPageRow()` (tylko `demo-beauty`, `demo-fitness`, `demo-services`, `demo-gastro`, `demo-care`, `demo-consultant`).
- **Regeneracja JSON z migracji:** `node scripts/extract-demo-seeds-from-migration.mjs`
- **Regeneracja migracji z JSON:** `node scripts/generate-demo-pages-migration.mjs`
- Na **Staging/Production** demo działają z tabeli `pages` (nie z pliku JSON).

## Licencja

Określ w `LICENSE` lub tutaj.
