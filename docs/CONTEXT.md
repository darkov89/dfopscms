# Context

> **Źródło prawdy technicznego stanu aplikacji.** Aktualizuj **na koniec sesji**, gdy zmienia się zachowanie w produkcji, API, flow użytkownika lub architektura.  
> Plany post-MVP: [`docs/ROADMAP.md`](ROADMAP.md). Szybki start repo: [`README.md`](../README.md).

**Ostatnia aktualizacja:** 2026-08-08 — Zero-Friction Context-Driven AI (`ai_business_context`)

---

## 1. Podział logiczny i środowiska

### 1.1 Warstwy systemu

| Warstwa | Odpowiedzialność | Technologie / artefakty |
|--------|------------------|-------------------------|
| **Frontend (public + panel)** | Landing, szablony branżowe, panel CMS, routing wielodomenowy | Statyczne HTML, `js/` (Alpine.js w panelu), `css/styles.css`, `js/core/config.js` |
| **Hosting frontu** | CDN, preview deployów, custom hostnames klientów (SaaS) | **Cloudflare Pages** (`functions/_middleware.js` — SEO, CSP, proxy treści) |
| **Backend / baza** | Auth, treść stron, rozliczenia, storage | **Supabase** — PostgreSQL (`pages`, `billing_profiles`), Auth (JWT), Storage, RLS |
| **Funkcje serverless** | Płatności, domeny, cron trial, opinie Google, AI copy, alerty | **Supabase Edge Functions** (Deno) w `supabase/functions/` |
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
4. **Własna domena** — panel „Zapisz i sprawdź” → DoH `verify-domain` (info) → Edge `add-custom-domain` (Custom Hostname **apex + www**, SSL `txt`, idempotentny przy 1406). Status `active` **tylko** gdy CF apex+www mają `status`+`ssl` = active. Instrukcja DNS z Edge: **A** `@` → `172.67.154.121` + `104.21.66.9` + **TXT** `_cf-custom-hostname` (ownership) + **CNAME** `www` → `proxy.dfcms.pl`. DNS klienta w Cloudflare → DNS only (nie Proxied).
5. **Routing publiczny** — `functions/_middleware.js` (slug z nagłówka `Host` / kandydatów); RPC `get_public_site_route` → soft-block HTML gdy `blocked`, live SEO rewrite gdy publicznie czytelne, preview bez content SEO; gdy edge widzi tylko `*.pages.dev` (brak wildcard `*.dfcms.pl` w Pages), **fallback w przeglądarce:** `index.html` → `router.html` → `/templates/{theme}.html` (slug z `window.location.hostname` + meta RPC przy soft-block); **`js/core/tenantPublicUrlClean.js`** (sync w `<head>` szablonu) + `publicSiteApp.cleanTenantPublicUrl()` normalizują pasek do `/` (także przy blokadzie trial); apex `dfcms.pl?site=slug` → preview z query; nieistniejący tenant → 404 HTML.
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
| **Front publiczny** | `index.html` (dark-mode SaaS landing spójny z admin/rejestracją: `#121212` + `#D4AF37`; hero (wynik biznesowy + AI w subcopy), `#jak`, `#ai`, `#korzysci`, `#panel`, `#demo`, `#spokoj`, `#cennik`, SEO + `favicon.svg`), demo przez `router.html?site=demo-*` (beauty/services/care/gastro/fitness/consultant). Szablony branżowe HTML są w `/templates/` (`beauty`, `consultant`, `fitness`, `services`, `gastro`, `care`); media statyczne przenoszone z root trafiają do `/assets/images/`; boilerplate nowych szablonów: `/templates/_base_template.html`; klocki UI: `/templates/_components_library.html`; partial FAB czatu: `/templates/_partials/quick_chat_fab.html`. `setup.html` zostaje w root. `landingPricing.js` — plany cennika i dane landingowe. **Szybki kontakt:** pływający przycisk WhatsApp (`contact.whatsapp` → `wa.me`) lub Messenger (`contact.messenger` → `m.me`) — `publicSiteApp` + Alpine `x-show`; dostępny na wszystkich planach w tym Starter (`tier0`, `DFOPS_planAllowsQuickChat` — od 2026-07-05). Opcjonalna lista gotowych pytań (`contact.quick_chat_questions: string[]`, panel Kontakt → Szybki czat): klik w FAB rozwija popover, wybór pytania otwiera czat z wpisaną treścią (WhatsApp `?text=`; Messenger nie wspiera pre-fillu → kopiowanie do schowka + toast). |
| **Panel CMS** | `admin.html` (~2,5k linii HTML), `adminApp.js` (~4k linii Alpine). **IA (2026-07):** domyślny ekran `dashboard` (adres + checklista + **AI Site Generator**); sidebar w 3 grupach zwijanych (Na start / Więcej treści / Ustawienia); nagłówek z CTA „Opublikuj”, menu ⋯; rezerwacje w Kontakcie; scalone Opinie; bez Leady w menu; bez globalnej widoczności sekcji w Wyglądzie — szczegóły §1.5.2. **`js/core/themeConfig.js`** — sekcje per `pages.theme`; **`js/core/contentSchema.js`** + **`contentUpgrader.js`** — kontrakt/migracja pól JSON (`pages.content` / `draft_content`). **`js/templates/registry.js`** — domyślna treść startowa (nie mylić z `templates/*.html`). Draft vs published: `pages.draft_content` / `pages.content`. **Zero-Friction AI (2026-08-08):** `draft_content.pl.settings.ai_business_context` (+ `business_category` / `city`) — kontekst branżowy niezależny od nazwy szablonu; `js/core/aiBusinessContext.js`; fallback ręczny w kreatorze/Kontakcie gdy Places bez kategorii. Subskrypcja, Smart Booking, szybki kontakt, God Mode — jak wcześniej. Adaptery poza monolitem: `growth/` + `aiGenerator.js`. |
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
- **Soft-block vs 404 (2026-08-04):** po `trial_blocked_at` / końcu grace `billing_failed_at` gość **nie** dostaje twardego 404 ani `pages.content`. RPC `get_public_site_route` (anon, bez content) + middleware → HTML soft-block (200, `noindex`); fallback w `publicSiteApp` / `routerApp` przez `getPublicSiteRoute`. RLS `pages_select_public` **bez zmian** (zablokowany wiersz niewidoczny w SELECT tabeli). Preview: edge serwuje szablon bez SEO content; treść przez `getPageForAuthenticatedPreview`. Nieistniejący slug → nadal 404.
- **Cron DB (pg_cron):** migracja `20260704223000` — codziennie 03:00 UTC `run_expire_trial_pages_cron()` → `expire_trial_pages()` + `notify_purge_upcoming_pages()`; backfill przy `db push`. Wymaga **pg_cron** w Dashboard → Extensions.
- **Edge `expire-trial-pages`:** opcjonalnie Telegram (alert −7 dni, raport kasacji) — `scripts/cron-expire-trial-edge.sql` + Vault (`dfcms_project_url`, `dfcms_cron_secret`); `verify_jwt = false`.
- **Ostrzeżenie −7 dni:** `pages.purge_warning_sent_at` + RPC `notify_purge_upcoming_pages()` (≥23 dni od blokady).
- **Kasacja (30 dni):** RPC `purge_trial_blocked_pages_after_grace()` — **domyślnie wyłączona** w Edge (`AUTO_PURGE_ENABLED` ≠ true); raport do ręcznej kasacji.
- **Powiadomienia cron:** **Telegram** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) — przez Edge `expire-trial-pages` (opcjonalny harmonogram pg_cron, patrz `scripts/cron-expire-trial-edge.sql`). Secrets: `CRON_SECRET`.

**Onboarding:** modal powitalny, Driver.js, kreator (wizard) sterowany `themeConfig` — liczba i treść kroków zależy od `pages.theme`; `welcome_onboarding_completed` / `onboarding_completed` w `pages.content`.

**Prawo & Bezpieczeństwo:** panel `admin.html#legal` zarządza `pages.content.pl.privacy` (`mode: 'default' | 'custom'`, `customText`). Publiczny route `/polityka-prywatnosci` renderuje standardową politykę DFCMS albo własny dokument użytkownika przez DOMPurify i zawsze dokleja klauzulę infrastruktury DFCMS/Supabase/Cloudflare.

**Security (skrót):** forced password reset, DOMPurify, sanitizacja URL-like pól `pages.content` na zapisie i odczycie, Cloudflare Turnstile dla rejestracji/custom inquiry/checkout, CSP/HSTS/XFO/nosniff w `functions/_middleware.js`, publiczny odczyt `pages` (anon + query); authenticated SELECT tylko własne wiersze (+ God Mode); `billing_plan` / `trial_*` tylko `service_role` (trigger); brak client INSERT na `billing_profiles`; Storage `images` z ownership; Stripe webhook tylko Edge; Places key vs Embed key osobno; `telegram-webhook` wymaga `Bearer TELEGRAM_WEBHOOK_SECRET`; Checkout/Portal `returnUrl` na allowliście hostów (bez `*.pages.dev`).

**Silnik Wzrostu (G0–G3 wdrożone na Staging i Produkcję):** CMS podpowiada co tydzień jedną zmianę związaną z konwersją (telefon, rezerwacja, opinie), liczniki kliknięć CTA, odwiedzin (`page_view`) i benchmarki branżowe per `theme`. **Spec:** [`docs/specs/growth.md`](specs/growth.md). **Repurpose** `analytics_events` (`event_scope`: `conversion` | `visit` | `legacy`) + `growth_benchmarks` + `pages.draft_updated_at` (trigger `publish_reminder`); Edge `record-site-event` i `aggregate-growth-benchmarks`; RPC `get_page_growth_stats` / `aggregate_growth_benchmarks`. Tracking: `siteAnalytics.js` + `publicSiteApp.onConversionClick` / `recordPageView()`. Panel: `js/features/growth/` + hook `DFOPS_attachGrowthPanel` (3 linie w `adminApp.js`). Dashboard: karta priorytetu + 4 liczniki (odwiedziny + 3× CTA) z przyciskiem „Odśwież”. Zakładka „Statystyki” (`statsPanel.js` + `tab-stats.html`): zakres dat (presety + własny), total vs unikalni dziennie, eksport CSV/Excel — RPC `get_page_stats_range`. RODO: klauzula w `infrastructurePrivacyHtml()`. **Pozostało operacyjnie:** harmonogram cron Dashboardu (`aggregate-growth-benchmarks`, `0 3 * * 1`, `Bearer CRON_SECRET`) na Staging **i** Prod; test manualny G1/G3 na żywym ruchu. G4 (one-click draft) — poza zakresem.

**Luki:** brak obowiązkowego E2E/CI dla Edge; wildcard `*.dfcms.pl` w Cloudflare Pages; RLS anon read wymaga GRANT + polityki; brak historii wersji treści; monolityczny panel (`admin.html` + `adminApp.js`) utrudnia kolejne zmiany IA — Silnik Wzrostu jest pierwszym wycinkiem poza monolitem (wzorzec do powielenia).

**TO-DO operacyjne:** tour Driver.js mobile; smoke webhook Stripe; CI deploy Edge; włączyć **pg_cron** na Staging/Prod jeśli migracja `20260704223000` zalogowała WARNING; opcjonalnie Vault + `scripts/cron-expire-trial-edge.sql` dla Telegram; **Silnik Wzrostu:** harmonogram cron `aggregate-growth-benchmarks` (`0 3 * * 1`, Staging + Prod), test manualny G1/G3 na żywym ruchu.

### 1.5 Onboarding i panel (szczegóły)

- **Modal powitalny** (`showWelcomeModal`): warunek — `welcome_onboarding_completed` w `content.pl.settings`.
- **Driver.js** (CDN 1.4.0): tour → kreator (krok 0) → podgląd strony → sidebar (`#dfops-admin-sidebar`) → **Pomocnik krok po kroku** → Subskrypcja. Po tour domyślny widok: **`dashboard`** (nie `hero`).
- **Kreator:** kroki logiczne z `js/core/themeConfig.js` (`template` → `brand` → `hero` → `offer` → `about` → `contact`); aktywna lista per motyw (`DFOPS_getActiveWizardStepIds`) — np. gastro pomija `about`, w `offer` zbiera `menu_items` zamiast `services`; sync `nav.logo` → `business_name` / `hero.name` / SEO; wejście w hero czyści przykładowe teksty; **Pomiń sekcję** (offer/about); **Generuj z AI** per pole; `finishWizard` → `finalizeWizardContent` (ukrywa puste sekcje); stan w `localStorage` (`dfops_wizard_state_v1:{slug}`, `v:2`); czyszczenie po `finishWizard` / `switchTemplate`.
- **i18n treści:** `meta.locales` + `meta.translationMode` (`ai`|`manual`); przełącznik języka w headerze tylko gdy >1 locale; sync AI po zmianie PL.
- **Draft vs published:** auto-save debounce 1000ms → `draft_content`; `publishChanges()` → `content`; **Podgląd prywatny** (`dfcms_preview=1` + sesja właściciela) działa przy wygasłym trial / `billing_failed_at` — baner czerwony, LIVE zablokowany dla gości; link w panelu: „Podgląd prywatny”.
- **Subskrypcja panel:** `hasActivePaidSubscription` = żywa sub Stripe **lub** aktywny grant ręczny (`grant_source=manual` + `current_period_end` w przyszłości). Portal / upgrade Stripe tylko przy `hasStripeLiveSubscription`. Przy samym grancie: karta statusu + karuzela Checkout (klient może podpiąć kartę — webhook ustawia `grant_source=stripe`).
- **God Mode:** `godmode.html` — nawigacja Start + karty: **Strona demo** / **Strona klienta** / **Zarządzaj stronami** (filtry wszyscy/klienci/demo). Edge: `god-provision-site`, `god-manage-demo`, `god-grant-subscription`. Impersonacja (`admin.html?impersonate={slug}`): działa też dla dem (`user_id=null`); billing właściciela read-only; checkout zablokowany.
- **Multi-site:** jeden `user_id` może mieć wiele `pages`; panel: `listCurrentUserPages` + selektor w nagłówku gdy >1; zapis po `pages.id`. Billing nadal 1:1 `billing_profiles` ↔ user (lustro na wszystkie strony usera).

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

**Panel JS:** monolit `adminApp.js` + **pierwszy moduł feature** `js/features/growth/` (attach hook — §14 w [`specs/growth.md`](specs/growth.md)). HTML partials + `build:admin` bez zmian.

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
- **Treść:** DOMPurify + `pageRepository.sanitizeContent` (w tym `menu_image` / elementy `gallery.images`); mapy — tylko Google embed URL; GTM/Pixel — walidacja formatu ID; custom privacy policy renderowana przez `sanitizeHtml`.
- **Stripe / billing SoT:** webhook secret tylko Edge; `billing_profiles` zapis wyłącznie `service_role` (brak INSERT policy dla `authenticated`); lustro `pages.billing_plan` / `trial_blocked_at` / `billing_failed_at` chronione triggerem `protect_pages_billing_columns` — panel **nie** czyści blokad przy publish.
- **Custom domain SoT:** `pages.custom_domain` / `custom_domain_status` chronione triggerem `protect_pages_custom_domain_columns` — client JWT nie claimuje domeny przez PostgREST; zapis/clear tylko Edge `add-custom-domain` (`service_role`) po JWT + ownership/superadmin + walidacji hostname / blocklist domen platformy + gate planu Standard+.
- **Google Reviews Edge:** sesja wymagana; Places: `GOOGLE_MAPS_API_KEY` tylko serwer; embed iframe: osobny `GOOGLE_MAPS_EMBED_API_KEY` (HTTP referrer); panel autocomplete → `place_id`.
- **Checkout / Portal / God Mode CORS:** `returnUrl` i CORS przez `_shared/allowedOrigins.ts` — `dfcms.pl`, `*.dfcms.pl`, localhost oraz preview tego projektu (`dfopscms.pages.dev`, `*.dfopscms.pages.dev`). Nie dowolne `*.pages.dev`.
- **Telegram:** `telegram-webhook` wymaga `Authorization: Bearer TELEGRAM_WEBHOOK_SECRET` (fail-closed). Database Webhooks + Sentry muszą mieć ten header. Osobny od `CRON_SECRET`.
- **Smart Booking:** `settings.booking_mode` + `contact.booking_url`; Booksy embed — ostrzeżenie X-Frame-Options.
- **Nagłówki HTTP:** Cloudflare middleware dokleja CSP (Supabase/Stripe/Google Maps/CDN/Sentry/Calendly/GTM/GA4/Meta Pixel), `X-Content-Type-Options`, `X-Frame-Options: DENY`, HSTS dla HTTPS, Referrer/Permissions Policy.
- **Anti-abuse:** Turnstile widget w `rejestracja.html`, `zapytanie-custom.html` i panelu subskrypcji; `create-checkout` i `send-custom-inquiry` weryfikują `turnstileToken` przez `_shared/turnstileVerification.ts`. Secrets: `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- **Publiczny odczyt stron:** anon — polityka `pages_select_public` + granty kolumnowe **bez** `draft_content` (zablokowane wiersze niewidoczne); authenticated — tylko `pages_select_owner` (`user_id = auth.uid()`); soft-block meta: RPC `get_public_site_route` (bez content); `purge_trial_blocked_pages_after_grace` tylko `service_role`/`postgres`.
- **Storage images:** upload `{user_id}/{slug}-…`; INSERT/UPDATE/DELETE/SELECT (authenticated) wymaga ownership (prefix uid lub legacy flat `{slug}-…` własnej strony); publiczny odczyt URL bez listingu cudzych obiektów.
- **God Mode RLS:** `superadmins` ma SELECT tylko własnego wiersza dla `authenticated`; wpisy dodaje/usuwa operacyjnie `service_role`. Polityki superadminów na `pages` i `analytics_events` są dodatkowymi OR-ścieżkami RLS, nie zastępują dostępu właściciela.
- **Widoczność sekcji:** toggles per zakładka (`showGallery`, `showGoogleReviews`, …); hero bez toggle.
- **Migracje security:** `20260727180000_security_harden_crit_high.sql`; soft-block meta: `20260804160000_get_public_site_route.sql`; custom domain freeze: `20260805120000_protect_custom_domain_columns.sql`; storage select own: `20260805121000_storage_images_select_own.sql`.

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
| `stripe-webhook` | Zdarzenia Stripe → `billing_profiles` + `pages`; wFirma faktury (`WFIRMA_*`); ustawia `grant_source=stripe` |
| `god-provision-site` | God Mode: invite Auth + `pages` (email/slug/theme); opcjonalny grant ręczny |
| `god-grant-subscription` | God Mode: grant / revoke planu (`grant_source=manual`, `expiresAt`) |
| `god-manage-demo` | God Mode: create/delete stron demo (`demo-*`, bez user_id / bez subskrypcji; delete wymaga `confirmSlug`) |
| `retry-wfirma-invoice` | Ręczny retry FV wFirma (`POST` + `Bearer CRON_SECRET`, `checkoutSessionId` lub `stripeInvoiceId`) |
| `sync-stripe-subscription` | Ręczna synchronizacja statusu subskrypcji |
| `add-custom-domain` | Cloudflare Custom Hostname + zapis w DB |
| `get-google-reviews` | Places / opinie (`GOOGLE_MAPS_API_KEY`); embed iframe (`GOOGLE_MAPS_EMBED_API_KEY`); `listPlaces` zwraca też `category` / `primaryType*` / `types`; wymaga sesji |
| `generate-ai-content` | AI Site Generator (Gemini): JWT + ownership + quota → merge copy do `pages.draft_content`; secrets `GEMINI_API_KEY`, opcjonalnie `GEMINI_MODEL` / `DFCMS_ENV` / `AI_LOG_PROMPTS` |
| **`expire-trial-pages`** | **Cron** (`POST` + `Bearer CRON_SECRET`): `expire_manual_grants()` → `expire_trial_pages()` → `notify_purge_upcoming_pages()` → `list_pages_pending_purge()` → opcjonalnie `purge_trial_blocked_pages_after_grace()` gdy `AUTO_PURGE_ENABLED=true`. **Powiadomienia operacyjne przez Telegram** (Markdown): alert −7 dni per slug; raport ręcznej kasacji (30+ dni) z gotowym SQL. Brak alertów → `200` bez wiadomości. |
| `telegram-webhook` | Router alertów (Sentry, Database Webhooks `users`/`pages`/`billing_profiles`, logi) → Telegram; **`Bearer TELEGRAM_WEBHOOK_SECRET`**; prefix `[STAGING]` / `[PROD]` z `DFCMS_ENV` lub project ref |
| `send-custom-inquiry` | Publiczny formularz Custom (`zapytanie-custom.html`): Turnstile → SMTP (`SMTP_*`, jak Auth) + Telegram ops (`verify_jwt=false`) |

**Współdzielona logika:** `supabase/functions/_shared/stripeBilling.ts`, `wfirmaBilling.ts`, `wfirmaInvoiceLedger.ts`, `aiCopySchemas.ts` (whitelist copy per motyw + `buildGeminiResponseSchema`), `sendTransactionalEmail.ts` (Resend / SMTP).

**Pages Functions (Cloudflare):** `functions/_middleware.js`, `functions/api/verify-domain.js` (A apex + CNAME www → `proxy.dfcms.pl`, `dfcms.pl`, `dfopscms.pages.dev`).

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
- Lead-gen **nie** jest częścią runtime — archiwum poza repo: `~/projekty/dfcms-lead-gen-archive/` (wcześniej lokalny `_lead-generator-export/`, gitignored).

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

**Database Webhooks (Telegram):** Dashboard → Database Webhooks → `…/functions/v1/telegram-webhook` z nagłówkiem `Authorization: Bearer <TELEGRAM_WEBHOOK_SECRET>`. **Nie** commituj triggerów SQL z `http_request`. To samo dla Sentry outbound webhook.

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
| `docs/` | `CONTEXT.md`, `ROADMAP.md`, `specs/` (feature specs), `architecture-flow.html` |

**Co jest w repo a co nie (deploy vs archiwum):**

| Kategoria | Przykłady | Uwagi |
|-----------|-----------|--------|
| **Deployowane (CF Pages + git)** | `admin.html`, `templates/`, `js/`, `functions/`, `img/` | Push `staging` / `main` |
| **Deployowane (Supabase CLI)** | `supabase/migrations/`, `supabase/functions/` | Osobno od frontu; secrets w Dashboard |
| **W repo, nie runtime produktu** | `scripts/`, `docs/architecture-flow.html` | Tooling / dokumentacja; **nie** wdrażać na Pages |
| **Poza repo (archiwum GTM, lokalne)** | `~/projekty/dfcms-lead-gen-archive/` | Dataset Apify / crawler Google Places (40 wizytówek — **nie** demo katalogowe). **Nigdy nie było w runtime DFCMS ani w adminie.** Demo katalogowe → `data/seeds/demo_pages.json` + migracja `20260616150000_*`. |
| **Lokalne / pomocnicze** | `supabase/migrations_backup/`, `migrations_local_only/`, `snippets/` | Nie pushować na prod bez review; mogą być puste |
| **Gitignored** | `.env*`, `node_modules/`, `supabase/.temp/`, `.supabase/`, `dataset_crawler-google-places_*.json` | Sekrety i cache CLI |
| **Opcjonalne (AI)** | `.agents/skills/` | Instrukcje agentów (Stripe, **supabase-dfcms**, **cloudflare-dfcms**); nie wpływają na deploy |

**`data/seeds/demo_pages.json`:** w repo (6 demo katalogowych, ~31 KB). Synchronizowany z migracją `20260616150000_*` skryptem `scripts/extract-demo-seeds-from-migration.mjs`. Nie mylić z archiwum leadów w `~/projekty/dfcms-lead-gen-archive/` (40 leadów, poza repo).

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
| God Mode / superadmin | `godmode.html`, `god-provision-site`, `god-grant-subscription`, `admin.html?impersonate={slug}`, `20260623100512_add_god_mode.sql`, `20260804180000_manual_grant_source.sql` |
| Plany / watermark | `js/core/planUtils.js` (m.in. `DFOPS_planAllowsAiGenerator`, limity AI) |
| AI Site Generator | `js/features/aiGenerator.js` (generate / adapt / **field**), Edge `generate-ai-content`, `_shared/aiCopySchemas.ts`, kontekst: `js/core/aiBusinessContext.js` → `settings.ai_business_context` |
| i18n treści witryn | `js/features/i18nPanel.js`, `js/core/i18nContent.js`, `meta.translationMode` |
| Profil Stripe | `billingProfileView.js`, `loadBillingProfile()`, `grant_source` |
| Multi-site panel | `pageRepository.listCurrentUserPages`, selektor w `08-header.html` |
| Demo seeds (localhost fallback) | `data/seeds/demo_pages.json`, `scripts/extract-demo-seeds-from-migration.mjs` |
| Demo seeds (DB / prod) | `supabase/migrations/20260616150000_seed_demo_catalog_pages.sql` |
| Szablony publiczne | `templates/{beauty,fitness,services,consultant,gastro,care}.html`, boilerplate `templates/_base_template.html` |
| Rejestracja | `rejestracja.html`, `registrationApp.js`, trigger `handle_new_user` |
| Edge Stripe | `create-checkout`, `stripe-webhook`, `sync-stripe-subscription`, `_shared/stripeBilling.ts` |
| Silnik Wzrostu (spec) | [`docs/specs/growth.md`](specs/growth.md) |

---

## 4. Dziennik transformacji

### 2026-08-08 — Zero-Friction Context-Driven AI
- **Cel:** treści AI zależą od faktycznej branży użytkownika, nie od nazwy szablonu (`beauty` / `fitness`…).
- **SoT:** `draft_content.pl.settings.ai_business_context` (string); pomocniczo `business_category`, `city`.
- **Źródła:** Google Places (`listPlaces` + kategoria) albo ręczne pole fallback (`needsManualIndustry`) w kreatorze / zakładce Kontakt.
- **Modal AI:** prefill z `ai_business_context` (stare strony: sklejka name + category + city).
- **Zmiana szablonu:** zachowanie kontekstu; `confirmChoiceAsync` → opcjonalnie regeneracja tekstów AI po reloadzie (`sessionStorage`).
- **Kod:** `js/core/aiBusinessContext.js`, `aiGenerator.js`, `adminApp.js`, partials wizard/AI/contact; Edge `get-google-reviews` (field mask kategorii). Testy: `npm run test:ai-context`.
- **Deploy:** `supabase functions deploy get-google-reviews` (staging → prod) — bez tego kategoria z Places nie wróci do panelu.

### 2026-08-06 — AI: tłumaczenie etykiet UI (Telefon, Polityka, cookies)
- `content.<locale>.ui` + `js/core/uiLabels.js` / `uiLabel()` — bez edycji w panelu.
- Whitelist AI `ui` we wszystkich motywach; szablony podpięte; domyślna polityka prywatności EN/DE na stronie `/privacy`.

### 2026-08-06 — Telegram: etykieta Staging / Prod

Wiadomości ops (`telegram-webhook`, `expire-trial-pages`, `send-custom-inquiry`) mają prefix `🟡 [STAGING]` / `🟢 [PROD]` — `_shared/dfcmsEnv.ts` (`DFCMS_ENV` lub project ref z `SUPABASE_URL`). Deploy: `functions deploy` tych trzech na Staging + Prod.

### 2026-08-06 — CSP: odblokowanie GTM / GA4 / Meta Pixel
- **Problem:** baner cookies wstrzykuje GTM (`googletagmanager.com`) i Meta Pixel (`connect.facebook.net`), ale CSP w `functions/_middleware.js` whitelistsował tylko Maps/Stripe/Sentry — konsola: naruszenia CSP przy skryptach Google.
- **Fix:** `script-src` / `connect-src` / `frame-src` — domeny GTM, GA4 (`*.google-analytics.com`, `*.analytics.google.com`, `*.g.doubleclick.net`) oraz Facebook Pixel; `img-src` już ma `https:`.

### 2026-08-06 — AI schema: pola które nie wchodziły w tłumaczenie
- **Consultant (i wspólne):** `aiCopySchemas` — dodane m.in. `hero.subheadline`, `proof`, `faq_heading`, `reviews_heading`, `contact.title` + `contact.cta.*`, `nav.menu.booking`, `footer.quote`, `google_reviews.label`, `cookies`.
- Edge `generate-ai-content` deploy staging + production (whitelist w `_shared`).

### 2026-08-06 — AI: wybór „tylko brakujące” / „całość”; mobile nav
- **Tłumaczenie AI:** gdy locale już ma treści, modal pyta *Tylko brakujące* vs *Całość od nowa* (`confirmChoiceAsync`). Merge: `DFOPS_mergeLocaleFillMissing` w `i18nContent.js` (zachowuje stringi ≠ PL / niepuste).
- **Panel mobile:** uproszczony sticky header (jedna linia: ☰ + DFCMS + język + akcje).
- **Consultant public:** hamburger + rozwijane menu sekcji na mobile.

### 2026-08-06 — Consultant: odblokowanie edycji sekcji (manifesto, CTA, nagłówki)
- **`THEME_SECTIONS.consultant`:** dodane `manifesto` (zakładka „O nas”).
- **Hero:** `hero.subheadline` w panelu; FAQ/reviews/Google: edytowalne etykiety i tytuły (`faq_heading`, `reviews_heading`, `google_reviews.label`).
- **Rezerwacja:** teksty CTA (`contact.cta.*` + `section_label`) zawsze widoczne dla consultant; menu `nav.menu.booking`.
- **Kontakt:** `contact.title`; szablon `consultant.html` podpięty pod te pola (bez hardcoded „Częste pytania” / „Zaufanie” itd.).

### 2026-08-06 — Fix i18n: tłumaczenie ginęło przy zapisie + switcher

- **P0:** `_bindEditLocaleShim` po ustawieniu bufora EN (`content.pl = pack.en`) w pętli znów przypisywał `content.pl = pack.pl` → autosave/publish zapisywały polski klon jako `en`.
- **Consultant:** przełącznik PL|EN tylko robił `lang = …` w Alpine (URL zostawał `/`) — przy sklonowanym EN wyglądało jak „nic się nie zmienia”. Teraz linki `localeHref` (`/en`).
- Po deployu: **Przetłumacz AI ponownie** + **Opublikuj** (stare `content.en` mogło być już nadpisane PL).

### 2026-08-06 — Consultant: edycja sekcji proof w panelu

Brakowało UI do bloku z dużą liczbą na szablonie Consultant. Zakładka **„Efekty w liczbach”** (Więcej treści) — pola `proof.*` + `settings.showProof`; widoczna tylko gdy motyw ma sekcję `proof`.

### 2026-08-06 — i18n: tłumaczenie AI działa jak w SaaS (UX + bugfix)

User path „dodaję język → AI → nadal po polsku” wynikał z UX, nie z braku Edge:

- **Bug:** modal adapt wymagał niepustego promptu (`Generuj` disabled), choć adapt dopuszcza pusty kontekst; CTA mówiło „Generuj stronę”.
- **Bug:** `adaptLocaleWithAi` brał tylko `this.theme` (nie `wizardTheme`) i cicho wychodził bez toastu.
- **Bug:** link LIVE zawsze PL (`/`) — ignorował `editLocale` (`/en`, `/de`).
- **UX:** toggle „Tłumaczenie: AI” tylko ustawiał flagę sync — wyglądało jak „przetłumacz teraz”.
- **Fix:** checklista 1–4 na Dashboardzie; status per język + CTA **Przetłumacz AI**; overlay progress; po sukcesie Podgląd → Opublikuj; LIVE/podgląd honorują aktywny język.
- Kod: `i18nPanel.js`, `aiGenerator.js`, `adminApp.js` (URL), partials Dashboard / AI modal; `npm run build:admin`.

### 2026-08-06 — Consultant ≈ prywatny DFOPS (typografia + rytm)

- Odniesienie: prywatna strona (`dfops/index.html`) — Inter wszędzie (tech), hero `4xl→7xl`, CTA outline→fill z `--accent-contrast`, karty `bg-text/5` + `border-text/10`, `py-24`, duży solid CTA rezerwacji.
- Palety nadal przez tokeny; `font_preset=elegant` → Cormorant; inaczej Inter=serif+sans.

### 2026-08-06 — Fix consultant: kontrast CTA per palette

- CTA/ikony na akcencie używają `--accent-contrast` (`text-accent-contrast`), nie `text-sattva-white` (zawsze #fff — psuje Gold).
- Booking/contact: `surface-card` / `color-primary` tokeny; `themeStyling` bierze `presetPalette.text`.

### 2026-08-06 — Formularz Custom → Edge e-mail; consultant UX; fix i18n „meta”

- **`send-custom-inquiry`:** `zapytanie-custom.html` → POST (Turnstile); czyste SMTP (`SMTP_HOST`/`PORT`/`USER`/`PASS`, te same co Auth → SMTP — bez Resend) + Telegram ops. Auth SMTP w Dashboard nie jest współdzielony z Edge — secrets trzeba ustawić osobno.
- **Consultant:** ujednolicona typografia (serif nagłówki / sans body, jedna skala kolorów sattva); bez zmiany układu i teł.
- **i18n:** switcher w `consultant.html` używa `siteLocales()` — nie pokazuje klucza `meta`.

### 2026-08-06 — Custom domain: 2 kroki DNS + Worker SaaS `*/*`

- **Instrukcja panelu:** krok 1 = TXT ownership + CNAME www (**bez** A na `@`); po działającym www → krok 2 = 2× A. Powód: A na IP CF za wcześnie blokuje weryfikację TXT („hostname is using Cloudflare…”).
- **Ops CF for SaaS:** Fallback Origin + Worker router wymaga route **`*/*`** (nie tylko `dfcms.pl/*`) — inaczej custom hostname dostaje Error 522, bo ruch nie trafia do Workera. `proxy.dfcms.pl` originless / Worker `X-Forwarded-Host` → Pages.
- **Status:** `active` tylko gdy CF apex+www `status+ssl=active` (nie DoH).

### 2026-08-06 — Custom domain: TXT ownership + bez fałszywej zielonej OK

- **Problem:** panel oznaczał `active` gdy DoH widział A/CNAME (`dnsVerified`), mimo że Custom Hostname CF był Pending (`does not CNAME` / brak TXT) → Error 522 na www przy zielonej OK.
- **Fix Edge** `add-custom-domain`: SSL method `txt`; `custom_domain_status=active` tylko gdy **apex i www** mają `status+ssl=active`; payload `dnsInstructions`.
- **Fix panel:** amber pending + tabela DNS z tokenem z CF; zielona OK wyłącznie po `cfActive`.

### 2026-08-06 — Deploy security + hotfix cache panelu (zapis domeny)

- **Merged/deployed** PR #2 (freeze `custom_domain` + storage SELECT) na Staging i Production (`db push` + `functions deploy add-custom-domain`; `main` → `staging`).
- **Objaw po deployu:** stary panel jeszcze robił `PATCH pages.custom_domain` → `42501 permission denied` (grant już zdjęty).
- **Hotfix:** bump `adminApp.js` / `pageRepository.js` `?v=20260806a`; `pageRepository` stripuje `custom_domain*` z client UPDATE.

### 2026-08-05 — Security scan panelu admina (custom_domain + storage)

- **Finding High:** authenticated JWT mógł `UPDATE pages.custom_domain` / `custom_domain_status` (GRANT + brak triggera) — claim domeny bez Edge/Cloudflare.
- **Fix DB:** `protect_pages_custom_domain_columns` (`20260805120000_*`) — freeze jak billing; revoke UPDATE/INSERT tych kolumn dla `authenticated`.
- **Fix Edge** `add-custom-domain`: walidacja FQDN, blocklist domen platformy, gate planu Standard+, unik uniqueness, `clear: true`; zapis wyłącznie `service_role`.
- **Fix panel:** publish nie pisze `custom_domain*`; clear przy downgrade → Edge; verify → DNS + Edge (bez PostgREST write). (Status `active` od 2026-08-06: wyłącznie `cfActive`, nie DoH.)
- **Medium:** Storage `images` SELECT authenticated zawężony do własnych obiektów (`20260805121000_*`).
- **Deploy:** `db push` + `functions deploy add-custom-domain` na Staging, potem Production po merge.

### 2026-08-05 — Fix domeny: Error 1001 / SSL mismatch (dfops.eu)

- **Diagnoza:** DNS klienta OK (A + www CNAME), `pages.custom_domain` ustawione, ale CF Custom Hostname nieaktywny → HTTP 1001 / `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` (brak certyfikatu). `verify-domain` uznawał tylko CNAME na apex (po strip `www`), więc nigdy nie przechodził przy poprawnej instrukcji A+www.
- **Edge** `add-custom-domain`: rejestruje **apex i www**, przy 1406 pobiera stan hostname, PATCH odświeża SSL; zwraca `apex`/`www` status.
- **Pages** `verify-domain`: DoH A (oba IP) + CNAME `www` → `proxy.dfcms.pl` (oraz legacy CNAME na apex).
- **Panel:** jaśniejszy komunikat o obowiązkowym www; po deployu Edge: „Zapisz i sprawdź” ponownie, test najpierw `https://www.…`.

### 2026-08-04 — Własna domena: Edge CF + instrukcja A/A/CNAME

- **Panel** `verifyAndSaveDomain`: najpierw `functions.invoke('add-custom-domain')`, potem `/api/verify-domain`, potem zapis statusu `active`/`pending`.
- **Edge** `add-custom-domain`: shared CORS (`allowedOrigins`), właściciel lub superadmin (God Mode), idempotencja przy CF **1406** (duplicate), status DB `pending` (nie `pending_validation`).
- **UI**: dwa rekordy **A** (`172.67.154.121`, `104.21.66.9`) + **CNAME** `www` → `proxy.dfcms.pl`; alert MX/TXT; przycisk „Pokaż instrukcję DNS”.
- **Deploy:** `supabase functions deploy add-custom-domain` (staging, potem production) — sekrety `CF_ZONE_ID`, `CF_API_TOKEN`.

### 2026-08-04 — God Mode: edycja dem + kontrast UI
- **UI:** na liście dem **Zarządzaj** (obok Podgląd) → `admin.html?impersonate={slug}`; zapis po `pages.id`. Dema bez grantu/Checkout.
- **Kontrast:** izolacja od ciemnego gradientu `styles.css` (`html:has(body.god-shell)`); złote labele → `accent-ink`; pola formularza z jawnym `text-slate-900` / `bg-white`.

### 2026-08-04 — Fix: freeze kreatora (pętla Alpine $watch)

Deep `$watch('content')` + `markLocaleCopyDirty` → `ensureMeta` zawsze nadpisywał `meta.locales` nową tablicą → nieskończona pętla (UI nieklikalny). `ensureMeta` idempotentny; dirty-flag czyta meta bez mutacji.

### 2026-08-04 — Kreator UX, i18n AI/ręcznie, fix Storage staging

- **Staging upload:** brakowało bucketa `images` (był tylko na Prod) — migracja `20260804190000_ensure_images_storage_bucket.sql` + public SELECT; lepsze błędy uploadu (HEIC, sesja, MIME).
- **Kreator:** puste pola zamiast HTML z szablonu (`prepareWizardHeroStep` + plain text w `registry.js`); „Pomiń tę sekcję” (oferta / o nas); „Generuj z AI” przy polach tekstowych (`mode: field` w `generate-ai-content`).
- **i18n stron:** tryb `meta.translationMode` = `ai` | `manual`; przy dodaniu języka wybór AI/ręcznie; po zmianie PL pytanie o sync innych locale (przełącznik języka / publikacja). Panel admina zostaje PL (tłumaczenie przeglądarki OK).
- **AI copy:** prompt bez HTML w headline — plain text.

### 2026-08-04 — God Mode: konto klienta, grant ręczny, multi-site

Flow pracownika (superadmin): `god-provision-site` (invite email + strona + tryb planu), `god-grant-subscription` (grant/revoke z `expiresAt`), kolumna `billing_profiles.grant_source`, RPC `expire_manual_grants` w cronie `expire-trial-pages`. Panel: `hasManualGrantAccess` / `hasStripeLiveSubscription`; karuzela Checkout widoczna bez żywej sub Stripe (można podpiąć kartę przy grancie). Multi-site: load/save po `pages.id` + dropdown gdy >1 strona. FV godzinowe / one-time wdrożenie — poza systemem (ROADMAP).

### 2026-08-04 — Soft-block bez wycieku content

Po wygaśnięciu subskrypcji (`trial_blocked_at`) gość widział twarde 404, bo RLS + middleware ukrywały wiersz. Naprawa: RPC `get_public_site_route` (meta bez `content`) + middleware soft-block HTML (200) / preview szablonu bez SEO; `pageRepository.getPublicSiteRoute` + fallback w `publicSiteApp` / `routerApp`. RLS `pages_select_public` bez zmian — anon nadal nie czyta zablokowanego `content`.

### 2026-08-03 — Mapa: adres ręczny LUB firma Google

Panel Kontakt → dwa równorzędne sposoby: (1) wpisz adres + „Ustaw mapę z adresu” / blur → `embed_for_query`; (2) wyszukaj firmę → adres + `place_id` + embed. Podgląd iframe w panelu; surowy link embed w „Zaawansowane”.

### 2026-08-03 — Fix: upload zdjęć, AI Site Generator, mapa z adresu

- **Kompresja uploadu:** `js/core/imageCompress.js` — przed Storage downscale (logo ≤1024, hero ≤1920, galeria ≤1600) + WebP/JPEG; wywołanie w `adminApp.uploadImage`.
- **AI → tylko pola panelu:** `_shared/aiCopySchemas.ts` — usunięte `nav.cta`, `contact.cta`, `hero.subheadline`, `proof`/`footer` (brak edytorów); beauty services = priced jak w adminie; filtr „meta”/śmieci w `nav.logo`; `applyAiGeneratedSectionFlags` włącza `showServices` itd.; Edge czyści `meta.locales` do pl/en/de.
- **Po AI w panelu:** `aiGenerator.js` robi `normalizeContent`, otwiera zakładkę oferty.
- **Mapa bez firmy:** `get-google-reviews` + `embed_for_query`; blur pola Adres → `syncMapFromAddressField`; publish sync też z samego adresu.

### 2026-07-28 — Uniwersalne nazwy docs (agent context)

- Renames: `MASTER_CONTEXT.md` → `CONTEXT.md`, `PRODUCT_ROADMAP.md` → `ROADMAP.md`.
- Feature specs: `docs/specs/growth.md`, `docs/specs/i18n.md` (było `*_ARCHITECTURE.md` w korzeniu `docs/`).
- Eksport flow: `docs/architecture-flow.html` (+ skrypt PDF).
- Zaktualizowane odniesienia: README, `.cursor/rules/living-context.mdc`, skills, komentarze w JS/SQL/Edge.

### 2026-07-27 — Security hotfix Critical + High

Migracja `20260727180000_security_harden_crit_high.sql` + Edge + front:

- **C1:** `purge_trial_blocked_pages_after_grace` — EXECUTE tylko `postgres`/`service_role`.
- **C2:** trigger `protect_pages_billing_columns` — client nie zmienia `billing_plan` / `trial_*` / `purge_warning_sent_at`; panel nie czyści blokad przy publish.
- **C3:** usunięta polityka INSERT `billing_profiles` dla authenticated.
- **H2:** SELECT `pages` — anon publiczny; authenticated tylko owner (+ God Mode); zawężone GRANT kolumn.
- **H3:** Storage `images` ownership; upload `{user_id}/…`.
- **C4:** `telegram-webhook` + `TELEGRAM_WEBHOOK_SECRET`.
- **H1:** `returnUrl` / CORS via `_shared/allowedOrigins.ts` (bez `*.pages.dev`).
- **H4:** `GOOGLE_MAPS_EMBED_API_KEY` osobno od Places.
- **Ops Staging/Prod:** `secrets set` obu kluczy; Dashboard DB Webhook + Sentry → Bearer header; potem `db push` + `functions deploy`.
- **Wdrożone 2026-07-27:** migracja + Edge na Staging i Production; sekrety `TELEGRAM_WEBHOOK_SECRET` i `GOOGLE_MAPS_EMBED_API_KEY` ustawione. **Wymagane ręcznie:** w Dashboard (oba projekty) dodać nagłówek `Authorization: Bearer <TELEGRAM_WEBHOOK_SECRET>` do Database Webhooks i Sentry → `telegram-webhook` (bez tego alerty ops wrócą 401). Wartość secreta: `supabase secrets list` nie pokazuje plaintext — użyć lokalnie wygenerowanej przy deployu lub `secrets set` ponownie i zaktualizować webhooki.
- **Fix publish 403:** `protect_pages_billing_columns` → `SECURITY DEFINER` + detekcja po `auth.jwt()` (`20260727190000`, `20260727191000`) — INVOKER + przypisanie `billing_*` bez GRANT UPDATE blokowało Opublikuj.

### 2026-07-24 — UI platformy PL / EN (landing + auth)

Język **interfejsu SaaS** (nie treści witryn klientów):

- **SoT:** `localStorage` `dfcms_ui_locale` + opcjonalnie `?lang=en|pl`; startowa sugestia z `navigator.language` tylko gdy brak zapisu.
- **Przełącznik PL | EN** na landingu, rejestracji i ekranie logowania (`admin.html`).
- **Kod:** `js/core/uiI18n.js`, `js/i18n/uiPlatformCopy.js`; Alpine `t()` / `setUiLocale()`; cennik landingu z lokalizowanych planów.
- **Poza scope tej fali:** pełne tłumaczenie panelu CMS po zalogowaniu (nadal PL).

### 2026-07-24 — Fix: AI Generuj „nic się nie dzieje” + pętla `pages`

- **Confirm pod AI modalem:** dialog potwierdzenia miał niższy `z-index` niż modal generatora → po „Generuj” ekran wyglądał na martwy.
- **Pętla PATCH `pages`:** deep `$watch('content')` → autosave → `prepareContentForPersist` / `_bindEditLocaleShim` mutowały `content` → ponowny watch. Flaga `_suppressContentWatch`, skip autosave podczas `isGeneratingAi` / zapisu, bezpieczniejszy shim i18n.
- Front: commit `c8fd852` na `main` + `staging`.

### 2026-07-23 — Landing: Buduj z AI (sprzedażowy framing)

AI Site Generator na landingu jako **akcelerator konwersji**, nie jako produkt sam w sobie.

- **Hero:** H1 zostaje outcome („strona w kilka minut”); subcopy + trust bullet „Teksty napisze AI”; drugie CTA → `#demo`.
- **`#jak`:** krok 2 = „Opisz firmę — AI napisze”; krok 4 = „Zdobywaj klientów”.
- **Nowa `#ai`:** blok „Buduj z AI” (problem pustych pól → opis firmy → gotowe teksty) + mini demo Ty/AI + CTA trial.
- **`#korzysci`:** karta „Teksty z AI” zamiast „Prosty edytor”; nav „Buduj z AI”.
- **Cennik (`landingPricing.js`):** Starter/Standard — feature „Teksty z AI”.

### 2026-07-23 — Wielojęzyczność witryn (PL / EN / DE)

Spec: [`docs/specs/i18n.md`](specs/i18n.md).

- **Kontrakt:** `content.meta` (`defaultLocale`, `locales`) + top-level bloki `pl` / `en` / `de`; sync settings/kontaktu technicznego z default; `contentUpgrader` + `i18nContent.js` / `i18nLocales.js`.
- **URL / SEO:** middleware path `/en`, `/de`; `html lang` + `hreflang` + canonical; redirect gdy locale wyłączone; sitemap z prefixami; public `lang` z URL (nie `navigator.language`).
- **Panel:** przełącznik języka edycji (shim `content.pl`), Dashboard dodaj/usuń locale; gate Standard+ (`planMaxLocales` = 3).
- **AI:** `generate-ai-content` z `locale` + `mode: generate|adapt` (zlokalizuj z PL).

### 2026-07-23 — AI Site Generator (Gemini)

Generator copy dla płatnych planów: krótki opis biznesu → patch tekstów w `pages.draft_content` (bez nadpisywania LIVE `content`, settings, mediów, URL-i).

- **Edge** `generate-ai-content`: JWT, ownership (lub superadmin), gate planu, quota (`billing_profiles.ai_gen_month` / `ai_gen_count`), Gemini structured JSON (`gemini-3.6-flash`, override `GEMINI_MODEL`), retry 1× przy 5xx/timeout, kody błędów PL, logi prompt/response na staging.
- **Quota:** Starter (`tier0`) 10/mies., Standard/Custom 20/mies.; trial bez dostępu; God Mode omija gate/quota.
- **Schema SoT:** `_shared/aiCopySchemas.ts` (mirror pól copy z `registry.js`); merge whitelist + kontakt phone/email/address tylko gdy puste.
- **Panel:** `js/features/aiGenerator.js` (`DFOPS_attachAiGenerator`), przycisk na Dashboardzie, modal, toast z `remaining`; `planUtils` `DFOPS_planAllowsAiGenerator` / `DFOPS_aiGeneratorMonthlyLimit`.
- **Migracja:** `20260723190000_ai_generator_quota.sql`. Secrets: `GEMINI_API_KEY` (+ opcjonalnie `GEMINI_MODEL`, `DFCMS_ENV=staging|production`).
- **Checklist nowego motywu:** `registry.js` + `publishedThemes.js` + `aiCopySchemas.ts`.

### 2026-07-17 — Middleware: cisza 406 przy pustym lookup `pages`

Warningi API Supabase `GET /rest/v1/pages → 406` pochodziły z edge `fetchPageRow` (`Accept: application/vnd.pgrst.object+json` → PostgREST 406 przy 0 wierszach). Middleware traktował 406 jako „brak strony”, ale logi były zaśmiecone — m.in. apex `dfopscms.pages.dev` bez `?site=` szukał `custom_domain=eq.dfopscms.pages.dev`.

- **`functions/_middleware.js`:** `Accept: application/json` + `rows[0]`; bez slug DB tylko dla `isCustomDomainHost` (nie apex platformy / pages.dev).

### 2026-07-08 — Rejestracja: zajęty e-mail, polityka + powtórz hasło; samouczek ↔ kreator

Naprawa krytycznych UX przy logowaniu/rejestracji i pierwszym uruchomieniu.

- **Zajęty e-mail (`registrationApp.js`):** wcześniej anty-enumeracja Supabase (dla istniejącego adresu `signUp` zwraca „usera” bez sesji) była traktowana jak sukces → „Sprawdź skrzynkę”. Teraz wykrywamy zajęty adres po `user.identities.length === 0` (brak sesji) i pokazujemy błąd „adres zajęty — zaloguj się / nie pamiętam hasła”. Usunięto fałszywie pozytywną ścieżkę „slug zajęty → sukces”.
- **Polityka + powtórz hasło (`rejestracja.html` + `registrationApp.js`):** dodane pole „Powtórz hasło” (walidacja zgodności na żywo) oraz live-checklist polityki (min. 8 znaków, litera, cyfra) — spójna z wymuszonym resetem w panelu (wcześniej rejestracja miała tylko `min 6`). Przycisk „Utwórz konto” zablokowany do spełnienia polityki i zgodności. Bump `registrationApp.js?v=20260708a`.
- **Samouczek ↔ kreator (`adminApp.js`):** samouczek (Driver.js) już **nie miga** kreatorem (usunięte otwieranie/zamykanie wizard step0/paths w trakcie touru). Tour = orientacja po panelu (podgląd, menu, kreator, subskrypcja), a na końcu (`onDestroyed` → `openWizardForBuilding()`, przycisk „Przejdź do kreatora →”) ląduje w kreatorze na kroku 1 — user od razu buduje stronę. `dismissWelcomeModalAndStartOnboarding()` startuje tour na dashboardzie bez otwartego kreatora. Zaktualizowany copy modala powitalnego (`admin.html` + `admin/partials/07-modals-checkout-welcome.html`). Bump `adminApp.js?v=20260708a`.
- **Uwaga (nie nasz bug):** błędy w konsoli `background.js … FrameDoesNotExistError`, `DelayedMessageSender`, „Extension manifest must request permission”, `runtime.lastError` pochodzą z **rozszerzenia przeglądarki** (scraper), nie z DFCMS — znikają w trybie incognito bez rozszerzeń.

### 2026-07-05 — Landing `index.html`: restrukturyzacja sekcji i copy

Przepisany marketingowy landing pod konwersję. **Bez zmian w designie** — te same kolory (dark + złoto `#D4AF37`), Inter, klasy Tailwind, Alpine (`landingPricing()`) i skrypty routingu/SEO.

- **Flow sekcji:** Hero → Jak to działa (4 kroki: szablon → opis+AI → publikacja → klienci) → Buduj z AI (`#ai`) → Co dostajesz (6 korzyści, w tym Teksty z AI) → Panel i statystyki (`#panel`) → Integracje → Przykłady (`#demo`) → Święty spokój (`#spokoj`) → Cennik → CTA.
- **Nawigacja:** desktop (xl+): `#jak`, `#ai`, `#demo`, `#cennik` + „Zaloguj” przy CTA; poniżej xl hamburger z pełną listą (`#korzysci`, `#panel` też). CTA skrócone do „Uruchom za darmo”.
- **Copy realistyczne:** „gotowa w kilka minut”, trial 14 dni bez karty, AI generuje teksty z opisu firmy (pełna kontrola edycji), własną domenę podłączasz sam (możemy pomóc), hosting+SSL+aktualizacje w cenie.

### 2026-07-05 — Szybki czat: predefiniowane pytania

FAB WhatsApp/Messenger dostaje rozwijaną listę gotowych pytań; klient wybiera pytanie i czat otwiera się z wpisaną treścią.

- **Kontrakt treści:** `pl.contact.quick_chat_questions` — `string[]` (limit 12). Default `[]` w `createPublicContentShell` (`publicSiteApp.js`) i `createAdminContentShell` (`adminApp.js`); normalizacja/trim/filter/slice(12) w `contentUpgrader.js` (`ensureContactCta`). Zapis całego `content` (bez whitelisty) → pole trwałe.
- **Front (`publicSiteApp.js`):** stan `quickChatOpen`/`quickChatCopied` + metody `quickChatQuestions()`, `quickChatHasQuestions()`, `quickChatSupportsPrefill()` (WhatsApp), `quickChatHrefForText(text)` (`wa.me/<digits>?text=…`), `toggleQuickChat()`, `onQuickChatQuestion(text)`, `copyQuickChatText()`. **Messenger (`m.me`) nie wspiera pre-fillu treści** → pytanie kopiowane do schowka + toast „wklej w Messengerze”. Brak pytań = zachowanie jak dawniej (klik = link do czatu).
- **UI FAB:** przebudowany blok w `templates/{beauty,consultant,fitness,services,gastro,care}.html` + `_base_template.html` + `_partials/quick_chat_fab.html` (8 kopii, ręcznie zsynchronizowane). Dodano popover z listą, tło zamykające, toast, `aria-haspopup`/`aria-expanded`, Escape zamyka.
- **Panel (Kontakt → Szybki czat):** edytor listy pytań (`admin/partials/tab-contact.html`) — dodawanie/usuwanie/edycja + podpowiedzi per motyw. Metody `quickChatQuestionSuggestions()`, `addQuickChatQuestion(preset)`, `removeQuickChatQuestion(index)` w `adminApp.js`; gated tym samym `isQuickChatLocked`. `npm run build:admin`.

### 2026-07-05 — WhatsApp / Messenger na planie Starter

- **`js/core/planUtils.js`:** `DFOPS_planAllowsQuickChat` zwraca `true` dla wszystkich planów (wcześniej blokada `tier0`). Odblokowuje pola w panelu (Kontakt → Szybki czat), FAB na stronie publicznej i regułę `whatsapp_available` w Silniku Wzrostu. Decyzja produktowa tymczasowa („póki co”).

### 2026-07-05 — Zakładka „Statystyki” (Faza A+B: zakres dat + unikalne + eksport)

Rozszerzenie analityki poza dashboard, w tym samym wzorcu Lite Hexagonal (moduł poza monolitem).

- **DB:** `supabase/migrations/20260705030000_growth_stats_range.sql` — nowy RPC `get_page_stats_range(p_page_id, p_from, p_to)` (SECURITY INVOKER, `STABLE`): zwraca `{ event_name: { total, unique } }` dla dowolnego okna `[p_from, p_to)`; `NULL` = brak granicy (all-time / do teraz). `unique = count(distinct visitor_key)` = unikalni **dziennie** (świadoma decyzja pro-RODO — `visitor_key` to hash IP+slug+dzień). Osobny od `get_page_growth_stats` (dashboard, okno 7 dni + `draft_stale_days`). GRANT tylko `authenticated`, chroniony istniejącą polityką `analytics_events_owner_select_conversion` (obejmuje `conversion` + `visit`).
- **Adapter DB:** `js/features/growth/growthRepository.js` — `fetchStatsRange(pageId, fromISO, toISO, client)` woła nowy RPC (bump `?v=20260705b`).
- **Moduł (poza monolitem):** `js/features/growth/statsPanel.js` — `window.DFOPS_attachStatsPanel(app)`: presety (7/30/90 dni, Od zawsze, własny zakres), `resolveStatsRange()`, `loadStatsRange()` (leniwe — owija `setTab`, ładuje przy 1. wejściu w zakładkę), `statsMetricRows()`, `exportStatsCsv()` (CSV: BOM UTF-8 + separator `;`, otwiera się w polskim Excelu bez konfiguracji; native `.xlsx` dopiero jeśli będzie potrzebny), znaczniki czasu odświeżenia.
- **UI:** nowy partial `admin/partials/tab-stats.html` (presety, datepickery custom, tabela Metryka/Wszystkie/Unikalne, „Odśwież”, „Eksport (Excel)”), wpis w `admin/manifest.json` (po `tab-dashboard`), pozycja „Statystyki” w `admin/partials/12-sidebar.html` (pod „Twoja strona”), import `statsPanel.js` w `01-head.html`; `npm run build:admin`.
- **Monolit — 2 linie wiązania:** `adminApp.js` — `'stats'` w `ADMIN_TAB_IDS` (deep-link/hash) + wywołanie `DFOPS_attachStatsPanel(fromApp)` w `buildAdminAlpineState()` obok growth (bump `?v=20260705b`). Zero logiki analityki w monolicie.
- **Region:** świadomie pominięte (wymaga GeoIP w Edge + migracja kolumny + klauzula RODO, działa tylko „od teraz”) — backlog.

### 2026-07-05 — Silnik Wzrostu: implementacja G0–G3 (Lite Hexagonal)

Wdrożenie wg [`docs/specs/growth.md`](specs/growth.md) — **wdrożone na Staging i Produkcję (2026-07-05).**

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

### 2026-07-16 — SEO: robots.txt + host-aware sitemap.xml (Pages Functions)

- **`functions/robots.txt.js` + `sitemap.xml.js` + `_shared/requestHostname.js`:** file-based routing per host; cache 24h; wspólna resolucja Host jak middleware.
- **Działa dziś na edge z prawdziwym Host:** apex `dfcms.pl` (robots + pełna sitemapa marketingowa) oraz domeny klientów podpięte tak, że worker widzi publiczny hostname (Custom Hostname / custom domain w Pages).
- **Ograniczenie infra (smoke 2026-07-16):** bez wildcard `*.dfcms.pl` w Cloudflare Pages requesty na `{slug}.dfcms.pl` / `staging.dfcms.pl` dochodzą do workera jako `Host=dfopscms.pages.dev` (kandydaci: tylko ten host; `x-dfcms-debug: FAIL[NO_ROW|…|host:[dfopscms.pages.dev]]` na HTML). W tym trybie: robots → `Allow` + Disallow panel **bez** linii `Sitemap:` (żeby nie noindexować tenantów); sitemap → **puste urlset** (żadnych URL-i `pages.dev` w indeksie). Per-tenant `Sitemap:` + `<loc>` wraca dopiero po dodaniu `*.dfcms.pl` w Pages (TO-DO już w lukach §1).
- **Wdrożone:** `git push` staging + main.

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

- **Dokument:** [`docs/specs/growth.md`](specs/growth.md) — plan wdrożenia Growth Autopilot dla agentów: fazy G0–G4, rozszerzenie `analytics_events` + `growth_benchmarks`, Edge Functions, `growthRules.js` / `siteAnalytics.js`, integracja z `themeConfig`, dashboard, RLS, checklist plików i testów.
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
3. Plany post-MVP → [`ROADMAP.md`](ROADMAP.md).
