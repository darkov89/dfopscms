# DFCMS — stan projektu i kontekst trwały

> **Przeznaczenie:** jeden plik w korzeniu repozytorium do aktualizacji **na koniec sesji** (ludzie + agenci), żeby zachować ciągłość decyzji architektonicznych, produktowych i operacyjnych.  
> **Nie zastępuje** `README.md` (start, deploy, struktura katalogów), ale je **uzupełnia** o „co wiemy o systemie teraz”.

**Ostatnia aktualizacja treści:** 2026-06-05 — porządek repo (`data/seeds/`, docs); wFirma + Checkout (adres/NIP)

---

## 1. ARCHITEKTURA

### 1.0 Infrastruktura wielośrodowiskowa (stan po rewolucji 2026-06)

| Obszar | Staging | Production |
|--------|---------|------------|
| **Git** | gałąź `staging` | gałąź `main` |
| **Frontend** | Cloudflare Pages — `staging.dfcms.pl`, preview `*.pages.dev` | Cloudflare Pages — `dfcms.pl`, subdomeny `{slug}.dfcms.pl` |
| **Supabase** | projekt `asxrsdsprrbvjvgcsckh` — Auth, DB, Storage, Edge | projekt `tawywecinkubmouyprab` |
| **Stripe** | **Test mode** — Checkout Sessions, osobne Secrets `STRIPE_*` | **Live mode** — osobne ceny i webhook |
| **Domeny klientów** | testowe Custom Hostnames (token staging w Secrets) | **Cloudflare for SaaS** — Edge `add-custom-domain` |
| **Workflow DB** | `supabase db pull` ze Stagingu → migracje w repo | `supabase db push` na Production po merge do `main` |
| **Lokalny dev** | **bez** `supabase start`; `npm run dev` + `config.js` → API **Staging** na localhost | — |

Szczegóły diagramów i deploy: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`WORKFLOW.md`](WORKFLOW.md).

### 1.1 Co jest w produkcie (krótko)

| Warstwa | Technologie / artefakty |
|--------|-------------------------|
| **Front publiczny** | Statyczne HTML: **`index.html`** — landing (Tailwind + Alpine): **#cennik** — 3 pakiety (**Starter**, **Standard**, **Premium** na zamówienie) + przełącznik **mies./rok (−20%)** (`js/features/landingPricing.js`, Alpine `billingInterval`); CTA Starter/Standard → **`rejestracja.html`**, Premium → **`zapytanie-custom.html`** / `mailto:kontakt@dfops.eu`. Sekcja **Demo na żywo** (linki `?site=demo-beauty|demo-fitness|demo-services` → `router.html`); **`router.html`** — wejście do routingu wielodomenowego; szablony publiczne m.in. **`beauty.html`**, **`consultant.html`**, **`fitness.html`**, **`services.html`**. **Lokalny dev (localhost / 127.0.0.1):** gdy w `pages` nie ma wiersza dla tych slugów, **`pageRepository.getPageBySlug`** zwraca treść z **`data/seeds/demo_pages.json`** (bez Supabase). **`routerApp.js`:** po załadowaniu strony z bazy → redirect do **`{pages.theme}.html`** (`?site=` na hoście systemowym). JS: `publicSiteApp.js`, **`cookieConsentApp.js`** (banner zgód, `DFOPS_getStoredCookieConsent`), `routerApp.js`. **Analityka (opcjonalnie):** w treści **`content.pl.settings.analytics`** — **`gtm_id`**, **`fb_pixel_id`** (walidacja przy zapisie w **`pageRepository`**: GTM jak `GTM-…`, Pixel cyfry). **Google Tag Manager** wstrzykiwany tylko po zgodzie **Analityczne**; **Meta Pixel** po zgodzie **Marketingowe**; **`DFOPS_injectClientAnalytics`** / **`consent-updated`** (`publicSiteApp.js`). Brak wstrzyknięcia w **iframe**, przy **`?dfcms_preview=1`** (podgląd z panelu) oraz na zablokowanej stronie trialowej. **Demo katalogowe bez Google Places:** przy **`content.pl.settings.is_demo_catalog`** i pustym **`google_reviews.place_query`** karuzela opinii bierze dane z **`content.pl.reviews`** (`js/features/googleReviewsApp.js`); ten sam warunek steruje widocznością linku/sekcji **Opinie** w **beauty / fitness / services**. **Mapa:** w seedach ustawione **`contact.map_embed_url`** (Google Maps z `output=embed`); walidacja zapisu w **`pageRepository.isGoogleMapsEmbedHttpsUrl`** (HTTPS + host `*.google.com` + ścieżka **`/maps/embed`** *lub* **`/maps`** z query **`output=embed`**). Legacy **`landing.html` usunięty**. Roadmap szablonów: **`gastro`**. **Cloudflare Pages** + `functions/_middleware.js` (SEO). |
| **Panel CMS** | `admin.html`, **Alpine.js**, **Tailwind** (CDN), `js/features/adminApp.js`. **Subskrypcja — cennik:** przełącznik **`billingInterval`** (`monthly` \| `yearly`); ceny UI Starter **29 zł/msc** (rocznie 278,40 zł/rok, −20%); Standard **49 zł/msc** (470,40 zł/rok); **`subscribe('starter'|'standard')`** wysyła `interval` + `plan` do **`create-checkout`**; **Custom** — tylko **`zapytanie-custom.html`** (bez Checkout). Usunięty produktowy pakiet **Premium** (dawny `tier2`); w panelu nazwy: **Starter / Standard / Custom**. **Sidebar (lg):** `sticky`, bez sztywnego paska przewijania na desktopie (`.dfops-admin-sidebar-scroll` — scroll tylko w mobilnym drawerze); nagłówki **Treść** / **Konfiguracja** — `.dfops-sidebar-section-title` w `css/styles.css`. **Top bar:** jeden przycisk **Publikuj zmiany** z `title` (bez tekstu „Publikuj na żywo” i ikony info). **Subskrypcja (UI):** karty `.dfops-plan-card`, funkcje w `<details>` („Zobacz pełną listę funkcji”), równe wysokości na `xl`. **Subskrypcja:** **Warunki rozliczeń** w `<details>` (`#dfops-platnosci-info`; link **Warunki** w headerze otwiera accordion); synchronizacja Stripe bez wyświetlania `sub_…` w panelu. **Onboarding:** jeśli w `pages.content` jest **`welcome_onboarding_completed: true`**, modal powitalny + **Driver.js** i pełnoekranowy kreator nie uruchamiają się (stan z localStorage kreatora jest czyszczony); automatyczne domknięcie checklisty ustawia też **welcome** przy zapisie. **Subskrypcja:** przycisk **Starter** woła od razu **`subscribe('starter')` → Edge `create-checkout`** (bez `confirm` i sztucznego stanu „oczekiwanie”). **SEO i Analityka** (zakładka `seo`): meta / OG / social oraz pola **GTM ID** i **Meta Pixel ID** → `content.pl.settings.analytics`. Link **Podgląd strony** dokleja **`?dfcms_preview=1`** (**`getPublicSiteUrl`**) żeby nie liczyć analityki z edycji. **Motyw strony** — kolumna `pages.theme` + lustrzanie `content.pl.settings.theme` (normalizacja + zapis). **Wygląd → Zmiana motywu branżowego:** kafelki szablonów (`DFOPS_getTemplateCatalog` w `registry.js`), `switchTemplate` (beauty / consultant / fitness / services); merge treści: `DFOPS_mergeContentWithTemplate` + **`DFOPS_resolveTemplateKeyForMerge`**. **Sidebar zależny od motywu:** m.in. **Grafik zajęć** (`schedule[]`, tylko fitness), **Zaufanie** (`trust` + `showTrust`, tylko services); **`ensureActiveTabForTheme()`** — po zmianie motywu nie zostaje otwarta ukryta zakładka. **Etykiety menu** — bloki Beauty / Konsultant / Fitness / Usługi w **Szablon i kolory → Marka**. **Pasek postępu:** `calculateProgress()`. **Subskrypcja:** kafelek **Stripe Customer Portal** pokazuje się przy **`showStripeBillingPortal`** (`hasActivePaidSubscription` *lub* **`stripe_customer_id`** + status anulowania — faktury/anulowanie po wygaśnięciu); przy braku portalu krótka informacja o pojawieniu się po pierwszej zaksięgowanej płatności. Porównanie **3 kart ofert** (Starter, Standard, Custom) — siatka od breakpointu **`xl`** (`xl:grid-cols-3`), przy węższym viewport nadal poziomy scroll + strzałki; karty: wspólna wysokość wiersza (`grid-auto-rows` + `min-h-0`), CTA z jednolitą minimalną wysokością. Szablony: `js/templates/registry.js`; normalizacja: `js/core/contentSchema.js`, `js/core/contentUpgrader.js`; style publiczne: `js/core/themeStyling.js` + `config.js` (`presetsByTheme`, `accentByPreset`). |
| **Backend danych** | **Supabase**: PostgreSQL (`pages` + treść JSON), **Auth** (JWT), **Storage** (obrazy), RLS. **Rozliczenia:** `billing_profiles` + lustrzane `pages.billing_plan` (schemat w baseline **`20260603072317_remote_schema.sql`**). **Demo:** [`data/seeds/demo_pages.json`](data/seeds/demo_pages.json) — lokalny fallback; w bazie slugi `demo-*` z `tier1` + `payment_completed`. Klient: `supabaseClient.js`, `pageRepository.js`, `billingProfileView.js`. |
| **Backend logiki płatności / domen** | **Supabase Edge Functions** (Deno): webhook Stripe, Checkout, Portal, sync subskrypcji, domeny (Cloudflare), Google Reviews, cron trial. Zmiana planu wyłącznie przez **Customer Portal** (`create-portal-session`, deep link `flow_data.type=subscription_update` + `subscription_id`). Współdzielona logika: `supabase/functions/_shared/stripeBilling.ts`. |
| **Płatności** | **Stripe** (Checkout, Customer Portal, webhooks → Edge). **Płatne w Checkout:** Starter (`tier0`), Standard (`tier1`) — miesięcznie lub rocznie. **Custom:** poza Stripe (formularz). **Secrets (prod):** `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_STARTER_YEARLY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_YEARLY` (nazwa env „PRO” = plan Standard). **Fallback dev:** `js/core/config.js` → `stripePrices`. **Mapowanie tierów:** `tierFromStripePrice` / `normalizeStripePaidTier` w **`stripeBilling.ts`** — ceny roczne = ten sam tier co miesięczne; brak `STRIPE_PRICE_PREMIUM`. **Checkout vs portal:** `subscribe()` → portal tylko gdy `stripe_customer_id` + status **`active` \| `trialing` \| `past_due`**; w pozostałych przypadkach **`create-checkout`** (reuse `customer`, bez `customer_email`). Panel: **`billingProfileReady`** / **`panelBootLoading`** — render po `loadBillingProfile`. |

### 1.2 Przepływ danych (uproszczony)

```
Użytkownik → Auth (Supabase) → pages.content (JSON) + pages.billing_plan + billing_profiles
                    ↓
            create-checkout (plan, interval) → Stripe Checkout
                    ↓
            stripe-webhook / sync-stripe-subscription → billing_profiles (SoT) + pages.billing_plan + trial_* w content
                    ↓
            Panel: loadBillingProfile() → billingProfileView.js → planUtils (tier0/tier1)
                    ↓
            Opcjonalnie: add-custom-domain → Cloudflare Custom Hostnames → pages.custom_domain
```

### 1.3 Szablony branżowe (skalowanie)

- **Źródło prawdy motywu:** `pages.theme` (Supabase); JSON: `content.pl.settings.theme` synchronizowany przy `normalizeContent` / `saveData`.
- **Gotowe publiczne HTML + szablon w `registry`:** `setup`, `beauty`, `consultant`, **`fitness`** (`content.pl.schedule[]`), **`services`** (m.in. `trust`, galeria, FAQ, Google Reviews).
- **Roadmap UI:** kafelek **`gastro`** (i ewent. kolejne) bez pełnej definicji → toast „w przygotowaniu”; dla brakującego `.html` podgląd localhost może używać proxy (`beauty.html`), aż do dodania pliku.

### 1.4 Luki i obszary do domknięcia (audyt)

| Obszar | Status / uwagi |
|--------|----------------|
| **Testy automatyczne** | Brak widocznego zestawu E2E/unit w repo jako obowiązkowego gate’a — ryzyko regresji przy zmianach w `adminApp` i Edge. |
| **CI/CD** | Front: **Cloudflare Pages** (build z GitHub `staging` / `main`). Baza + Edge: **Supabase CLI** (`db push`, `functions deploy`) — ręcznie per środowisko; brak GitHub Actions w repo. Proces: [`WORKFLOW.md`](WORKFLOW.md). |
| **Observability** | Logi Edge/Deno + Stripe Dashboard; `telegram-webhook`: router Sentry → Supabase Database Webhooks (`users`, `pages`, `billing_profiles`) → Log Alerts → fallback → Telegram. |
| **i18n** | Panel i treści głównie **PL**; szablony pod wielojęzyczność w modelu `content.pl` — pełne i18n nie są domknięte w UI. |
| **RLS / anon read** | Wiersze demo mają **`user_id` NULL**. **`GRANT SELECT`** dla `anon` na tabeli (migracja explicit grants) + polityka RLS **`SELECT`** po `slug` — bez obu warstw podgląd z landingu zwróci pustkę. |
| **Wersjonowanie treści / audit** | Pojedynczy JSON `content` na stronę — brak historii wersji w produkcie. |
| **API poza Supabase** | Brak osobnego BFF; cała logika „biznesowa” w JS klienta + Edge Functions. |
| **Bezpieczeństwo treści** | Sanityzacja przy zapisie strony (`pageRepository.sanitizeContent` + DOMPurify w panelu) — patrz sekcja SECURITY. Pola **mapy:** dozwolony iframe URL tylko dla hostów Google z **`/maps/embed`** lub klasycznego **`/maps?…&output=embed`**. **`gtm_id` / `fb_pixel_id`:** wyłącznie zweryfikowany format ID (bez wklejek pełnego skryptu). |

---

## 2. STATUS PŁATNOŚCI

### 2.0 Model pakietów (stan po refaktorze 2026-05-23)

| Oferta (UI) | Stripe / DB | Domena | Checkout |
|-------------|-------------|--------|----------|
| **Starter** | `tier0` | subdomena `.dfcms.pl` | tak (mies./rok) |
| **Standard** | `tier1` | własna `.pl` / `.com` | tak (mies./rok) |
| **Custom** (panel) / **Premium** (landing marketing) | — | indywidualnie | nie — `zapytanie-custom.html` |

- **Ceny netto (UI):** Starter 29 zł/msc lub 278,40 zł/rok; Standard 49 zł/msc lub 470,40 zł/rok (−20% przy roku). Landing i panel pokazują te same kwoty.
- **Legacy:** dawny pakiet Premium (`tier2`, 99 zł) **usunięty z produktu**; istniejące `tier2` w DB zmapowane na `tier1` (migracja + `normalizeStripePaidTier` / `DFOPS_normalizePlan`).

### 2.1 Webhook, sync i Checkout

- **Webhook Stripe** (`supabase/functions/stripe-webhook/`): weryfikacja podpisu przez **`stripe.webhooks.constructEventAsync`** (async, Deno). Po **`checkout.session.completed`**: opcjonalnie **wFirma** (`_shared/wfirmaBilling.ts`) — faktura B2B (NIP z `customer_details.tax_ids`) lub B2C (`bill`), wysyłka `/invoices/send`; błąd wFirma **nie** blokuje zapisu w Supabase. Secrets: `WFIRMA_ACCESS_KEY`, `WFIRMA_SECRET_KEY`, `WFIRMA_APP_KEY`, opcj. `WFIRMA_COMPANY_ID`.
- **Obsługiwane zdarzenia:** m.in. `checkout.session.completed`, `customer.subscription.updated` / `deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- **`create-checkout`:** body `plan`, `interval`, `returnUrl`; cena z Secrets `STRIPE_PRICE_*`. **Returning customer:** odczyt `billing_profiles.stripe_customer_id` → `customer` (bez `customer_email`); nowy klient → `customer_email`. Zawsze `client_reference_id` + `metadata.supabase_user_id`. **`upsertBillingProfile`:** `onConflict: user_id` + zwolnienie starych unikalnych `stripe_*_id` na innych wierszach (renew bez kolizji). **Dual SoT (architektura):** `billing_profiles` = Stripe (plan, status, IDs); `pages.trial_blocked_at` / `billing_failed_at` / `billing_plan` = szybki odczyt anon (router, cron). Po płatności webhook czyści `pages`; **cron `expire_trial_pages`** nie blokuje gdy `billing_profiles.status` ∈ active/trialing lub `pages.billing_plan` ∈ tier0/tier1 (migracja `20260524120000`). **Dual SoT `pages`:** `syncPageBillingMirrorFromProfile` po upsert. **Zombie webhooks / kolejka:** `killZombieSubscriptionEvent`; `applySubscriptionCanceledToPage` + `stripeCustomerHasLiveSubscription` + `healPageBlocksIfBillingProfileLive`; logi `stripe-webhook-queue`. **Faktury:** `extractInvoiceSubscriptionId` / `resolveInvoiceSubscriptionId` (Basil `parent.subscription_details`). **Sync:** `clearPageBillingBlocksForPaidUser` przy active/trialing. **409 `HAS_STRIPE_SUBSCRIPTION`** tylko gdy w `billing_profiles` jest żywa sub (`status` active/trialing/past_due/unpaid/paused/incomplete) — po `canceled` / `incomplete_expired` można ponownie Checkout (stare `stripe_subscription_id` w DB nie blokuje).
- **Współdzielone:** `readStripePriceEnv()`, `applyOptsFromPriceEnv()`, `tierOverrideFromPriceId()` w **`stripeBilling.ts`**; importy Edge: **`npm:stripe@^14`**, **`npm:@supabase/supabase-js@^2.39`**.
- **Źródło prawdy rozliczenia:** tabela **`billing_profiles`**; w **`pages.content`** tylko pola trial (`trial_started_at`, `selected_plan`, opcjonalnie `payment_completed`). Okres subskrypcji: **`Stripe.Subscription.current_period_end`** (nie `invoice.period_end` jako SoT).
- **Anulowanie natychmiastowe (fix):** `subscription.updated` ze statusem `canceled` → `trial_blocked_at` + blokada publiczna; panel nie ufa samemu `payment_completed` w trial (`publicSiteApp`, `hasActivePaidSubscription`).
- **Rezygnacja na koniec okresu (`cancel_at_period_end` / `cancel_at`):** przy statusie **`active`/`trialing`** i zaplanowanym zamknięciu plan w CMS pozostaje płatny do **`current_period_end`**; panel pokazuje status *wygasający* (`isSubscriptionCanceledButValid`, **`planUtils.js`**). **`hasActivePaidSubscription`** nie ufa samemu `plan: tier*` po statusie **`canceled`** w Stripe. Wejście w zakładkę **Subskrypcja** — jednorazowy silent **`sync-stripe-subscription`** (świeży JSON). Edge: **`subscriptionScheduledToCancelStripe`** w **`stripeBilling.ts`**. **Widok publiczny nie jest blokowany samą tą flagą** — `publicSiteApp.shouldBlockPublicPageView` i blokady `trial_blocked_at` nie sprawdzają `cancel_at_period_end`; goście tracą dostęp dopiero po faktycznym zakończeniu rozliczenia w Stripe (webhook → m.in. `canceled` / brak płatności), zgodnie z dotychczasowymi regułami trial i `billing_failed_at`.
- **Cykle rozliczeniowe:** patrz §2.0; wdrożone w panelu, landingu i Edge (prod: funkcje `create-checkout`, `stripe-webhook`, `sync-stripe-subscription` wdrożone CLI).
- **Tryb demo / konfiguracja:** `config.js` + Secrets Supabase; produkcja: spójny webhook Stripe i Redirect URLs.

### 2.2 Wygasły trial — widok publiczny i retencja

- **Kolumna `pages.trial_blocked_at`:** ustawiana przez cron (`expire_trial_pages()` → Edge `expire-trial-pages` + `CRON_SECRET`). Bez działającego cronu strona mogła pozostawać widoczna mimo „0 dni” w panelu.
- **Front publiczny (`publicSiteApp.js`):** dodatkowo **`shouldBlockPublicPageView(page)`** — ta sama logika co SQL (14 dni od `trial_started_at`, brak `payment_completed`, plan `trial` lub `tier0`; oraz 14 dni po `billing_failed_at`). Ukrywa treść **od razu** po wejściu, bez czekania na cron. Dla odwiedzających komunikat blokady jest **neutralny** (prace techniczna / aktualizacja), bez wzmianki o płatnościach; opcjonalny trzeci akapit (`trialBlockedAdminHint`) domyślnie pusty. Pełne zamknięcie dostępu do JSON po stronie API wymagałoby zaostrzenia RLS (TODO).
- **`getPageBySlug`** zwraca też **`billing_failed_at`** do powyższej walidacji.
- **Usuwanie po 30 dniach:** funkcja **`purge_trial_blocked_pages_after_grace()`** — `DELETE` z `pages`, gdzie `trial_blocked_at` ≤ teraz − 30 dni. Wywoływana z tego samego Edge co `expire_trial_pages` (odpowiedź JSON zawiera `purged_after_grace_days_30`). **Migracja:** `20260404120000_purge_trial_blocked_pages_after_grace.sql`.
- **Wdrożenie na produkcję (Supabase):** migracja zastosowana przez **`supabase db push`**; funkcja Edge **`expire-trial-pages`** wdrożona przez **`supabase functions deploy expire-trial-pages`** (stan na 2026-04-03).

---

## 3. ONBOARDING

- **Modal powitalny** (`showWelcomeModal`): pełnoekranowy, styl „quiet luxury”; warunek pokazania oparty o `content.pl.settings` (`welcome_onboarding_completed` + migracja w `normalizeContent` dla starych treści).
- **Pole „nazwa marki”** (`content.pl.settings.business_name`) + pierwsze pole w zakładce powitalnej.
- **Driver.js** (CDN `1.4.0`): tour po zamknięciu modala — **najpierw pełnoekranowy start kreatora** (krok 0: ścieżki), potem podgląd w nagłówku, **kategorie menu** (Treść, Konfiguracja, Subskrypcja); `disableActiveInteraction` — bez wypełniania pól w trakcie touru; pola hero/logo w Studiu nie są już krokiem (sens po wyborze szablonu).
- **Pełny kreator** (wizard): na czas samouczeka otwierany z modala (**krok 0**); poza tym **nie** uruchamia się automatycznie po wejściu; dostęp z menu. **Krok 1 — wybór szablonu:** **Beauty**, **Konsultant**, **Fitness** (`wizardTheme`; walidacja `WIZARD_TEMPLATE_IDS` w `adminApp.js`). **`normalizeWizardRestore`** synchronizuje motyw kreatora z **`pages.theme`**, gdy motyw jest już ustawiony w bazie (np. po zmianie w Wyglądzie). **Stan UI** (`wizardStep`, `wizardTheme`) w **`localStorage`** (`dfops_wizard_state_v1:{slug}`); **czyszczenie** po `finishWizard` oraz po **`switchTemplate`** (zmiana szablonu w Konfiguracji → Wygląd), żeby uniknąć przywrócenia starego kroku po `reload`. **Zmiana szablonu (`switchTemplate`):** merge z nowym szablonem zachowuje m.in. **`welcome_onboarding_completed`** i **`onboarding_completed`** (jeśli były `true`) — bez ponownego modala powitalnego i samouczka po publikacji motywu. **„Wrócę później”** zamyka kreator **bez** kasowania stanu LS (oprócz scenariusza wyżej). **„Dalej”** → walidacja → **`saveData`** → następny krok. Zamknięcie bez ukończenia kreatora **nie** ustawia `onboarding_completed` — checklista podstaw z **!** jak wcześniej.
- **Treść utrwalona w DB:** m.in. `welcome_onboarding_completed`, `business_name`, `onboarding_completed` w `pages.content`.

---

## 4. SECURITY

- **Forced password reset:** link recovery (`type=recovery`) → `exchangeCodeForSession` → **`isForcedPasswordReset`** — izolowany UI bez `loadData()` do czasu ustawienia hasła; po sukcesie **logout** i powrót na logowanie (`admin.html`).
- **Polityka hasła w izolatce:** min. 8 znaków, litera (Unicode `\p{L}`), cyfra; potwierdzenie hasła. W zakładce Konto: inna, krótsza reguła (min. 6) — świadoma różnica kontekstów.
- **Reset e-mail:** `resolvePasswordResetRedirectUrl()` — produkcja kanonicznie `https://{appDomain}/admin.html`.
- **Treść HTML:** DOMPurify + sanityzacja rekurencyjna w `pageRepository`; ostrożnie z polami embed (mapy, recenzje Google).
- **Analityka:** w panelu tylko **ID** kontenerów; snippet generuje **`publicSiteApp`** po zweryfikowanej zgodzie cookies. Właściciel wdrażający wyłącznie tagi marketingowe wyłącznie w **GTM** powinien uzgodnić to z tekstem baneru / dobrymi praktykami (GTM wiąże się obecnie z kategorią **Analityczne** po stronie technicznej).
- **Stripe:** sekret webhooka tylko po stronie Edge; klient anon w przeglądarce.
- **Google Maps / Places (`get-google-reviews`):** po CORS i `POST` — twarda walidacja `Authorization` + `auth.getUser()`; **401** bez sesji użytkownika. Klucz **`GOOGLE_MAPS_API_KEY`** tylko na Edge (brak Maps JS w panelu). **Panel:** zakładka **Opinie z Google** — autocomplete wizytówki (`listPlaces`); w treści **`google_reviews.place_id`** + etykieta **`place_query`**; sync opinii: **`reviews_for_place_id`** gdy jest `place_id`, inaczej legacy **`query`**. **`googlePlacesSync.js`** przy **Publikuj** uzupełnia też mapę (`contact.map_embed_url`) i `reviews` + `cached_*`. **Widok publiczny:** tylko dane z bazy; sekcja Google gdy `place_query` lub `place_id`. Istniejące strony z samym `place_query` — bez zmian do ponownego wyboru z listy.
- **Rozliczenia (Stripe):** tabela **`billing_profiles`** (zapis: Edge `service_role`); **`pages.billing_plan`** — lustrzany plan dla anon (watermark, blokada trial). W **`pages.content`** zostają wyłącznie pola trial (`trial_started_at`, `selected_plan`, opcjonalnie `payment_completed`). Panel: `loadBillingProfile()` + `billingProfileView.js`; webhook/sync/checkout/portal → `stripeBilling.ts`.
- **Draft vs Published (panel):** kolumna **`pages.draft_content`** (migracja `20260601155000`) = stan roboczy kreatora; **`pages.content`** = wersja publiczna (renderowana przez strony klientów — czytają **wyłącznie `content`**, zero regresji). `loadData` startuje na `draft_content` (fallback `content` gdy draft pusty; jednorazowy init draftu). **Live preview + cichy auto-save:** formularze (Alpine `x-model`) odświeżają podgląd na żywo; `$watch('content')` → **`scheduleDraftAutosave()`** (debounce `cfg.timeouts.draftAutosave`=1000ms) → **`autosaveDraftNow()`** zapisuje **tylko `draft_content`** (wskaźnik „Zapisuję/Zapisano roboczo” w headerze). **`saveData`** (kroki kreatora, switchTemplate, wybór planu) też pisze tylko `draft_content`. **Podgląd strony:** link otwiera `{motyw}.html?...&dfcms_preview=1`; **`publicSiteApp`** w trybie preview renderuje `draft_content` **tylko dla zalogowanego właściciela** (`repo.getDraftContentForOwner` — sesja + `user_id`; anon zawsze `content`, szczelne oddzielenie). **`publishChanges()`** (przycisk „Publikuj zmiany” + koniec kreatora + podpięcie domeny) kopiuje `draft_content`→`content` (+ `theme`, `color_preset`, `custom_domain`, odblokowanie trialu, sync Google), trzyma `draft_content`==`content`, toast „opublikowane i widoczne dla klientów”. **`revertChanges()`** („Odrzuć zmiany”) przywraca edytor do opublikowanej migawki (`_publishedContentRaw`) i nadpisuje `draft_content`. **Freemium publikacji:** `cfg.premiumThemes` (domyślnie puste) — premium motyw na trial/Starter można edytować i podglądać, ale `publishChanges` blokuje publikację (🔒 na przycisku + modal upgrade).

---

## 5. TO-DO NEXT

| Priorytet | Zadanie |
|-----------|---------|
| Średni | **Landing (`index.html`)** — dalsze iteracje CRO poza zsynchronizowanym cennikiem (demo + 3 pakiety + toggle wdrożone 2026-05-23). |
| Niższy | **Panel UI** — ewentualne dopracowanie pozostałych zakładek Studia w stylu liftingu Subskrypcji (2026-05-23: sidebar, header, plany). |
| Wysoki | **Tour Driver.js** — dopracowanie na mobile (popover przy ekranie startu kreatora, scroll sidebara). |
| Średni | **Inline validation** — spójne komunikaty przy polach (obok wykrzykników w menu). |
| Średni | **Testy** — smoke dla webhooka Stripe (mock) i krytycznej ścieżki `saveData` / auth. |
| Niższy | **CI** — automatyczny deploy Edge przy tagu / gałęzi. |
| Niższy | **Monitoring** — alert na błędy webhooka lub failed Edge invocations. |
| Niższy | **CMP zaawansowany** — pełne usuwanie / odświeżanie tagów przy cofnięciu zgody w tej samej sesji (obecnie: brak cofnięcia skryptów bez przeładowania). |

---

## 6. USER JOURNEY

*Na podstawie plików (`rejestracja.html`, `registrationApp.js`, `admin.html`, `adminApp.js`, szablony, Stripe) i dotychczasowych wdrożeń.*

1. **Wejście marketingowe** — **`index.html`** (CTA do `rejestracja.html`; **`#cennik`**: Starter/Standard z trial 14 dni + toggle mies./rok; Premium = wycena → formularz/mail); sekcja **Demo na żywo** → `?site=demo-*`. CTA „Zobacz cennik” w szablonach → `index.html#cennik`.  
2. **Rejestracja** — `rejestracja.html` + **`registrationApp.js`**: kolejność w DB **najpierw** `auth.users` (`signUp`), **potem** `pages` (trigger **`handle_new_user`** — kolizja slug → rollback całej rejestracji; trial w `content`). Slug tylko w **`user_metadata`**, nie insert z przeglądarki (RLS). Przy **Confirm email** Supabase często zwraca **`user: null` bez błędu** (ten sam e-mail) — front: jeśli slug już zajęty → sukces „sprawdź skrzynkę”, nie „nie udało się utworzyć użytkownika”. Fallback strony: **`adminApp.ensurePageFromRegistrationMetadata`** przy pierwszym logowaniu.  
3. **Potwierdzenie e-maila** — bez potwierdzenia panel pokazuje baner; kreator i pełny onboarding nie startują.  
4. **Pierwsze logowanie do panelu** — `admin.html` → `loadData` (ekran „Weryfikacja…” trwa do końca pierwszego wczytania, mniej migania) → ewentualnie **modal powitalny** → **Driver.js** (start kreatora → podgląd → menu) → zapis `welcome_onboarding_completed`.  
5. **Konfiguracja treści** — edycja zakładek (hero, szablon, kontakt, …); **Konfiguracja → Wygląd** — zmiana motywu branżowego (`switchTemplate`) z potwierdzeniem, zapis i przeładowanie panelu; opcjonalnie **pełny kreator** (także trzy szablony w kroku 1); checklista podstaw z **!** dopóki brakuje szablonu (nie `setup`) / nazwy / kontaktu.  
6. **Podgląd strony publicznej** — link w nagłówku panelu → plik **`{motyw}.html`** na localhost z `?site=` **+ `dfcms_preview=1`**, lub domena `{slug}.{appDomain}` / custom z **`?dfcms_preview=1`** — **bez uruchamiania** GTM/Pixel z podglądu edytora. Demo katalogowe: **`demo-beauty`**, **`demo-fitness`**, **`demo-services`** (treść z **`data/seeds/demo_pages.json`** lokalnie; w Staging/Prod z tabeli `pages`).  
7. **Subskrypcja** — zakładka Subskrypcja: wybór **Starter / Standard**, przełącznik **mies./rok**, → **`create-checkout`** (`plan`, `interval`); **Custom** → formularz. Po pierwszej płatności / przy aktywnym Stripe: **Customer Portal** (`showStripeBillingPortal`). Przy **rezygnacji na koniec okresu** — baner „wygasająca” + jeden przycisk portalu. Webhook/sync zapisują **`billing_profiles`** + **`pages.billing_plan`**; przy pełnym `canceled` — **`trial_blocked_at`** i blokada widoku publicznego. Zmiana planu przy istniejącym kliencie → portal, nie checkout.  
8. **Własna domena** (opcjonalnie, wyższe plany) — `add-custom-domain` + instrukcje DNS w panelu.  
9. **Sesja i bezpieczeństwo** — reset hasła z maila; recovery wymusza zmianę hasła przed pełnym dostępem.

---

## 7. Jak utrzymywać ten plik

1. **Na koniec sesji** (gdy zmienia się zachowanie produktu, API, onboarding, Stripe lub security): zaktualizuj sekcje **1–6** i datę w nagłówku.  
2. **Changelog skrótowy** — można prowadzić w `docs/LIVING_CONTEXT.md` (historia jednoliniowa) albo dodać podsekcję „Historia” tutaj — unikać duplikacji długich opisów.  
3. Szczegóły implementacyjne zostaw w kodzie (komentarze); tutaj **decyzje, stany, luki**.

---

## 8. Powiązane dokumenty

- `README.md` — start, struktura katalogów.  
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — warstwy systemu, diagram Mermaid, indeks Edge Functions.  
- [`WORKFLOW.md`](WORKFLOW.md) — development, migracje, Stripe Test vs Live, deploy.  
- `docs/LIVING_CONTEXT.md` — skrót + changelog (opcjonalnie); reguła Cursor w `.cursor/rules/living-context.mdc` powinna wskazywać na aktualizację **`PROJECT_STATE.md`** przy większych zmianach.
