# DFCMS — MASTER CONTEXT

> **Źródło prawdy technicznego stanu aplikacji.** Aktualizuj **na koniec sesji**, gdy zmienia się zachowanie w produkcji, API, flow użytkownika lub architektura.  
> Plany post-MVP: [`docs/PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md). Szybki start repo: [`README.md`](../README.md).

**Ostatnia aktualizacja treści:** 2026-06-23 — God Mode / Master Admin Dashboard

---

## 1. Podział logiczny i środowiska

### 1.1 Warstwy systemu

| Warstwa | Odpowiedzialność | Technologie / artefakty |
|--------|------------------|-------------------------|
| **Frontend (public + panel)** | Landing, szablony branżowe, panel CMS, routing wielodomenowy | Statyczne HTML, `js/` (Alpine.js w panelu), `css/styles.css`, `js/core/config.js` |
| **Hosting frontu** | CDN, preview deployów, custom hostnames klientów (SaaS) | **Cloudflare Pages** (`functions/_middleware.js` — SEO, CSP, proxy treści) |
| **Backend / baza** | Auth, treść stron, rozliczenia, storage | **Supabase** — PostgreSQL (`pages`, `billing_profiles`), Auth (JWT), Storage, RLS |
| **Funkcje serverless** | Płatności, domeny, cron trial, opinie Google, alerty | **Supabase Edge Functions** (Deno) w `supabase/functions/` |
| **Płatności** | Checkout, Customer Portal, webhooks | **Stripe** (Test na Staging, Live na Production) |
| **DNS / domeny klientów** | Custom Hostnames w strefie Cloudflare | **Cloudflare for SaaS** — Edge `add-custom-domain` (`CF_ZONE_ID`, `CF_API_TOKEN`) |
| **Observability** | Błędy panelu, alerty operacyjne | **Sentry** (panel), **Telegram** (`telegram-webhook` + Database Webhooks; cron trial → `expire-trial-pages`) |

### 1.2 Środowiska (Staging / Production)

| Obszar | Staging | Production |
|--------|---------|------------|
| **Git** | gałąź `staging` | gałąź `main` |
| **Frontend** | `staging.dfcms.pl`, preview `*.pages.dev` | `dfcms.pl`, subdomeny `{slug}.dfcms.pl` |
| **Supabase (`project-ref`)** | **`asxrsdsprrbvjvgcsckh`** | **`tawywecinkubmouyprab`** |
| **Stripe** | **Test mode** — osobne Secrets `STRIPE_*` | **Live mode** — osobne ceny i webhook |
| **Domeny klientów** | testowe Custom Hostnames (token staging) | **Cloudflare for SaaS** — Edge `add-custom-domain` |
| **Workflow DB** | `supabase db pull` ze Stagingu → migracje w repo | `supabase db push` na Production po merge do `main` |
| **Lokalny dev** | **bez** `supabase start`; `npm run dev` + `config.js` → API **Staging** na localhost | — |

Przed `supabase link`, `db push` lub `functions deploy` **zawsze** sprawdź aktywny projekt: `supabase projects list` / `npm run supabase:linked` / `cat supabase/.temp/project-ref`.

Separacja **zakończona**: dwa niezależne projekty Supabase, osobne sekrety Edge, osobne webhooki Stripe, osobne zmienne Cloudflare Pages.

**Front (`js/core/config.js`):** bez bundlera — wybór projektu po **hostname**:

| Host | Supabase | `deployEnvironment` |
|------|----------|------------------------|
| `localhost`, `127.0.0.1` | Staging | `staging` |
| `staging.dfcms.pl` | Staging | `staging` |
| `*.pages.dev` (Cloudflare Preview) | Staging | `staging` |
| `dfcms.pl`, `www.dfcms.pl`, `{slug}.dfcms.pl`, domeny klientów | Production | `production` |
| `dfopscms.pages.dev` (apex preview prod) | **Production** (realne dane `?site=`) | `production` |

W konsoli: `window.DFOPS_DEPLOY_ENVIRONMENT` → `'staging'` | `'production'`.

### 1.3 Diagram architektury i kluczowe ścieżki

**Wykres architektoniczny (Mermaid):** [`docs/system-flow.mermaid`](system-flow.mermaid)

**Kluczowe ścieżki danych:**

1. **Rejestracja / edycja** — przeglądarka → Supabase Auth + PostgREST (`pages`, `draft_content` / `content`) z kluczem **anon** (RLS).
2. **Publikacja treści** — panel kopiuje `draft_content` → `content`; strony publiczne czytają wyłącznie `content` (preview: `dfcms_preview=1` + właściciel).
3. **Płatność** — panel → `create-checkout` → Stripe Checkout → `stripe-webhook` / `sync-stripe-subscription` → `billing_profiles` + lustrzane `pages.billing_plan`.
4. **Własna domena** — panel → `add-custom-domain` + `GET /api/verify-domain?domain=…` (Pages Function, DoH CNAME) → Cloudflare Custom Hostname → `pages.custom_domain`.
5. **Routing publiczny** — `functions/_middleware.js` + shim `/?site=slug` na subdomenach (worker często widzi `dfopscms.pages.dev`); `publicSiteApp.cleanTenantPublicUrl()` — czysty URL bez query.
6. **Alerty** — Sentry / Database Webhooks / cron → Telegram (**bez** triggerów SQL `http_request` w migracjach).

```
Użytkownik → Auth → pages.content + pages.billing_plan + billing_profiles
    → create-checkout → Stripe → stripe-webhook / sync-stripe-subscription
    → Panel: billingProfileView.js → planUtils (tier0/tier1)
    → add-custom-domain → Cloudflare → pages.custom_domain
```

### 1.4 Stan produktu (skrót techniczny)

| Warstwa | Kluczowe artefakty |
|--------|---------------------|
| **Front publiczny** | `index.html` (dark-mode SaaS landing spójny z admin/rejestracją: `#121212` + `#D4AF37`; hero 3 min, `#jak`, `#wyposazenie`, `#spokoj`, `#demo`, `#cennik`, SEO + `favicon.svg`), demo przez `router.html?site=demo-*` (beauty/services/care/gastro/fitness/consultant). Szablony branżowe HTML są w `/templates/` (`beauty`, `consultant`, `fitness`, `services`, `gastro`, `care`); media statyczne przenoszone z root trafiają do `/assets/images/`; boilerplate nowych szablonów: `/templates/_base_template.html`; klocki UI: `/templates/_components_library.html`. `setup.html` zostaje w root. `landingPricing.js` — plany cennika i dane landingowe. |
| **Panel CMS** | `admin.html`, `adminApp.js`. Draft vs published: `pages.draft_content` / `pages.content`. Subskrypcja: Starter/Standard/Custom, `billingInterval`, Stripe Checkout + Portal. Smart Booking: `settings.booking_mode` + `contact.booking_url`. God Mode: `godmode.html` → `admin.html?impersonate={slug}` dla superadminów. |
| **Backend** | `pages`, `billing_profiles`, `superadmins`, RLS. Schemat baseline: `20260603072317_remote_schema.sql`; God Mode: `20260623100512_add_god_mode.sql`. |
| **Płatności** | Starter `tier0`, Standard `tier1`, Custom poza Stripe. Secrets: `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_STARTER_YEARLY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_YEARLY`. wFirma: `WFIRMA_*`, ledger `wfirma_invoice_ledger`. |

**Model pakietów:**

| Oferta (UI) | Stripe / DB | Domena | Checkout |
|-------------|-------------|--------|----------|
| **Starter** | `tier0` | subdomena `.dfcms.pl` | tak (mies./rok) |
| **Standard** | `tier1` | własna domena | tak (mies./rok) |
| **Custom** | — | indywidualnie | nie — `zapytanie-custom.html` |

Ceny UI: Starter 29 zł/msc (278,40 zł/rok); Standard 49 zł/msc (470,40 zł/rok, −20% rocznie).

**Trial i retencja:**

- **Blokada publiczna (14 dni):** `publicSiteApp.shouldBlockPublicPageView()` — 14 dni od `trial_started_at` lub `billing_failed_at`; natychmiast przy `trial_blocked_at`.
- **Cron DB:** Edge `expire-trial-pages` → RPC `expire_trial_pages()` (logika 14 dni + `billing_profiles`; migracja `20260611120000`).
- **Ostrzeżenie −7 dni:** `pages.purge_warning_sent_at` + RPC `notify_purge_upcoming_pages()` (≥23 dni od blokady).
- **Kasacja (30 dni):** RPC `purge_trial_blocked_pages_after_grace()` — **domyślnie wyłączona** w Edge (`AUTO_PURGE_ENABLED` ≠ true); raport do ręcznej kasacji.
- **Powiadomienia cron:** **Telegram** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) — Markdown; **Resend usunięty** z `expire-trial-pages`. Secrets crona: `CRON_SECRET`. Harmonogram: Dashboard → Integrations → Cron → POST `expire-trial-pages`.

**Onboarding:** modal powitalny, Driver.js, kreator (wizard), `welcome_onboarding_completed` / `onboarding_completed` w `pages.content`.

**Prawo & Bezpieczeństwo:** panel `admin.html#legal` zarządza `pages.content.pl.privacy` (`mode: 'default' | 'custom'`, `customText`). Publiczny route `/polityka-prywatnosci` renderuje standardową politykę DFCMS albo własny dokument użytkownika przez DOMPurify i zawsze dokleja klauzulę infrastruktury DFCMS/Supabase/Cloudflare.

**Security (skrót):** forced password reset, DOMPurify, sanitizacja URL-like pól `pages.content` na zapisie i odczycie, Cloudflare Turnstile dla rejestracji/custom inquiry/checkout, CSP/HSTS/XFO/nosniff w `functions/_middleware.js`, publiczny odczyt `pages` zawężony query+RLS+grantami kolumnowymi, Stripe webhook tylko Edge, Google Places/Maps klucz tylko Edge, `billing_profiles` SoT rozliczeń, draft preview tylko dla właściciela. Superadmini są wyłącznie w `public.superadmins`; RLS dodaje im SELECT/UPDATE/DELETE na `pages` i `analytics_events`, bez zmiany polityk właścicielskich.

**Luki:** brak obowiązkowego E2E/CI dla Edge; wildcard `*.dfcms.pl` w Cloudflare Pages; RLS anon read wymaga GRANT + polityki; brak historii wersji treści.

**TO-DO operacyjne:** tour Driver.js mobile; smoke webhook Stripe; CI deploy Edge; skonfigurować Cron Supabase dla `expire-trial-pages`.

### 1.5 Onboarding i panel (szczegóły)

- **Modal powitalny** (`showWelcomeModal`): warunek — `welcome_onboarding_completed` w `content.pl.settings`.
- **Driver.js** (CDN 1.4.0): tour → kreator (krok 0) → podgląd → menu Treść/Konfiguracja/Subskrypcja.
- **Kreator:** szablony Beauty/Konsultant/Fitness; stan w `localStorage` (`dfops_wizard_state_v1:{slug}`); czyszczenie po `finishWizard` / `switchTemplate`.
- **Draft vs published:** auto-save debounce 1000ms → `draft_content`; `publishChanges()` → `content`; preview tylko właściciel (`dfcms_preview=1`); `revertChanges()` z `_publishedContentRaw`.
- **Subskrypcja panel:** `hasActivePaidSubscription` / `isSubscriptionCanceledButValid` — tylko Stripe (`billing_profiles`), nie samo `payment_completed` w JSON.
- **God Mode:** `godmode.html` wymaga sesji i widocznego własnego wpisu w `superadmins`; lista pobiera wszystkie `pages`. Przycisk „Zarządzaj” otwiera `admin.html?impersonate={slug}`. W impersonacji panel zapisuje konkretny rekord po `pages.id`, pomija profil billingowy superadmina i blokuje checkout z sesji operatora.

### 1.6 Security (szczegóły)

- **Forced password reset:** recovery → `isForcedPasswordReset` → izolatka bez `loadData()` do zmiany hasła.
- **Treść:** DOMPurify + `pageRepository.sanitizeContent`; mapy — tylko Google embed URL; GTM/Pixel — walidacja formatu ID; custom privacy policy renderowana przez `sanitizeHtml`.
- **Stripe:** webhook secret tylko Edge; `billing_profiles` zapis `service_role`.
- **Google Reviews Edge:** sesja wymagana; klucz `GOOGLE_MAPS_API_KEY` tylko serwer; panel autocomplete → `place_id`.
- **Smart Booking:** `settings.booking_mode` + `contact.booking_url`; Booksy embed — ostrzeżenie X-Frame-Options.
- **Nagłówki HTTP:** Cloudflare middleware dokleja CSP (Supabase/Stripe/Google Maps/CDN/Sentry/Calendly), `X-Content-Type-Options`, `X-Frame-Options: DENY`, HSTS dla HTTPS, Referrer/Permissions Policy.
- **Anti-abuse:** Turnstile widget w `rejestracja.html`, `zapytanie-custom.html` i panelu subskrypcji; `create-checkout` weryfikuje `turnstileToken` przez `_shared/turnstileVerification.ts` przed Supabase/Stripe. Secrets: `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- **Publiczny odczyt stron:** `pageRepository` i `functions/_middleware.js` pobierają wyłącznie konkretny `slug`/`custom_domain`, z `limit=1`, `content IS NOT NULL`, `trial_blocked_at IS NULL` i grace 14 dni dla `billing_failed_at`; edge `fetchPageRow` waliduje format slug/host i używa pojedynczej odpowiedzi PostgREST; migracja `20260617221000` usuwa szerokie `SELECT true` i grant `ALL` dla `anon` na `pages`.
- **God Mode RLS:** `superadmins` ma SELECT tylko własnego wiersza dla `authenticated`; wpisy dodaje/usuwa operacyjnie `service_role`. Polityki superadminów na `pages` i `analytics_events` są dodatkowymi OR-ścieżkami RLS, nie zastępują dostępu właściciela.
- **Widoczność sekcji:** toggles per zakładka (`showGallery`, `showGoogleReviews`, …); hero bez toggle.

### 1.7 User journey (skrót)

1. **`index.html`** → rejestracja / `#cennik` / demo `?site=demo-*`
2. **`rejestracja.html`** → `signUp` → trigger `handle_new_user` (slug w metadata; kolizja → rollback)
3. Potwierdzenie e-mail → baner w panelu bez pełnego onboardingu
4. **`admin.html`** → modal/Driver → edycja + kreator
5. **God Mode:** superadmin → `godmode.html` → `admin.html?impersonate={slug}` → edycja rekordu klienta po `pages.id`
6. Podgląd `/templates/{motyw}.html?site=&dfcms_preview=1`
7. Subskrypcja → Checkout/Portal → webhook → `billing_profiles`
8. Opcjonalnie domena → `add-custom-domain` + verify CNAME API
9. Recovery hasła → izolatka resetu

### 1.8 Stripe / webhook (szczegóły)

- **Zdarzenia:** `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- **SoT:** `billing_profiles`; okres sub — `Subscription.current_period_end`.
- **Checkout:** `plan`, `interval`, `STRIPE_AUTOMATIC_TAX` opcjonalnie; reuse `customer`.
- **Anulowanie natychmiastowe:** `canceled` → `trial_blocked_at`. **Koniec okresu:** `cancel_at_period_end` — plan płatny do `current_period_end`; public nie blokuje samą flagą.
- **wFirma:** po checkout + odnowieniu/upgrade; ledger idempotencji; B2C contractor add; B2B inline; zagranica NPUE/NP.

---

## 2. Edge Functions

| Funkcja | Rola |
|---------|------|
| `create-checkout` | Sesja Stripe Checkout (`plan`, `interval`); Stripe Tax opcjonalnie (`STRIPE_AUTOMATIC_TAX`); returning customer reuse `cus_…` |
| `create-portal-session` | Stripe Customer Portal; deep link `subscription_update` |
| `stripe-webhook` | Zdarzenia Stripe → `billing_profiles` + `pages`; wFirma faktury (`WFIRMA_*`) |
| `sync-stripe-subscription` | Ręczna synchronizacja statusu subskrypcji |
| `add-custom-domain` | Cloudflare Custom Hostname + zapis w DB |
| `get-google-reviews` | Places / opinie (klucz tylko na Edge); wymaga sesji użytkownika |
| **`expire-trial-pages`** | **Cron** (`POST` + `Bearer CRON_SECRET`): `expire_trial_pages()` → `notify_purge_upcoming_pages()` → `list_pages_pending_purge()` → opcjonalnie `purge_trial_blocked_pages_after_grace()` gdy `AUTO_PURGE_ENABLED=true`. **Powiadomienia operacyjne przez Telegram** (Markdown): alert −7 dni per slug; raport ręcznej kasacji (30+ dni) z gotowym SQL. Brak alertów → `200` bez wiadomości. |
| `telegram-webhook` | Router alertów (Sentry, Database Webhooks `users`/`pages`/`billing_profiles`, logi) → Telegram |

**Współdzielona logika:** `supabase/functions/_shared/stripeBilling.ts`, `wfirmaBilling.ts`, `wfirmaInvoiceLedger.ts`.

**Pages Functions (Cloudflare):** `functions/_middleware.js`, `functions/api/verify-domain.js` (CNAME → `proxy.dfcms.pl`, `dfcms.pl`, `dfopscms.pages.dev`).

---

## 3. Przepływy i cykl migracji

### 3.1 Lokalny development (bez Dockera)

```bash
npm install
npm run dev   # http://localhost:3000 — pakiet serve
```

- **Nie** używamy `supabase start` ani `127.0.0.1:54321`.
- localhost → **Supabase Staging** (`asxrsdsprrbvjvgcsckh`).
- W Supabase Staging → Auth → URL Configuration: `http://localhost:3000/admin.html`.
- Nie otwieraj `admin.html` z `file://`.
- Oficjalne demo (`demo-beauty`, `demo-fitness`, `demo-services`, `demo-gastro`, `demo-care`, `demo-consultant`) są utrzymywane przez bazową migrację demo w Supabase; lead-gen nie jest częścią głównego runtime.

### 3.2 Przełączanie projektu Supabase CLI

| Cel | `project-ref` | Skrót |
|-----|---------------|-------|
| **Staging** | `asxrsdsprrbvjvgcsckh` | `npm run supabase:link:staging` |
| **Production** | `tawywecinkubmouyprab` | `npm run supabase:link:production` |

```bash
npm run deploy:db:staging && npm run deploy:functions:staging && git push origin staging
# po merge:
npm run deploy:db:production && npm run deploy:functions:production && git push origin main
```

`git push` **nie** przełącza projektu Supabase — to tylko Cloudflare Pages.

### 3.3 Cykl migracji bazy

| Robimy | Nie robimy |
|--------|------------|
| `supabase link` do Staging przy codziennej pracy | `supabase start` (Docker) |
| `supabase db pull` — schemat ze Stagingu | Ręczne SQL na prod bez migracji |
| Nowe pliki w `supabase/migrations/` | Triggerów `http_request` w migracjach |
| `supabase db push` na Production po review | Push migracji na prod bez gałęzi `main` |

**Typowy cykl:**

```bash
supabase link --project-ref asxrsdsprrbvjvgcsckh
supabase db pull                    # → nowy plik migracji
# edycja / nowa migracja <timestamp>_opis.sql
git push origin staging             # test na staging.dfcms.pl
# merge → main
supabase link --project-ref tawywecinkubmouyprab
supabase db push
```

**Baseline:** `supabase/migrations/20260603072317_remote_schema.sql`. Oficjalny seed demo: `supabase/migrations/20260616150000_seed_demo_catalog_pages.sql`.

**Database Webhooks (Telegram):** Dashboard → Database Webhooks → `…/functions/v1/telegram-webhook`. **Nie** commituj triggerów SQL z `http_request`.

### 3.4 Stripe Test vs Live

1. **Zakaz** kluczy Live na Stagingu / localhost.
2. Testy Checkout wyłącznie Stripe **Test mode** na Stagingu.
3. Webhook testowy: `https://asxrsdsprrbvjvgcsckh.supabase.co/functions/v1/stripe-webhook`.
4. Production: osobne Live Secrets + webhook Live.

Karty testowe: `4242 4242 4242 4242` ([dokumentacja Stripe](https://docs.stripe.com/testing)).

### 3.5 Deploy

| Warstwa | Staging | Production |
|---------|---------|------------|
| **Front** | `git push origin staging` → Cloudflare | `git push origin main` |
| **DB + Edge** | `link staging` → `db push` / `functions deploy` | `link production` → `db push` / `functions deploy` |
| **Secrets** | `supabase secrets set` — Test Stripe, CF staging, Telegram, `CRON_SECRET` | Live Stripe, prod CF, Telegram, `CRON_SECRET` |

**Checklist prod:** migracje na Staging OK; Edge wdrożone; Secrets Live; Cloudflare Pages prod Supabase; Stripe webhook Live; Cron `expire-trial-pages`; Database Webhooks.

### 3.6 Gałęzie Git

| Gałąź | Cel |
|-------|-----|
| `staging` | Integracja, QA, Stripe Test, Supabase Staging |
| `main` | Produkcja |

Feature branch → PR do `staging` → po akceptacji merge do `main`.

### 3.7 Szybki indeks plików

| Temat | Plik |
|-------|------|
| Konfiguracja klienta / ceny fallback | `js/core/config.js` |
| Landing + cennik | `index.html#cennik`, `js/features/landingPricing.js` |
| Panel subskrypcja | `admin.html`, `adminApp.js` |
| God Mode / superadmin | `godmode.html`, `admin.html?impersonate={slug}`, `20260623100512_add_god_mode.sql` |
| Plany / watermark | `js/core/planUtils.js` |
| Profil Stripe | `billingProfileView.js`, `loadBillingProfile()` |
| Oficjalne demo | `supabase/migrations/20260616150000_seed_demo_catalog_pages.sql` |
| Szablony publiczne | `templates/{beauty,fitness,services,consultant,gastro,care}.html`, boilerplate `templates/_base_template.html` |
| Rejestracja | `rejestracja.html`, `registrationApp.js`, trigger `handle_new_user` |
| Edge Stripe | `create-checkout`, `stripe-webhook`, `sync-stripe-subscription`, `_shared/stripeBilling.ts` |

---

## 4. Dziennik transformacji

Chronologiczny changelog (najnowsze u góry). Jedna linia = jedna istotna zmiana.

| Data | Co |
|------|-----|
| **2026-06-23** | **God Mode / Master Admin:** migracja `20260623100512_add_god_mode.sql` dodaje `superadmins` i polityki RLS dla pełnego SELECT/UPDATE/DELETE na `pages` oraz `analytics_events`; `godmode.html` listuje wszystkie strony superadminom; `admin.html?impersonate={slug}` ładuje i zapisuje rekord klienta po `pages.id`, bez użycia billing profilu operatora. |
| **2026-06-23** | **Root cleanup assets:** utworzono `/assets/images/` jako miejsce na statyczne logotypy/obrazy przenoszone z root; audyt ścieżek nie wykazał aktywnych referencji do `dfops-dark.svg`, `dfops-light.svg` ani `dragonfly_ops_logo.svg`. |
| **2026-06-23** | **Frontend templates refactor:** branżowe HTML przeniesione z root do `/templates/`; Cloudflare middleware serwuje `/templates/{theme}.html` z zachowaniem starych tras `/{theme}.html`; panel preview i publiczne redirecty używają `/templates/`; dodano `_base_template.html` i `_components_library.html`. |
| **2026-06-23** | **Cleanup lead demo DB:** migracja `20260623083000_cleanup_lead_demo_pages.sql` usuwa z `public.pages` wygenerowane leadowe `demo-*`, zostawiając oficjalne `demo-beauty`, `demo-fitness`, `demo-services`, `demo-gastro`, `demo-care`, `demo-consultant`. |
| **2026-06-23** | **GTM pivot:** porzucono generowanie 40 osobnych wizytówek leadowych w głównym repo. Lead-gen przeniesiony do `_lead-generator-export`; CSV prowadzi do oficjalnych demo DFCMS per `theme`; główne `data/seeds` i leadowe migracje usunięte z runtime. |
| **2026-06-22** | **Demo lead catalog v2:** 40 top leadów z Apify/Google Places; każdy slug `demo-*`, `billing_plan=tier1`, Google `place_query`, mapa `map_embed_url`, fallbackowe opinie, social media z datasetu, placeholder hero `/img/Twoje%20zdjecie.jpg` i galeria `/img/galeria1.jpg`–`/img/galeria4.jpg`; barberzy używają beauty `black-gold`/`smoky`/`barber`. |
| **2026-06-22** | **GTM Polish demo:** `scripts/generate-leads-demos.mjs` sortuje top 40, generuje slugi `demo-*` do 60 znaków bez cięcia słów, mapuje drzew/ogród/wycinka do `services`, dodaje branżowe podtytuły i presety oraz `hero.title` po `cleanBusinessName()` przy zachowaniu pełnej nazwy w Google `place_query`. |
| **2026-06-22** | **Prawo & Bezpieczeństwo:** nowa odsłona zakładki `legal` w panelu; `pages.content.pl.privacy` (`default/custom`); publiczny route `/polityka-prywatnosci` z generowaną polityką, custom tekstem po DOMPurify i obowiązkową klauzulą DFCMS/Supabase/Cloudflare. |
| **2026-06-19** | **Security hardening:** `fetchPageRow` na Cloudflare edge waliduje slug/hostname i pobiera pojedynczy obiekt PostgREST; `pageRepository` sanitizuje `content`/`draft_content` na zapisie i odczycie, w tym pola URL używane w `href/src`, żeby blokować `javascript:`/`data:` i stare złośliwe rekordy. |
| **2026-06-19** | **Demo katalog:** landing pokazuje 6 template i prowadzi przez `router.html?site=demo-*`; demo katalogowe nie blokuje się przez trial (`is_demo_catalog`) + migracja ustawia `billing_plan=tier1` i czyści flagi blokady dla demo rekordów. |
| **2026-06-19** | **Landing dark-mode SaaS:** `index.html` przepisany na ekskluzywny ciemny landing produktowy: hero 3 minuty, proste 3 kroki, wyposażenie wizytówki, sekcja „Święty spokój”, kafelki demo i ciemny cennik glassmorphism. |
| **2026-06-19** | **Landing Concierge:** `index.html` przepisany na empatyczny, jasny przekaz do lokalnych firm; sekcja mitu AI, Tabela Szczerości, relacje z klientami, branże i lekki cennik z pomarańczowymi akcentami. |
| **2026-06-19** | **Checkout Turnstile:** widget nie jest stałym elementem Subskrypcji; po kliknięciu aktywacji planu otwiera się modal, Turnstile renderuje się jawnie i callback automatycznie uruchamia `executeStripeCheckout(token)`. |
| **2026-06-19** | **Panel admin mobile:** top bar układa się mobile-first, hamburger steruje `mobileMenuOpen`, zamknięty sidebar ma `pointer-events-none` i nie blokuje kliknięć w treść. |
| **2026-06-19** | **Panel admin / Checkout:** CSP dopuszcza `browser.sentry-cdn.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`; Turnstile w Subskrypcji renderowany jawnie po aktywacji widoku; `supabaseClient` utrzymuje jeden `GoTrueClient` z dynamicznym storage. |
| **2026-06-17** | **Turnstile:** widgety antyspamowe dla rejestracji, formularza Custom i checkoutu; `_shared/turnstileVerification.ts`; `create-checkout` → 403 przed Supabase/Stripe gdy token nieważny. |
| **2026-06-17** | **Security audit:** limitowane publiczne zapytania `pages`, dokładne `eq` zamiast `ilike`, RLS/granty kolumnowe dla anon, `.env.example` z podziałem PUBLIC/SECRET, `SECURITY.md`. |
| **2026-06-17** | **Security/DRY/tooling:** CSP + HSTS/XFO/nosniff w `functions/_middleware.js`; wspólny `js/core/utils.js` (`DFOPS_normalizeHostname`); `.prettierrc`, `.eslintrc.json`, `.vscode/settings.json`. |
| **2026-06-16** | **Demo katalog:** `demo-gastro`, `demo-care`, `demo-consultant` w `demo_pages.json` + migracja seed; landing — wszystkie nisze z linkiem „Zobacz demo”. |
| **2026-06-16** | **Gastro/Care:** nowe layouty publiczne, 5 palet branżowych, fix panelu kolorów. |
| **2026-06-16** | **Cron trial:** `expire-trial-pages` — powiadomienia **Telegram** (Markdown) zamiast Resend; alert −7 dni + raport ręcznej kasacji; `AUTO_PURGE_ENABLED` domyślnie off. |
| **2026-06-15** | **SQL trial:** migracja `20260611120000` — przywrócona `expire_trial_pages()` (14 dni + `billing_profiles`); `purge_warning_sent_at`, RPC ostrzeżenia i listy kasacji. |
| **2026-06-14** | **API weryfikacji domeny:** `functions/api/verify-domain.js` — DoH CNAME → `verified` / `pending`. |
| **2026-06-14** | **Routing publiczny:** subdomeny `*.dfcms.pl` → shim `/?site=slug` + `cleanTenantPublicUrl`; `dfopscms.pages.dev` → Production Supabase. |
| **2026-06-12** | **Edge routing:** `functions/_middleware.js` — szablon na `/`, `?site=`, `{slug}.dfcms.pl` bez hopu index→router→fitness. |
| **2026-06-11** | **Smart Booking v2:** zakładka Rezerwacje online; `settings.booking_mode` + `contact.booking_url`. |
| **2026-06-11** | **Sekcje per zakładka:** toggle Galerii (`showGallery`); mapa zakładek panelu. |
| **2026-06-10** | **CTA we wszystkich szablonach:** edycja/wyłączanie hero + stopki. |
| **2026-06-09** | **Panel Subskrypcja:** blok „Warunki rozliczeń” (Stripe Tax, wFirma/KSeF, grace 14 dni). |
| **2026-06-05** | **wFirma + Stripe Tax:** B2C/B2B, idempotencja ledger, faktury przy checkout/odnowieniu/upgrade. |
| **2026-06-05** | **Panel Subskrypcja B2C:** disclaimery cykliczności + zrzeczenie odstąpienia przy Checkout. |
| **2026-06-05** | **Porządek repo:** `data/seeds/demo_pages.json`; usunięte martwe pliki. |
| **2026-06-03** | **Infrastruktura:** separacja Staging/Production; `config.js` routing po hoście; baseline `remote_schema` bez `http_request`. |
| **2026-06-02** | **Telegram webhook:** router Sentry → Database Webhooks → Telegram. |
| **2026-06-02** | **Panel:** Sentry loader; Subskrypcja UI spójna; `confirmAsync` zamiast `confirm()`. |
| **2026-06-01** | **Draft vs Published:** `pages.draft_content`; live preview + auto-save; modal publikacji. |
| **2026-05-25** | **Portal Stripe:** deep links subscription_update / cancel; rejestracja slug rollback. |
| **2026-05-24** | **Fix blokady po płatności:** `expire_trial_pages` respektuje `billing_profiles`. |
| **2026-05-23** | **Refaktor rozliczeń:** cykle mies./rok, Starter/Standard/Custom, `billing_profiles`, landing `#cennik`. |
| **2026-05-22** | **Dual SoT billing:** `syncPageBillingMirrorFromProfile`; anti-zombie webhooks; Google Places autocomplete. |
| **2026-05-06** | **Analityka + RODO:** GTM/Pixel po zgodzie; `dfcms_preview=1`. |
| **2026-04-04** | **Trial / public:** `shouldBlockPublicPageView`; purge po 30 dniach `trial_blocked_at`. |
| **2026-04-04** | **Szablony:** fitness, `pages.theme`, kreator, presety neon. |
| **2026-04-03** | Trial blokada publiczna; Edge `expire-trial-pages`; onboarding Driver.js. |

---

## Utrzymanie tego pliku

1. Na koniec sesji zmieniającej produkcję: zaktualizuj sekcje **1–3** i wpis w **§4**.
2. Szczegóły implementacyjne zostaw w kodzie; tutaj **decyzje, stany, luki**.
3. Plany post-MVP → [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).
