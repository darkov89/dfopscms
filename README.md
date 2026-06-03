# DFOPS CMS (dfopscms)

**Stan projektu i kontekst trwały (architektura, onboarding, Stripe, security, user journey):** zobacz [`PROJECT_STATE.md`](PROJECT_STATE.md) — aktualizować **na koniec sesji** przy istotnych zmianach. Skrót i changelog: [`docs/LIVING_CONTEXT.md`](docs/LIVING_CONTEXT.md). **Architektura i workflow zespołu:** [`ARCHITECTURE.md`](ARCHITECTURE.md), [`WORKFLOW.md`](WORKFLOW.md). Reguła Cursor: `.cursor/rules/living-context.mdc`.

Lekki CMS pod strony wizytówkowe: statyczny front (HTML + JavaScript), treść i ustawienia w **Supabase** (PostgreSQL, Auth, Storage), publikacja pod własną domeną z obsługą **Cloudflare** (Pages + Custom Hostnames).

## Stos technologiczny

- **Front:** HTML, JavaScript (moduły w `js/`), Alpine.js w panelu (`admin.html`), Tailwind (CDN) tam, gdzie używany.
- **Backend:** Supabase — uwierzytelnianie, tabela `pages`, publiczny storage obrazów.
- **Edge Functions (Supabase, Deno):** m.in. `add-custom-domain` (Cloudflare for SaaS), `get-google-reviews`.
- **Hosting:** Cloudflare Pages z `functions/_middleware.js` (SEO, routing pod custom domain, wstrzykiwanie treści z API).

## Struktura katalogów (skrót)

| Ścieżka | Znaczenie |
|--------|-----------|
| `admin.html` | Panel administratora (logowanie, edycja treści, domena, szablony) |
| `index.html`, `consultant.html`, `beauty.html`, … | Szablony / strony publiczne |
| `js/core/config.js` | **Konfiguracja klienta:** `supabaseUrl`, `supabaseAnonKey`, domeny systemowe, presety |
| `js/core/supabaseClient.js` | Singleton klienta Supabase |
| `js/core/pageRepository.js` | Odczyt i zapis stron użytkownika (REST) |
| `js/features/adminApp.js` | Logika panelu admina |
| `js/features/routerApp.js` | Routing pod wieloma domenami (host → strona) |
| `supabase/functions/` | Kod Edge Functions (deploy przez Supabase CLI) |
| `functions/_middleware.js` | Middleware Cloudflare Pages |

## Konfiguracja frontu

1. Edytuj `js/core/config.js` — routing **Staging vs Production** po hoście (bez Dockera).
2. **Staging** (`localhost`, `staging.dfcms.pl`, `*.pages.dev`): projekt `asxrsdsprrbvjvgcsckh` — klucze jak w `.env.development`.
3. **Production** (`dfcms.pl`, subdomeny, domeny klientów): projekt `tawywecinkubmouyprab` — klucze jak w `.env.production`.
4. Dopasuj `appDomain`, `systemDomains` i `localHosts` do infrastruktury DNS / hostingu. Szczegóły: [`WORKFLOW.md`](WORKFLOW.md).

> Klucz anonimowy (publishable) jest przeznaczony do użycia w przeglądarce — i tak jest widoczny w bundle; nadal nie commituj **service role** ani sekretów serwerowych do repozytorium.

## Supabase Edge Functions

Wdrożenie (lokalnie, z zainstalowanym [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase functions deploy add-custom-domain
supabase functions deploy get-google-reviews
```

### Zmienne środowiskowe funkcji (Secrets)

W projekcie Supabase ustaw m.in.:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — zwykle ustawiane automatycznie w środowisku Edge.
- **`add-custom-domain`:** `CF_ZONE_ID`, `CF_API_TOKEN` (token z uprawnieniami do Custom Hostnames w strefie Cloudflare).

## Cloudflare Pages (`functions/`)

W projekcie Pages ustaw zmienne środowiskowe:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Szczegóły w nagłówku `functions/_middleware.js`.

## Supabase — migracje i strony demo (`demo-beauty`, `demo-fitness`, `demo-services`)

1. Treść JSON: [`docs/demo_seeds.json`](docs/demo_seeds.json).
2. Migracje:
   - `supabase/migrations/20260503135500_pages_slug_unique.sql` — unikalny `slug` (wymagane do `ON CONFLICT`).
   - `supabase/migrations/20260503140000_seed_demo_catalog_pages.sql` — UPSERT trzech rekordów w `public.pages` (`user_id` = NULL, subskrypcja w treści: `tier2` + `payment_completed`, żeby cron trial nie blokował dem).
3. Regeneracja SQL z JSON (po edycji seedów):

   ```bash
   node scripts/generate-demo-pages-migration.mjs 20260503140000
   ```

4. Wdrożenie na projekt (Supabase CLI zalogowany, `supabase link`):

   ```bash
   supabase db push
   ```

   Edge Functions **nie** wymagają deployu wyłącznie przez te seede. Jeśli zmieniasz kod w `supabase/functions/`, wtedy: `supabase functions deploy <nazwa>`.

## Rozwój lokalny

```bash
npm install
npm run dev
```

Front to pliki statyczne serwowane na `http://localhost:3000`. Szczegóły: migracje bez Dockera, Staging vs Production, Stripe Test — [`WORKFLOW.md`](WORKFLOW.md).

**Nie otwieraj `admin.html` z `file://`** — wywołania do Supabase i Edge Functions wymagają originu `http://` lub `https://`.

Pliki `.env*` są wyłącznie lokalnie (CLI) — patrz `.gitignore`; klucze przeglądarki w `js/core/config.js`.

## Własna domena (skrót przepływu)

1. W panelu (**Szablon i kolory**) użytkownik wpisuje hostname i używa **„Podepnij domenę”** — po potwierdzeniu wykonywany jest zapis treści (`saveData`), potem wywołanie `add-custom-domain`, które tworzy Custom Hostname w Cloudflare i aktualizuje rekord w `pages`.
2. Instrukcje DNS (rekordy CNAME) są pokazywane w panelu po sukcesie; propagacja DNS bywa od kilku minut do 24 h.

## Licencja

Określ licencję repozytorium tutaj lub w osobnym pliku `LICENSE`.
