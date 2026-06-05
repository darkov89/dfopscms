# DFOPS CMS (dfopscms)

Lekki CMS pod strony wizytówkowe: statyczny front (HTML + JavaScript), treść w **Supabase**, hosting na **Cloudflare Pages**, płatności **Stripe**.

## Dokumentacja

| Plik | Po co |
|------|--------|
| [`PROJECT_STATE.md`](PROJECT_STATE.md) | Decyzje produktowe, Stripe, security, user journey |
| [`WORKFLOW.md`](WORKFLOW.md) | Lokalny dev, migracje, deploy, Stripe Test vs Live |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Diagram i indeks komponentów |
| [`docs/LIVING_CONTEXT.md`](docs/LIVING_CONTEXT.md) | Changelog jednoliniowy |

## Szybki start

```bash
npm install
npm run dev
```

Front: **http://localhost:3000** (`serve`). Nie otwieraj `admin.html` z `file://` — Auth i Edge wymagają HTTP(S).

**Supabase w dev:** bez Dockera; `js/core/config.js` kieruje localhost na projekt **Staging** (`asxrsdsprrbvjvgcsckh`). Szczegóły env: [`WORKFLOW.md`](WORKFLOW.md).

## Struktura (skrót)

| Ścieżka | Znaczenie |
|--------|-----------|
| `admin.html`, `router.html`, `index.html`, `*.html` | Wejścia aplikacji i szablony (korzeń — ścieżki Cloudflare) |
| `js/core/`, `js/features/` | Logika klienta (`config.js`, `pageRepository.js`, `adminApp.js`, …) |
| `data/seeds/demo_pages.json` | Treść demo (`demo-beauty`, `demo-fitness`, `demo-services`) |
| `functions/_middleware.js` | Middleware **Cloudflare Pages** |
| `supabase/functions/` | **Supabase Edge Functions** (Deno) |
| `supabase/migrations/` | Migracje DB (baseline: `20260603072317_remote_schema.sql`) |
| `docs/roadmap/` | Backlog i roadmapy post-MVP |
| `scripts/` | Generatory (PDF architektury, migracja demo) |

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

Pełna checklista: [`WORKFLOW.md`](WORKFLOW.md).

## Demo katalogowe

- Źródło JSON: [`data/seeds/demo_pages.json`](data/seeds/demo_pages.json).
- Na **localhost** bez wiersza w `pages` — `pageRepository` ładuje seed z tego pliku.
- Na **Staging/Production** — rekordy w bazie (w baseline `remote_schema` lub nowa migracja z generatora):

  ```bash
  node scripts/generate-demo-pages-migration.mjs
  npm run deploy:db:staging   # po review
  ```

## Licencja

Określ w `LICENSE` lub tutaj.
