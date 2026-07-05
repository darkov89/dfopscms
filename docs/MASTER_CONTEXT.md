# DFCMS — MASTER CONTEXT

> **Źródło prawdy technicznego stanu aplikacji.** Aktualizuj **na koniec sesji**, gdy zmienia się zachowanie w produkcji, API, flow użytkownika lub architektura.  
> Plany post-MVP: [`docs/PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md). Szybki start repo: [`README.md`](../README.md).

**Ostatnia aktualizacja treści:** 2026-07-05 — Silnik Wzrostu G0–G3 wdrożony na Staging i Produkcję

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
5. **Routing publiczny** — `functions/_middleware.js` (slug z nagłówka `Host` / kandydatów); gdy edge widzi tylko `*.pages.dev` (brak wildcard `*.dfcms.pl` w Pages), **fallback w przeglądarce:** `index.html` → `router.html` → `/templates/{theme}.html` (slug z `window.location.hostname`); **`js/core/tenantPublicUrlClean.js`** (sync w `<head>` szablonu) + `publicSiteApp.cleanTenantPublicUrl()` normalizują pasek do `/` (także przy blokadzie trial); apex `dfcms.pl?site=slug` → preview z query; nieistniejący tenant → 404 HTML.
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
| **Front publiczny** | `index.html` (dark-mode SaaS landing spójny z admin/rejestracją: `#121212` + `#D4AF37`; hero 3 min, `#jak`, `#wyposazenie`, `#spokoj`, `#demo`, `#cennik`, SEO + `favicon.svg`), demo przez `router.html?site=demo-*` (beauty/services/care/gastro/fitness/consultant). Szablony branżowe HTML są w `/templates/` (`beauty`, `consultant`, `fitness`, `services`, `gastro`, `care`); media statyczne przenoszone z root trafiają do `/assets/images/`; boilerplate nowych szablonów: `/templates/_base_template.html`; klocki UI: `/templates/_components_library.html`; partial FAB czatu: `/templates/_partials/quick_chat_fab.html`. `setup.html` zostaje w root. `landingPricing.js` — plany cennika i dane landingowe. **Szybki kontakt:** pływający przycisk WhatsApp (`contact.whatsapp` → `wa.me`) lub Messenger (`contact.messenger` → `m.me`) — `publicSiteApp` + Alpine `x-show`; brak na opłaconym Starterze (`tier0`, `DFOPS_planAllowsQuickChat`). |
| **Panel CMS** | `admin.html` (~2,5k linii HTML), `adminApp.js` (~4k linii Alpine). **IA (2026-07):** domyślny ekran `dashboard` (adres + checklista); sidebar w 3 grupach zwijanych (Na start / Więcej treści / Ustawienia); nagłówek z CTA „Opublikuj”, menu ⋯; rezerwacje w Kontakcie; scalone Opinie; bez Leady w menu; bez globalnej widoczności sekcji w Wyglądzie — szczegóły §1.5.2. **`js/core/themeConfig.js`** — sekcje per `pages.theme`; **`js/core/contentSchema.js`** + **`contentUpgrader.js`** — kontrakt/migracja pól JSON (`pages.content` / `draft_content`). **`js/templates/registry.js`** — domyślna treść startowa (nie mylić z `templates/*.html`). Draft vs published: `pages.draft_content` / `pages.content`. Subskrypcja, Smart Booking, szybki kontakt, God Mode — jak wcześniej. |
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

- **Blokada publiczna (14 dni):** wspólna logika `js/core/trialBlocking.js` (`DFOPS_shouldBlockPublicPageView`) — używana w `publicSiteApp` i panelu (`isTrialPublicBlocked`). Źródła: `trial_started_at` w JSON, `trial_blocked_at`, `billing_failed_at`, `billing_plan`. **Podgląd panelu** (`?dfcms_preview=1` + sesja właściciela) omija blokadę.
- **Cron DB (pg_cron):** migracja `20260704223000` — codziennie 03:00 UTC `run_expire_trial_pages_cron()` → `expire_trial_pages()` + `notify_purge_upcoming_pages()`; backfill przy `db push`. Wymaga **pg_cron** w Dashboard → Extensions.
- **Edge `expire-trial-pages`:** opcjonalnie Telegram (alert −7 dni, raport kasacji) — `scripts/cron-expire-trial-edge.sql` + Vault (`dfcms_project_url`, `dfcms_cron_secret`); `verify_jwt = false`.
- **Ostrzeżenie −7 dni:** `pages.purge_warning_sent_at` + RPC `notify_purge_upcoming_pages()` (≥23 dni od blokady).
- **Kasacja (30 dni):** RPC `purge_trial_blocked_pages_after_grace()` — **domyślnie wyłączona** w Edge (`AUTO_PURGE_ENABLED` ≠ true); raport do ręcznej kasacji.
- **Powiadomienia cron:** **Telegram** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) — przez Edge `expire-trial-pages` (opcjonalny harmonogram pg_cron, patrz `scripts/cron-expire-trial-edge.sql`). Secrets: `CRON_SECRET`.

**Onboarding:** modal powitalny, Driver.js, kreator (wizard) sterowany `themeConfig` — liczba i treść kroków zależy od `pages.theme`; `welcome_onboarding_completed` / `onboarding_completed` w `pages.content`.

**Prawo & Bezpieczeństwo:** panel `admin.html#legal` zarządza `pages.content.pl.privacy` (`mode: 'default' | 'custom'`, `customText`). Publiczny route `/polityka-prywatnosci` renderuje standardową politykę DFCMS albo własny dokument użytkownika przez DOMPurify i zawsze dokleja klauzulę infrastruktury DFCMS/Supabase/Cloudflare.

**Security (skrót):** forced password reset, DOMPurify, sanitizacja URL-like pól `pages.content` na zapisie i odczycie, Cloudflare Turnstile dla rejestracji/custom inquiry/checkout, CSP/HSTS/XFO/nosniff w `functions/_middleware.js`, publiczny odczyt `pages` zawężony query+RLS+grantami kolumnowymi, Stripe webhook tylko Edge, Google Places/Maps klucz tylko Edge, `billing_profiles` SoT rozliczeń, draft preview tylko dla właściciela. Superadmini są wyłącznie w `public.superadmins`; RLS dodaje im SELECT/UPDATE/DELETE na `pages` i `analytics_events`, bez zmiany polityk właścicielskich.

**Silnik Wzrostu (G0–G3 wdrożone na Staging i Produkcję):** CMS podpowiada co tydzień jedną zmianę związaną z konwersją (telefon, rezerwacja, opinie), liczniki kliknięć CTA, odwiedzin (`page_view`) i benchmarki branżowe per `theme`. **Spec:** [`docs/GROWTH_AUTOPILOT_ARCHITECTURE.md`](GROWTH_AUTOPILOT_ARCHITECTURE.md). **Repurpose** `analytics_events` (`event_scope`: `conversion` | `visit` | `legacy`) + `growth_benchmarks` + `pages.draft_updated_at` (trigger `publish_reminder`); Edge `record-site-event` i `aggregate-growth-benchmarks`; RPC `get_page_growth_stats` / `aggregate_growth_benchmarks`. Tracking: `siteAnalytics.js` + `publicSiteApp.onConversionClick` / `recordPageView()`. Panel: `js/features/growth/` + hook `DFOPS_attachGrowthPanel` (3 linie w `adminApp.js`). Dashboard: karta priorytetu + 4 liczniki (odwiedziny + 3× CTA) z przyciskiem „Odśwież”. RODO: klauzula w `infrastructurePrivacyHtml()`. **Pozostało operacyjnie:** harmonogram cron Dashboardu (`aggregate-growth-benchmarks`, `0 3 * * 1`, `Bearer CRON_SECRET`) na Staging **i** Prod; test manualny G1/G3 na żywym ruchu. G4 (one-click draft) — poza zakresem.

**Luki:** brak obowiązkowego E2E/CI dla Edge; wildcard `*.dfcms.pl` w Cloudflare Pages; RLS anon read wymaga GRANT + polityki; brak historii wersji treści; monolityczny panel (`admin.html` + `adminApp.js`) utrudnia kolejne zmiany IA — Silnik Wzrostu jest pierwszym wycinkiem poza monolitem (wzorzec do powielenia).

**TO-DO operacyjne:** tour Driver.js mobile; smoke webhook Stripe; CI deploy Edge; włączyć **pg_cron** na Staging/Prod jeśli migracja `20260704223000` zalogowała WARNING; opcjonalnie Vault + `scripts/cron-expire-trial-edge.sql` dla Telegram; **Silnik Wzrostu:** harmonogram cron `aggregate-growth-benchmarks` (`0 3 * * 1`, Staging + Prod), test manualny G1/G3 na żywym ruchu.

### 1.5 Onboarding i panel (szczegóły)

- **Modal powitalny** (`showWelcomeModal`): warunek — `welcome_onboarding_completed` w `content.pl.settings`.
- **Driver.js** (CDN 1.4.0): tour → kreator (krok 0) → podgląd strony → sidebar (`#dfops-admin-sidebar`) → **Pomocnik krok po kroku** → Subskrypcja. Po tour domyślny widok: **`dashboard`** (nie `hero`).
- **Kreator:** kroki logiczne z `js/core/themeConfig.js` (`template` → `brand` → `hero` → `offer` → `about` → `contact`); aktywna lista per motyw (`DFOPS_getActiveWizardStepIds`) — np. gastro pomija `about`, w `offer` zbiera `menu_items` zamiast `services`; sync `nav.logo` → `business_name` / `hero.name` / SEO; `finishWizard` → `finalizeWizardContent` (ukrywa puste sekcje); stan w `localStorage` (`dfops_wizard_state_v1:{slug}`, `v:2`); czyszczenie po `finishWizard` / `switchTemplate`.
- **Draft vs published:** auto-save debounce 1000ms → `draft_content`; `publishChanges()` → `content`; **Podgląd prywatny** (`dfcms_preview=1` + sesja właściciela) działa przy wygasłym trial / `billing_failed_at` — baner czerwony, LIVE zablokowany dla gości; link w panelu: „Podgląd prywatny”.
- **Subskrypcja panel:** `hasActivePaidSubscription` / `isSubscriptionCanceledButValid` — tylko Stripe (`billing_profiles`), nie samo `payment_completed` w JSON. Po aktywnej płatności: karta statusu + portal Stripe (upgrade/downgrade kontekstowo: Starter→Standard / Standard→Starter); karuzela pakietów ukryta; baner sukcesu po `?payment=success` (`subscriptionActivationBanner`).
- **God Mode:** `godmode.html` wymaga sesji i widocznego własnego wpisu w `superadmins`; lista pobiera wszystkie `pages`. Panel po zalogowaniu sprawdza `superadmins` i pokazuje w sidebarze „Master Dashboard” tylko superadminom. Przycisk „Zarządzaj” otwiera `admin.html?impersonate={slug}`. W impersonacji panel zapisuje konkretny rekord po `pages.id`, pomija profil billingowy superadmina i blokuje checkout z sesji operatora.

### 1.5.2 Panel admin — IA (2026-07)

**Cel:** język nietechniczny; progressive disclosure (`<details>`); bez podglądu obok edycji.

**Ekran startowy (`activeTab === 'dashboard'`):** domyślny po logowaniu i po onboardingu; adres strony + „Zobacz stronę”; checklista `dashboardStartTasks` (telefon, oferta, baner, nagłówek); link do pomocnika.

**Sidebar — 3 grupy (Alpine: `navGroupStart` / `navGroupMore` / `navGroupSettings`):**

| Grupa | Domyślnie | Zakładki (`activeTab`) |
|-------|-----------|-------------------------|
| **Na start** | rozwinięta | `hero` (Baner), `services`/`menu` (Oferta), `contact` (Telefon/adres/rezerwacje), `gallery` |
| **Więcej treści** | zwinięta | `manifesto`/`care_profile` (O nas), `trust`, `faq`, `reviews` (Google + ręczne) |
| **Ustawienia** | zwinięta | `settings` (Wygląd), `seo`, `legal`, `account` |

Poniżej grup: **Subskrypcja i płatności**, **Pomocnik krok po kroku** (`#dfcms-onboarding-wizard-btn`). Link **Twoja strona** → `dashboard`.

**Usunięte z menu (logika/tab nadal w kodzie):** Leady (`leady` → alias na `dashboard`); osobne `booking` (treść w `contact`); osobne `google_reviews` (scalone w `reviews`); pasek „Ukończenie profilu”; globalne przełączniki widoczności sekcji w Wyglądzie — toggles zostają w natywnych zakładkach.

**Nagłówek:** „Szablon: …” (`themeDisplayLabel`); CTA **Opublikuj zmiany**; Podgląd strony; menu ⋯ (Odrzuć, Warunki, Wyloguj); komunikat „Zmiany zapisane — kliknij Opublikuj…”.

**Aliasy hash / `normalizeAdminTabId()`:** `#booking`→`contact`, `#google_reviews`→`reviews`, `#leady`→`dashboard`; pusty hash → `dashboard`.

**Progressive disclosure:** Kontakt (rezerwacje na górze; adres/mapa, WhatsApp, social w `<details>`); Baner (CTA w `<details>`; manifesto → osobna zakładka); Wygląd (logo + presety kolorów; reszta w „Ustawienia zaawansowane…”).

**Panel JS:** monolit `adminApp.js` + **pierwszy moduł feature** `js/features/growth/` (attach hook — §14 w [`GROWTH_AUTOPILOT_ARCHITECTURE.md`](GROWTH_AUTOPILOT_ARCHITECTURE.md)). HTML partials + `build:admin` bez zmian.

### 1.5.1 Theme-aware panel (`themeConfig`) — wzorzec

**Źródło prawdy:** `js/core/themeConfig.js` (panel + kreator). **Domyślna treść JSON:** `js/templates/registry.js` (`templatesV3`) — *nie* katalog `templates/` (to HTML witryn). Motywy opublikowane (edge/kreator): `js/core/publishedThemes.js` + klucze w `registry.js`. **Kontrakt pól treści:** `js/core/contentSchema.js` (np. booking), uzupełnianie legacy w `contentUpgrader.js`; nowe pola panelu — najpierw schema/upgrader, potem `admin.html` / szablony.

**Mapa sekcji** (`THEME_SECTIONS[theme]`): identyfikatory wewnętrzne, np. `services`, `menu`, `opening_hours`, `manifesto`, `gallery`, `faq`, `help_areas`, `certificates`, `nav_labels`. Panel i kreator pokazują UI **tylko** gdy sekcja jest na liście motywu.

**API (global):**

| Funkcja | Zastosowanie |
|---------|----------------|
| `DFOPS_getThemeSections(theme)` | tablica sekcji motywu |
| `DFOPS_themeHasSection(theme, section)` | czy sekcja istnieje w szablonie |
| `DFOPS_adminTabVisible(theme, tabId)` | czy zakładka sidebaru ma się pokazać |
| `DFOPS_getNavMenuFields(theme)` | pola etykiet górnego menu (język przedsiębiorcy) |
| `DFOPS_getActiveWizardStepIds(theme)` | filtrowane kroki kreatora |
| `DFOPS_wizardOfferSection(theme)` | `'services'` \| `'menu'` \| `null` — typ kroku oferty |

**Alpine w panelu** (`adminApp.js`): `themeHasSection('menu')`, `adminTabVisible('gallery')`, `wizardStepId`, `wizardStepCount`, `navMenuFields`. **Zakaz** nowych warunków `theme === 'beauty'` — rozszerzaj `themeConfig`.

**Nowy motyw (checklist):**

1. `registry.js` — `templatesV3.{id}.pl` + `TEMPLATE_LABELS`; domyślne pola w JSON (np. `menu_items`, `hours`).
2. `publishedThemes.js` — id na liście opublikowanych (jeśli publiczny).
3. `themeConfig.js` — `THEME_SECTIONS`, opcjonalnie `NAV_MENU_FIELDS`, `ADMIN_TAB_SECTIONS`.
4. `templates/{id}.html` — `x-text` / `x-html` z `content[lang].*`; puste sekcje → `x-show` (bez dziur na stronie).
5. `admin.html` — bloki formularza z `x-show="themeHasSection('…')"`; nowa zakładka tylko jeśli `ADMIN_TAB_SECTIONS` ma wpis.
6. Kreator — bez zmian w HTML kroków, jeśli wystarczy nowa sekcja w `THEME_SECTIONS` i ewentualnie `offerSections` w `WIZARD_STEP_DEFS`.

**Przykład gastro:** sekcje `menu`, `opening_hours`, `orders`; zakładka „Karta dań / Cennik”; kreator bez `about`; treść `menu_mode` (`link` \| `image` \| `manual`), `menu_items`, `hours`, `orders` w `content.pl`.

**Etykiety panelu:** język przedsiębiorcy (bez żargonu IT w UI) — np. „Karta dań / Cennik”, „Główny ekran”, nie „Hero” / „JSON”.

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
4. **`admin.html`** → `dashboard` (lub modal/Driver → kreator) → edycja sekcji → **Opublikuj zmiany**
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
| `retry-wfirma-invoice` | Ręczny retry FV wFirma (`POST` + `Bearer CRON_SECRET`, `checkoutSessionId` lub `stripeInvoiceId`) |
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
- **Demo katalogowe (localhost):** `data/seeds/demo_pages.json` — 6 slugów (`demo-beauty` … `demo-consultant`); fallback gdy Staging DB nie ma wiersza (`pageRepository.loadDemoSeedAsPageRow`). SoT DB: migracja `20260616150000_*`. Regeneracja JSON: `node scripts/extract-demo-seeds-from-migration.mjs`; migracji z JSON: `node scripts/generate-demo-pages-migration.mjs`.
- Lead-gen **nie** jest częścią runtime (`_lead-generator-export/` gitignored — §3.7).

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

### 3.7 Mapa repozytorium

**Podział logiczny katalogów (bez bundlera):**

| Ścieżka | Rola |
|---------|------|
| `*.html` (root) | Wejścia Cloudflare Pages (`index`, `router`, `rejestracja`, …); **`admin.html` generowany** |
| `admin/partials/` | Źródła HTML panelu CMS (36 plików); `admin/manifest.json` + `npm run build:admin` |
| `templates/` | **Szablony HTML** witryn klientów + `_base_template.html`, `_partials/` |
| `js/core/` | Config, Supabase client, `pageRepository`, `themeConfig`, `planUtils`, sanitizacja |
| `js/features/` | Aplikacje Alpine: `adminApp`, `publicSiteApp`, `routerApp`, … |
| `js/templates/registry.js` | **Rejestr treści domyślnych** (JSON) — inna warstwa niż `templates/*.html` |
| `functions/` | Cloudflare Pages Functions (`_middleware.js`, `api/verify-domain.js`) |
| `supabase/functions/` | Supabase Edge (Deno) — Stripe, domeny, cron, Telegram |
| `supabase/migrations/` | SoT schematu DB (push na remote) |
| `css/`, `img/`, `assets/images/` | Statyka; placeholdery demo w `img/`; docelowo logo/obrazy w `assets/images/` |
| `data/seeds/` | JSON demo katalogowych dla localhost (`demo_pages.json`) — w repo, deployowane na CF Pages |
| `scripts/` | Generatory (migracja demo, extract seeds) — nie deployowane jako runtime |
| `docs/` | Dokumentacja (`MASTER_CONTEXT`, roadmap, eksporty architektury) |

**Co jest w repo a co nie (deploy vs archiwum):**

| Kategoria | Przykłady | Uwagi |
|-----------|-----------|--------|
| **Deployowane (CF Pages + git)** | `admin.html`, `templates/`, `js/`, `functions/`, `img/` | Push `staging` / `main` |
| **Deployowane (Supabase CLI)** | `supabase/migrations/`, `supabase/functions/` | Osobno od frontu; secrets w Dashboard |
| **W repo, nie runtime produktu** | `scripts/`, `docs/DFCMS-Architecture-and-Flow.html` | Tooling / dokumentacja; **nie** wdrażać na Pages |
| **Gitignored — archiwum GTM (lokalne)** | `_lead-generator-export/` | CSV leadów, dataset Apify, skrypt leadów (40 wizytówek — **nie** demo katalogowe). **Nie ma w świeżym `git clone`**. Demo katalogowe → `data/seeds/demo_pages.json` + migracja `20260616150000_*`. |
| **Lokalne / pomocnicze** | `supabase/migrations_backup/`, `migrations_local_only/`, `snippets/` | Nie pushować na prod bez review; mogą być puste |
| **Gitignored** | `.env*`, `node_modules/`, `supabase/.temp/`, `.supabase/`, `dataset_crawler-google-places_*.json` | Sekrety i cache CLI |
| **Opcjonalne (AI)** | `.agents/skills/` | Instrukcje agentów (Stripe, **supabase-dfcms**, **cloudflare-dfcms**); nie wpływają na deploy |

**`data/seeds/demo_pages.json`:** w repo (6 demo katalogowych, ~31 KB). Synchronizowany z migracją `20260616150000_*` skryptem `scripts/extract-demo-seeds-from-migration.mjs`. Nie mylić z `_lead-generator-export/demo_pages.json` (40 leadów, gitignored).

**Zależność npm:** pakiet `stripe` w `package.json` — pod skrypty/tooling; front ładuje JS z CDN/bez bundlera.

### 3.8 Szybki indeks plików

| Temat | Plik |
|-------|------|
| Konfiguracja klienta / ceny fallback | `js/core/config.js` |
| Landing + cennik | `index.html#cennik`, `js/features/landingPricing.js` |
| Panel — IA / logika tabów | `admin/partials/`, `admin.html` (build), `js/features/adminApp.js` (§1.5.2) |
| Kontrakt JSON treści | `js/core/contentSchema.js`, `js/core/contentUpgrader.js` |
| Domyślna treść motywów | `js/templates/registry.js` |
| Panel subskrypcja | `admin.html`, `adminApp.js` |
| God Mode / superadmin | `godmode.html`, `admin.html?impersonate={slug}`, `20260623100512_add_god_mode.sql` |
| Plany / watermark | `js/core/planUtils.js` |
| Profil Stripe | `billingProfileView.js`, `loadBillingProfile()` |
| Demo seeds (localhost fallback) | `data/seeds/demo_pages.json`, `scripts/extract-demo-seeds-from-migration.mjs` |
| Demo seeds (DB / prod) | `supabase/migrations/20260616150000_seed_demo_catalog_pages.sql` |
| Szablony publiczne | `templates/{beauty,fitness,services,consultant,gastro,care}.html`, boilerplate `templates/_base_template.html` |
| Rejestracja | `rejestracja.html`, `registrationApp.js`, trigger `handle_new_user` |
| Edge Stripe | `create-checkout`, `stripe-webhook`, `sync-stripe-subscription`, `_shared/stripeBilling.ts` |
| Silnik Wzrostu (spec) | [`docs/GROWTH_AUTOPILOT_ARCHITECTURE.md`](GROWTH_AUTOPILOT_ARCHITECTURE.md) |

---

## 4. Dziennik transformacji

### 2026-07-05 — Silnik Wzrostu: implementacja G0–G3 (Lite Hexagonal)

Wdrożenie wg [`docs/GROWTH_AUTOPILOT_ARCHITECTURE.md`](GROWTH_AUTOPILOT_ARCHITECTURE.md) — **wdrożone na Staging i Produkcję (2026-07-05).**

- **DB:** `supabase/migrations/20260705000000_growth_engine.sql` — repurpose `analytics_events` (`page_id`, `slug`, `source`, `visitor_key`, `event_scope`; `created_at` → `timestamptz` z defaultem); RLS: usunięty stary insert właściciela, nowa `analytics_events_owner_select_conversion` (SELECT `event_scope='conversion'` + `page_id` własny), INSERT tylko `service_role`; nowa tabela `growth_benchmarks` (RLS: SELECT `authenticated`, insert/update `service_role`); RPC `aggregate_growth_benchmarks()` (SECURITY DEFINER, wyklucza `demo-*`) i `get_page_growth_stats(page_id, days)` (SECURITY INVOKER).
- **Edge:** `supabase/functions/record-site-event` (insert konwersji, walidacja slug/event_type/source, blokada `dfcms_preview=1`, rate-limit per IP+slug, `visitor_key` hash bez PII) i `aggregate-growth-benchmarks` (cron `Bearer CRON_SECRET`, wzorzec `expire-trial-pages`).
- **Front publiczny:** `js/core/siteAnalytics.js` (`window.DFOPS_recordConversionEvent`, debounce 2s, no-op w preview) + `publicSiteApp.onConversionClick` + `@click` na tel/rezerwacja/WhatsApp-Messenger w `templates/{beauty,consultant,fitness,services,gastro,care}.html`, `_base_template.html`, `_partials/quick_chat_fab.html`. `js/core/config.js` — `conversionEventsEndpoint`.
- **Cleanup legacy telemetry:** usunięto 8 wywołań `DFOPS_trackEvent` z `adminApp.js` (onboarding/checkout); `js/core/analytics.js` — `DFOPS_trackEvent` zostaje jako `console.debug` stub, bez zapisu DB.
- **Domena + panel (poza monolitem):** `js/core/growthRules.js` (kontekst `DFOPS_buildGrowthContext`, 12 reguł, `DFOPS_pickGrowthRecommendation` + rotacja tygodniowa przez `DFOPS_evaluateGrowthRule`) — pure functions; `js/features/growth/growthRepository.js` (adapter DB: benchmarks, `get_page_growth_stats`, wiek strony); `js/features/growth/growthPanel.js` — `window.DFOPS_attachGrowthPanel(app)`, owija `afterLoadData`/`loadData` hosta. **Jedyna zmiana w monolicie:** 3 linie w `buildAdminAlpineState()` (`adminApp.js`) wołające `DFOPS_attachGrowthPanel`.
- **Kontrakt treści:** `pl.settings.growth` (`dismissed_rule_ids`, `last_shown_rule_id`, `last_shown_at`, `onboarding_growth_seen`) w `contentSchema.js` (`DFOPS_GROWTH_SETTINGS_DEFAULTS`), `contentUpgrader.js` (`normalizeContent`) i `js/templates/registry.js` (defaults per motyw).
- **UI:** `admin/partials/tab-dashboard.html` — karta „Twój priorytet na ten tydzień” + 4 liczniki (odwiedziny + 3× CTA, 7 dni); `admin/partials/01-head.html` — importy growth przed `adminApp.js`; `npm run build:admin`.
- **Dashboard — ręczne odświeżanie:** `growthPanel.js` — `app.refreshGrowthStatsNow()` + `growthRefreshing` (osobny stan od `growthLoading`, bez migotania karty), `growthLastUpdatedAt`/`growthLastUpdatedLabel()`; przycisk „Odśwież” + znacznik czasu w `tab-dashboard.html` nad licznikami. Świadomie bez auto-pollingu (decyzja v0).
- **RODO — klauzula CTA:** `infrastructurePrivacyHtml()` w `js/features/publicSiteApp.js` (sekcja „Statystyki kliknięć elementów kontaktowych”) — doklejana automatycznie do KAŻDEJ polityki prywatności (domyślnej i własnej klienta, bo `renderPrivacyPolicyPage()` zawsze dokleja tę funkcję), opisuje zliczanie kliknięć CTA (brak cookies, jednokierunkowy hash IP+slug+data, cel: statystyki właściciela + anonimowe benchmarki branżowe). Zamyka spec §11.
- **`publish_reminder` domknięte:** `supabase/migrations/20260705010000_growth_draft_staleness.sql` — `pages.draft_updated_at` (timestamptz) + trigger `pages_set_draft_updated_at()` (BEFORE UPDATE: ustawia `now()` przy powstaniu rozbieżności draft/content, `NULL` po publikacji, bez zmian gdy rozbieżność trwa dalej — zero zmian w `adminApp.js`). `get_page_growth_stats()` RPC dokłada `draft_stale_days` do zwracanego JSON-a (ten sam podpis funkcji). `growthRules.js` czyta gotowe pole z `ctx.weekStats.draft_stale_days`.
- **Wdrożone na Staging (2026-07-05):** `git push origin main:staging`, `supabase db push` (3 migracje), `functions deploy record-site-event` + `aggregate-growth-benchmarks` (`verify_jwt` w centralnym `supabase/config.toml` + `--no-verify-jwt`). Smoke test: konwersje, `page_view`, `get_page_growth_stats`, `aggregate_growth_benchmarks`.
- **Wdrożone na Produkcję (2026-07-05):** `git push origin main`, `npm run deploy:db:production` + `deploy:functions:production` (te same migracje i Edge Functions).
- **Nie zrobione:** harmonogram cron w Dashboardzie (Staging **i** Prod), test manualny G1/G3 na żywym froncie, dedup `page_view` po `visitor_key` (backlog CTO — odłożone).

### 2026-07-04 — Czysty URL subdomen tenant (bez /templates/…)

- **`js/core/tenantPublicUrlClean.js`:** synchroniczne `history.replaceState` w `<head>` szablonów — `{slug}.dfcms.pl/templates/{theme}` → `/` od razu po wejściu (fallback bez wildcard `*.dfcms.pl`).
- **`publicSiteApp`:** `cleanTenantPublicUrl` także przy wygasłym trialu i braku autoryzacji podglądu; regex ścieżki akceptuje `/templates/{theme}` bez `.html`.

### 2026-07-04 — Panel: brak onboardingu przy zablokowanym trial

- **`shouldSkipFirstRunOnboarding`:** wygasły trial nie pokazuje modala powitalnego / Driver.js + kreator.
- **`syncTrialSuspendedModalVisibility`:** modal trial zapamiętywany w `sessionStorage` po „Pracuję w panelu” (nie wraca przy każdym F5).

### 2026-07-04 — pg_cron trial + sync panelu z blokadą publiczną

- **`js/core/trialBlocking.js`:** wspólna `DFOPS_shouldBlockPublicPageView` (public + panel).
- **Panel:** getter `isTrialPublicBlocked` — baner/modal gdy trial wygasły po dacie, nie tylko gdy `trial_blocked_at` w DB.
- **Migracja `20260704223000`:** `run_expire_trial_pages_cron()` + pg_cron 03:00 UTC + backfill `trial_blocked_at`; opcjonalny Telegram przez `scripts/cron-expire-trial-edge.sql`.
- **Edge:** `expire-trial-pages/config.toml` → `verify_jwt = false`.

### 2026-07-04 — Podgląd po wygasłym trial

- **`pageRepository.getPageForAuthenticatedPreview`:** odczyt metadanych strony bez filtrów trial/billing — RLS (właściciel lub superadmin).
- **`publicSiteApp`:** przy `?dfcms_preview=1` + zalogowany właściciel pomija `shouldBlockPublicPageView`; baner „Podgląd prywatny”; analityka nadal wyłączona w preview. Publiczny LIVE i anon bez zmian.

### 2026-07-04 — Spec architektury Silnika Wzrostu

- **Dokument:** [`docs/GROWTH_AUTOPILOT_ARCHITECTURE.md`](GROWTH_AUTOPILOT_ARCHITECTURE.md) — plan wdrożenia Growth Autopilot dla agentów: fazy G0–G4, rozszerzenie `analytics_events` + `growth_benchmarks`, Edge Functions, `growthRules.js` / `siteAnalytics.js`, integracja z `themeConfig`, dashboard, RLS, checklist plików i testów.
- **Decyzje:** rozszerzyć `analytics_events` (stary telemetry panelu nieużywany); reguły branżowe jak `themeConfig`; panel JS = monolit `adminApp.js`; HTML dashboard przez partials + `build:admin`.
- **Rev 2 (2026-07-04):** rezygnacja z osobnej tabeli `site_events` — jedna tabela zdarzeń, cleanup `DFOPS_trackEvent` w panelu.
- **Status:** spec tylko — brak kodu produkcyjnego do momentu ticketów G0+.

### 2026-07-04 — Fix landingu na subdomenach tenantów

- **Przyczyna:** bez wildcard `*.dfcms.pl` w Cloudflare Pages worker widzi host `dfopscms.pages.dev` → middleware pada → `next()` serwuje `index.html` (marketing). Poprzedni `routerApp` robił `replace('/')` → pętla landingu.
- **Fix:** `index.html` — fallback `router.html` gdy `DFOPS_isTenantPublicHostname` lub custom domain; `routerApp.js` — tenant/custom → `/templates/{theme}.html` (bez `?site=`); `publicSiteApp` — `buildThemePageUrl` i kolejność `cleanTenantPublicUrl` vs redirect motywu.
- **TO-DO infra:** dodać `*.dfcms.pl` (i ewentualnie custom hostnames) w Cloudflare Pages, żeby edge rewrite na `/` działał bez hopu przez router.

### 2026-07-04 — UX zakładki Subskrypcja

- **`admin/partials/tab-subscription.html`:** po `hasActivePaidSubscription` ukryta karuzela wyboru pakietu; uproszczone kafelki (cena + `<details>` funkcji, bez duplikatów prawnych); karta aktywnej subskrypcji z przyciskami **Podnież do Standard** / **Obniż do Starter** + faktury/karta w portalu Stripe.
- **`adminApp.js`:** `subscriptionActivationBanner` + `dismissSubscriptionActivationBanner()` po udanym `?payment=success` (auto `setTab('subscription')`).

### 2026-07-04 — Rollback eksperymentu panelu JS (staging)

Na gałęzi `staging` przetestowano podział logiki panelu — **cofnięto**; stan panelu JS = **`main`** (monolit `js/features/adminApp.js`).

**Co miało być zrobione**

1. **Split `adminApp.js`** na `js/features/admin/` (mixiny: auth, billing, data, wizard, ui, integrations) + `npm run build:admin-js` / `build:panel`.
2. **Fixy reaktywności Alpine 3** — gettery zamrażane przy `init()`; jawne pola + `syncBillingSubscriptionView`, `syncWizardView`, `syncUiDerivedView`, `syncEmailVerificationView`.
3. **Onboarding po rejestracji** — auto-start kreatora, race trigger DB vs `ensurePageFromRegistrationMetadata`, staging bypass weryfikacji e-mail, routing tenantów (`platformRouting.js`), `setup.html`.
4. **Pozostałe zmiany staging** (middleware, publicSiteApp, subskrypcja UI) — pozostają w repo poza rollbackiem panelu JS; nie były częścią cofnięcia.

**Dlaczego rollback**

- Kreator i samouczek Driver.js na stagingu **niestabilne** vs produkcja (`main`).
- Split nie usunął problemu — ujawnił regresje (m.in. zamrożone gettery, tour pomijany przy auto-starcie).
- **Decyzja:** panel JS jak na `main`; **zostaje** split HTML (`admin/partials/` + `npm run build:admin`).

**Stan po rollbacku**

| Element | Stan |
|---------|------|
| `js/features/adminApp.js` | Monolit z `main` (`?v=20260704a` w partialu head) |
| `js/features/admin/` | Usunięte |
| `scripts/build-admin-app.mjs`, `split-admin-app.mjs` | Usunięte |
| `admin/partials/`, `admin.html` | Z `main` (build: `npm run build:admin`) |

**Następny krok (opcjonalnie):** refaktor JS panelu dopiero z CI (`build:panel` na deploy) lub po testach E2E onboardingu; ewentualnie pozostajemy przy monolicie + partials HTML.

---

## Utrzymanie tego pliku

1. Na koniec sesji zmieniającej produkcję: zaktualizuj sekcje **1–3** i wpis w **§4**.
2. Szczegóły implementacyjne zostaw w kodzie; tutaj **decyzje, stany, luki**.
3. Plany post-MVP → [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).
