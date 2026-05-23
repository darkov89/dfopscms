# DFCMS — stan projektu i kontekst trwały

> **Przeznaczenie:** jeden plik w korzeniu repozytorium do aktualizacji **na koniec sesji** (ludzie + agenci), żeby zachować ciągłość decyzji architektonicznych, produktowych i operacyjnych.  
> **Nie zastępuje** `README.md` (start, deploy, struktura katalogów), ale je **uzupełnia** o „co wiemy o systemie teraz”.

**Ostatnia aktualizacja treści:** 2026-05-23 — billing: `billing_profiles` + `pages.billing_plan` (źródło prawdy); JSON tylko pola trial

---

## 1. ARCHITEKTURA

### 1.1 Co jest w produkcie (krótko)

| Warstwa | Technologie / artefakty |
|--------|-------------------------|
| **Front publiczny** | Statyczne HTML: **`index.html`** — landing (Tailwind + Alpine), m.in. sekcja **Demo na żywo** (linki `?site=demo-beauty|demo-fitness|demo-services` → `router.html`); **`router.html`** — wejście do routingu wielodomenowego; szablony publiczne m.in. **`beauty.html`**, **`consultant.html`**, **`fitness.html`**, **`services.html`**. **Lokalny dev (localhost / 127.0.0.1):** gdy w `pages` nie ma wiersza dla tych slugów, **`pageRepository.getPageBySlug`** zwraca treść z **`docs/demo_seeds.json`** (bez Supabase). **`routerApp.js`:** po załadowaniu strony z bazy → redirect do **`{pages.theme}.html`** (`?site=` na hoście systemowym). JS: `publicSiteApp.js`, **`cookieConsentApp.js`** (banner zgód, `DFOPS_getStoredCookieConsent`), `routerApp.js`. **Analityka (opcjonalnie):** w treści **`content.pl.settings.analytics`** — **`gtm_id`**, **`fb_pixel_id`** (walidacja przy zapisie w **`pageRepository`**: GTM jak `GTM-…`, Pixel cyfry). **Google Tag Manager** wstrzykiwany tylko po zgodzie **Analityczne**; **Meta Pixel** po zgodzie **Marketingowe**; **`DFOPS_injectClientAnalytics`** / **`consent-updated`** (`publicSiteApp.js`). Brak wstrzyknięcia w **iframe**, przy **`?dfcms_preview=1`** (podgląd z panelu) oraz na zablokowanej stronie trialowej. **Demo katalogowe bez Google Places:** przy **`content.pl.settings.is_demo_catalog`** i pustym **`google_reviews.place_query`** karuzela opinii bierze dane z **`content.pl.reviews`** (`js/features/googleReviewsApp.js`); ten sam warunek steruje widocznością linku/sekcji **Opinie** w **beauty / fitness / services**. **Mapa:** w seedach ustawione **`contact.map_embed_url`** (Google Maps z `output=embed`); walidacja zapisu w **`pageRepository.isGoogleMapsEmbedHttpsUrl`** (HTTPS + host `*.google.com` + ścieżka **`/maps/embed`** *lub* **`/maps`** z query **`output=embed`**). Legacy **`landing.html` usunięty**. Roadmap szablonów: **`gastro`**. **Cloudflare Pages** + `functions/_middleware.js` (SEO). |
| **Panel CMS** | `admin.html`, **Alpine.js**, **Tailwind** (CDN), `js/features/adminApp.js`. **Sidebar (lg):** `sticky` + wewnętrzny scroll (`overflow-y-auto`); nagłówki sekcji **Treść** / **Konfiguracja** — klasa `.dfops-sidebar-section-title` w `css/styles.css`. **Subskrypcja:** **Warunki rozliczeń** w `<details>` (`#dfops-platnosci-info`; link **Warunki** w headerze otwiera accordion); synchronizacja Stripe bez wyświetlania `sub_…` w panelu. **Onboarding:** jeśli w `pages.content` jest **`welcome_onboarding_completed: true`**, modal powitalny + **Driver.js** i pełnoekranowy kreator nie uruchamiają się (stan z localStorage kreatora jest czyszczony); automatyczne domknięcie checklisty ustawia też **welcome** przy zapisie. **Subskrypcja:** przycisk **Starter** woła od razu **`subscribe('starter')` → Edge `create-checkout`** (bez `confirm` i sztucznego stanu „oczekiwanie”). **SEO i Analityka** (zakładka `seo`): meta / OG / social oraz pola **GTM ID** i **Meta Pixel ID** → `content.pl.settings.analytics`. Link **Podgląd strony** dokleja **`?dfcms_preview=1`** (**`getPublicSiteUrl`**) żeby nie liczyć analityki z edycji. **Motyw strony** — kolumna `pages.theme` + lustrzanie `content.pl.settings.theme` (normalizacja + zapis). **Wygląd → Zmiana motywu branżowego:** kafelki szablonów (`DFOPS_getTemplateCatalog` w `registry.js`), `switchTemplate` (beauty / consultant / fitness / services); merge treści: `DFOPS_mergeContentWithTemplate` + **`DFOPS_resolveTemplateKeyForMerge`**. **Sidebar zależny od motywu:** m.in. **Grafik zajęć** (`schedule[]`, tylko fitness), **Zaufanie** (`trust` + `showTrust`, tylko services); **`ensureActiveTabForTheme()`** — po zmianie motywu nie zostaje otwarta ukryta zakładka. **Etykiety menu** — bloki Beauty / Konsultant / Fitness / Usługi w **Szablon i kolory → Marka**. **Pasek postępu:** `calculateProgress()`. **Subskrypcja:** kafelek **Stripe Customer Portal** pokazuje się przy **`showStripeBillingPortal`** (`hasActivePaidSubscription` *lub* **`stripe_customer_id`** + status anulowania — faktury/anulowanie po wygaśnięciu); przy braku portalu krótka informacja o pojawieniu się po pierwszej zaksięgowanej płatności. Porównanie **4 kart ofert** (Starter, Pro, Premium, Custom) — siatka od breakpointu **`xl`** (`xl:grid-cols-4`), przy węższym viewport nadal poziomy scroll + strzałki; karty: wspólna wysokość wiersza (`grid-auto-rows` + `min-h-0`), CTA z jednolitą minimalną wysokością. Szablony: `js/templates/registry.js`; normalizacja: `js/core/contentSchema.js`, `js/core/contentUpgrader.js`; style publiczne: `js/core/themeStyling.js` + `config.js` (`presetsByTheme`, `accentByPreset`). |
| **Backend danych** | **Supabase**: PostgreSQL (`pages` + treść JSON), **Auth** (JWT), **Storage** (obrazy), RLS na tabelach. **Data API (2026):** jawne **`GRANT`** na `public.pages` dla `anon` / `authenticated` / `service_role` — migracja **`20260522104231_explicit_grants_pages.sql`** (wymóg Supabase przed październikiem; RLS bez zmian). **Strony katalogowe demo:** migracje **`20260503135500_pages_slug_unique`** + **`20260503140000_seed_demo_catalog_pages`** — UPSERT `demo-beauty` / `demo-fitness` / `demo-services` (`user_id` NULL; w treści **`subscription`** jak opłacony PRO omijający blok trial w `expire_trial_pages`). Źródło JSON zsynchronizowane: **`docs/demo_seeds.json`**; regeneracja SQL: **`node scripts/generate-demo-pages-migration.mjs`**. Deploy DB: **`supabase db push`** (opis w `README.md`). Klient: `supabaseClient.js`, **`pageRepository.js`**. |
| **Backend logiki płatności / domen** | **Supabase Edge Functions** (Deno): webhook Stripe, Checkout, Portal, sync subskrypcji, domeny (Cloudflare), Google Reviews, cron trial. Zmiana planu wyłącznie przez **Customer Portal** (`create-portal-session`). Współdzielona logika: `supabase/functions/_shared/stripeBilling.ts`. |
| **Płatności** | **Stripe** (Checkout, Customer Portal, webhooks → Edge). Identyfikatory cen w `js/core/config.js` (`stripePrices`). |

### 1.2 Przepływ danych (uproszczony)

```
Użytkownik → Auth (Supabase) → pages.content (JSON) → front (szablon + merge)
                    ↓
            Stripe Checkout / Portal → stripe-webhook (Edge) → aktualizacja pages.content (subscription)
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
| **CI/CD** | Deploy funkcji przez Supabase CLI (dokumentacja w `README`); brak jednego opisanego pipeline’u w repozytorium (np. GitHub Actions) — do ustalenia z infrastrukturą. |
| **Observability** | Logi Edge/Deno + Stripe Dashboard; brak scentralizowanego opisu alertów (np. failed webhooks). |
| **i18n** | Panel i treści głównie **PL**; szablony pod wielojęzyczność w modelu `content.pl` — pełne i18n nie są domknięte w UI. |
| **RLS / anon read** | Wiersze demo mają **`user_id` NULL**. **`GRANT SELECT`** dla `anon` na tabeli (migracja explicit grants) + polityka RLS **`SELECT`** po `slug` — bez obu warstw podgląd z landingu zwróci pustkę. |
| **Wersjonowanie treści / audit** | Pojedynczy JSON `content` na stronę — brak historii wersji w produkcie. |
| **API poza Supabase** | Brak osobnego BFF; cała logika „biznesowa” w JS klienta + Edge Functions. |
| **Bezpieczeństwo treści** | Sanityzacja przy zapisie strony (`pageRepository.sanitizeContent` + DOMPurify w panelu) — patrz sekcja SECURITY. Pola **mapy:** dozwolony iframe URL tylko dla hostów Google z **`/maps/embed`** lub klasycznego **`/maps?…&output=embed`**. **`gtm_id` / `fb_pixel_id`:** wyłącznie zweryfikowany format ID (bez wklejek pełnego skryptu). |

---

## 2. STATUS PŁATNOŚCI

- **Webhook Stripe** (`supabase/functions/stripe-webhook/`): weryfikacja podpisu przez **`stripe.webhooks.constructEventAsync`** (async, Deno) — zgodnie z wymaganiami Stripe dla środowisk async.
- **Obsługiwane zdarzenia** (nagłówek funkcji): m.in. `checkout.session.completed`, `customer.subscription.updated` / `deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- **Źródło prawdy dla okresu rozliczeniowego:** wyłącznie **`Stripe.Subscription.current_period_end`** po `subscriptions.retrieve` — merge do `content.pl.settings.subscription` w `stripeBilling.ts` (nie polegać na `invoice.period_end` jako SoT dla subskrypcji).
- **Rezygnacja na koniec okresu (`cancel_at_period_end` / `cancel_at`):** przy statusie **`active`/`trialing`** i zaplanowanym zamknięciu plan w CMS pozostaje płatny do **`current_period_end`**; panel pokazuje status *wygasający* (`isSubscriptionCanceledButValid`, **`planUtils.js`**). **`hasActivePaidSubscription`** nie ufa samemu `plan: tier*` po statusie **`canceled`** w Stripe. Wejście w zakładkę **Subskrypcja** — jednorazowy silent **`sync-stripe-subscription`** (świeży JSON). Edge: **`subscriptionScheduledToCancelStripe`** w **`stripeBilling.ts`**. **Widok publiczny nie jest blokowany samą tą flagą** — `publicSiteApp.shouldBlockPublicPageView` i blokady `trial_blocked_at` nie sprawdzają `cancel_at_period_end`; goście tracą dostęp dopiero po faktycznym zakończeniu rozliczenia w Stripe (webhook → m.in. `canceled` / brak płatności), zgodnie z dotychczasowymi regułami trial i `billing_failed_at`.
- **Tryb demo / konfiguracja:** ceny i klucze publikowalne w `js/core/config.js`; sekrety (webhook secret, service role) w Supabase Secrets — **demo** oznacza typowo środowisko testowe Stripe + testowe price IDs; produkcja wymaga spójnych URL-i webhooka i Redirect URLs w Supabase/Stripe.

### 2.1 Wygasły trial — widok publiczny i retencja

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
- **Google Maps / Places (`get-google-reviews`):** po CORS i `POST` — twarda walidacja `Authorization` + `auth.getUser()`; **401** bez sesji użytkownika. **Panel:** `js/core/googlePlacesSync.js` — przy **Publikuj zmiany** i przy wyborze miejsca na mapie uzupełnia `contact.map_embed_url` oraz `reviews` + metadane w `google_reviews` (`cached_*`, `google_synced_at`). **Widok publiczny:** tylko dane z bazy (`map_embed_url`, `content.pl.reviews`); brak wywołań Edge. Istniejące strony z samym `map_place_id` — jednorazowo **Publikuj** w panelu.
- **Rozliczenia (Stripe):** tabela **`billing_profiles`** (zapis: Edge `service_role`); **`pages.billing_plan`** — lustrzany plan dla anon (watermark, blokada trial). W **`pages.content`** zostają wyłącznie pola trial (`trial_started_at`, `selected_plan`, opcjonalnie `payment_completed`). Panel: `loadBillingProfile()` + `billingProfileView.js`; webhook/sync/checkout/portal → `stripeBilling.ts`.

---

## 5. TO-DO NEXT

| Priorytet | Zadanie |
|-----------|---------|
| Wysoki | **Landing (`index.html`)** — dalsze iteracje copy/visual i CRO (sekcja demo już wdrożona; osobnego `landing.html` nie ma). |
| Wysoki | **Tour Driver.js** — dopracowanie na mobile (popover przy ekranie startu kreatora, scroll sidebara). |
| Średni | **Inline validation** — spójne komunikaty przy polach (obok wykrzykników w menu). |
| Średni | **Testy** — smoke dla webhooka Stripe (mock) i krytycznej ścieżki `saveData` / auth. |
| Niższy | **CI** — automatyczny deploy Edge przy tagu / gałęzi. |
| Niższy | **Monitoring** — alert na błędy webhooka lub failed Edge invocations. |
| Niższy | **CMP zaawansowany** — pełne usuwanie / odświeżanie tagów przy cofnięciu zgody w tej samej sesji (obecnie: brak cofnięcia skryptów bez przeładowania). |

---

## 6. USER JOURNEY

*Na podstawie plików (`rejestracja.html`, `registrationApp.js`, `admin.html`, `adminApp.js`, szablony, Stripe) i dotychczasowych wdrożeń.*

1. **Wejście marketingowe** — **`index.html`** (CTA do `rejestracja.html`; sekcja **Demo na żywo** → `?site=demo-*` → `router.html` → rekord `pages` / lokalnie JSON fallback); przy logowaniu i rejestracji linki wtórne na **`admin.html`** / **`rejestracja.html`** oraz powrót na **`index.html`**. Legacy `landing.html` usunięty; CTA „Zobacz cennik” w szablonach publicznych wskazuje `index.html#cennik`.  
2. **Rejestracja** — formularz (`rejestracja.html`) → Supabase Auth; metadata ze **slugiem** strony; trigger / logika tworzy rekord `pages` (szablon startowy `setup`).  
3. **Potwierdzenie e-maila** — bez potwierdzenia panel pokazuje baner; kreator i pełny onboarding nie startują.  
4. **Pierwsze logowanie do panelu** — `admin.html` → `loadData` (ekran „Weryfikacja…” trwa do końca pierwszego wczytania, mniej migania) → ewentualnie **modal powitalny** → **Driver.js** (start kreatora → podgląd → menu) → zapis `welcome_onboarding_completed`.  
5. **Konfiguracja treści** — edycja zakładek (hero, szablon, kontakt, …); **Konfiguracja → Wygląd** — zmiana motywu branżowego (`switchTemplate`) z potwierdzeniem, zapis i przeładowanie panelu; opcjonalnie **pełny kreator** (także trzy szablony w kroku 1); checklista podstaw z **!** dopóki brakuje szablonu (nie `setup`) / nazwy / kontaktu.  
6. **Podgląd strony publicznej** — link w nagłówku panelu → plik **`{motyw}.html`** na localhost z `?site=` **+ `dfcms_preview=1`**, lub domena `{slug}.{appDomain}` / custom z **`?dfcms_preview=1`** — **bez uruchamiania** GTM/Pixel z podglądu edytora. Demo katalogowe: **`demo-beauty`**, **`demo-fitness`**, **`demo-services`** (treść jak w **`docs/demo_seeds.json`**; na produkcji po **`supabase db push`** migracji seed).  
7. **Subskrypcja** — zakładka Subskrypcja → Stripe Checkout; **Customer Portal** widoczny dopiero przy aktywnym rozliczeniu (`showStripeBillingPortal`), z komunikatem dla trialu bez płatności; przy **rezygnacji na koniec okresu** (`cancel_at_period_end`, nadal `active`/`trialing`) panel pokazuje **jeden** pomarańczowy baner („wygasająca”) z datą końca okresu i **jednym** przyciskiem do portalu (wznów / faktury / karta) — **bez** drugiego bloku „Zarządzaj…” i **bez** widocznego „Anuluj subskrypcję” (użytkownik już zaplanował zamknięcie). Dla subskrypcji w pełni odnowianej pozostaje ciemny blok portalu z **Zarządzaj…** + ścieżka anulowania w portalu. **Publikacja strony dla gości jest utrzymana** do wygaśnięcia rozliczenia (logika publiczna bez zmian dla samej flagi anulowania). Po pełnym anulowaniu subskrypcji portal może zostać dostępny przy istniejącym **`stripe_customer_id`** (faktury). Webhook aktualizuje `content.pl.settings.subscription` i ewentualnie `trial_blocked_at` / blokady publikacji.  
8. **Własna domena** (opcjonalnie, wyższe plany) — `add-custom-domain` + instrukcje DNS w panelu.  
9. **Sesja i bezpieczeństwo** — reset hasła z maila; recovery wymusza zmianę hasła przed pełnym dostępem.

---

## 7. Jak utrzymywać ten plik

1. **Na koniec sesji** (gdy zmienia się zachowanie produktu, API, onboarding, Stripe lub security): zaktualizuj sekcje **1–6** i datę w nagłówku.  
2. **Changelog skrótowy** — można prowadzić w `docs/LIVING_CONTEXT.md` (historia jednoliniowa) albo dodać podsekcję „Historia” tutaj — unikać duplikacji długich opisów.  
3. Szczegóły implementacyjne zostaw w kodzie (komentarze); tutaj **decyzje, stany, luki**.

---

## 8. Powiązane dokumenty

- `README.md` — start, struktura, deploy, Cloudflare.  
- `docs/LIVING_CONTEXT.md` — skrót + changelog (opcjonalnie); reguła Cursor w `.cursor/rules/living-context.mdc` powinna wskazywać na aktualizację **`PROJECT_STATE.md`** przy większych zmianach.
