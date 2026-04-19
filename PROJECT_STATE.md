# DFCMS — stan projektu i kontekst trwały

> **Przeznaczenie:** jeden plik w korzeniu repozytorium do aktualizacji **na koniec sesji** (ludzie + agenci), żeby zachować ciągłość decyzji architektonicznych, produktowych i operacyjnych.  
> **Nie zastępuje** `README.md` (start, deploy, struktura katalogów), ale je **uzupełnia** o „co wiemy o systemie teraz”.

**Ostatnia aktualizacja treści:** 2026-04-04

---

## 1. ARCHITEKTURA

### 1.1 Co jest w produkcie (krótko)

| Warstwa | Technologie / artefakty |
|--------|-------------------------|
| **Front publiczny** | Statyczne HTML: **`index.html`** — landing marketingowy (Tailwind + Alpine); **`router.html`** — wejście do routingu wielodomenowego; szablony publiczne m.in. **`beauty.html`**, **`consultant.html`**, **`fitness.html`** (dark / neon — trener, studio); planowane: `services`, `gastro` (kafelki w panelu „w przygotowaniu”). **`routerApp.js`:** po załadowaniu strony z bazy → redirect do **`{pages.theme}.html`** (localhost: `?site=`). JS: `publicSiteApp.js` (`createPublicSiteApp('motyw')`), `routerApp.js`. Na „gołej” domenie platformy — **landing**; **`?site=`** i subdomeny → `router.html`. **Cloudflare Pages** + `functions/_middleware.js` (SEO). |
| **Panel CMS** | `admin.html`, **Alpine.js**, **Tailwind** (CDN), `js/features/adminApp.js`. **Motyw strony** — kolumna `pages.theme` + lustrzanie `content.pl.settings.theme` (normalizacja + zapis). **Wygląd → Zmiana motywu branżowego:** kafelki szablonów (`DFOPS_getTemplateCatalog` w `registry.js`), `switchTemplate` (beauty / consultant / fitness); merge treści: `DFOPS_mergeContentWithTemplate` + **`DFOPS_resolveTemplateKeyForMerge`** (brak pełnego JSON szablonu → baza z `beauty`, bez crasha przy odczycie). **Pasek postępu:** `calculateProgress()`. Szablony: `js/templates/registry.js`; normalizacja: `js/core/contentSchema.js`, `js/core/contentUpgrader.js`; style publiczne: `js/core/themeStyling.js` + `config.js` (`presetsByTheme`, `accentByPreset`). |
| **Backend danych** | **Supabase**: PostgreSQL (`pages` + treść JSON), **Auth** (JWT), **Storage** (obrazy), RLS na tabelach. Klient w przeglądarce: `js/core/supabaseClient.js`, repozytorium: `js/core/pageRepository.js`. |
| **Backend logiki płatności / domen** | **Supabase Edge Functions** (Deno): webhook Stripe, Checkout, Portal, sync subskrypcji, domeny (Cloudflare), Google Reviews, cron trial. Współdzielona logika: `supabase/functions/_shared/stripeBilling.ts`. |
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
- **Gotowe publiczne HTML + szablon w `registry`:** `setup`, `beauty`, `consultant`, **`fitness`** (m.in. `content.pl.schedule[]` dla grafiku).
- **Roadmap UI:** kafelki `fitness` / `services` / `gastro` — niedostępne szablony bez pełnej definicji → toast „w przygotowaniu”, podgląd localhost dla brakującego `.html` może używać proxy (`beauty.html`), aż do dodania pliku.

### 1.4 Luki i obszary do domknięcia (audyt)

| Obszar | Status / uwagi |
|--------|----------------|
| **Testy automatyczne** | Brak widocznego zestawu E2E/unit w repo jako obowiązkowego gate’a — ryzyko regresji przy zmianach w `adminApp` i Edge. |
| **CI/CD** | Deploy funkcji przez Supabase CLI (dokumentacja w `README`); brak jednego opisanego pipeline’u w repozytorium (np. GitHub Actions) — do ustalenia z infrastrukturą. |
| **Observability** | Logi Edge/Deno + Stripe Dashboard; brak scentralizowanego opisu alertów (np. failed webhooks). |
| **i18n** | Panel i treści głównie **PL**; szablony pod wielojęzyczność w modelu `content.pl` — pełne i18n nie są domknięte w UI. |
| **Wersjonowanie treści / audit** | Pojedynczy JSON `content` na stronę — brak historii wersji w produkcie. |
| **API poza Supabase** | Brak osobnego BFF; cała logika „biznesowa” w JS klienta + Edge Functions. |
| **Bezpieczeństwo treści** | Sanityzacja przy zapisie strony (`pageRepository.sanitizeContent` + DOMPurify w panelu) — patrz sekcja SECURITY. |

---

## 2. STATUS PŁATNOŚCI

- **Webhook Stripe** (`supabase/functions/stripe-webhook/`): weryfikacja podpisu przez **`stripe.webhooks.constructEventAsync`** (async, Deno) — zgodnie z wymaganiami Stripe dla środowisk async.
- **Obsługiwane zdarzenia** (nagłówek funkcji): m.in. `checkout.session.completed`, `customer.subscription.updated` / `deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- **Źródło prawdy dla okresu rozliczeniowego:** wyłącznie **`Stripe.Subscription.current_period_end`** po `subscriptions.retrieve` — merge do `content.pl.settings.subscription` w `stripeBilling.ts` (nie polegać na `invoice.period_end` jako SoT dla subskrypcji).
- **Tryb demo / konfiguracja:** ceny i klucze publikowalne w `js/core/config.js`; sekrety (webhook secret, service role) w Supabase Secrets — **demo** oznacza typowo środowisko testowe Stripe + testowe price IDs; produkcja wymaga spójnych URL-i webhooka i Redirect URLs w Supabase/Stripe.

### 2.1 Wygasły trial — widok publiczny i retencja

- **Kolumna `pages.trial_blocked_at`:** ustawiana przez cron (`expire_trial_pages()` → Edge `expire-trial-pages` + `CRON_SECRET`). Bez działającego cronu strona mogła pozostawać widoczna mimo „0 dni” w panelu.
- **Front publiczny (`publicSiteApp.js`):** dodatkowo **`shouldBlockPublicPageView(page)`** — ta sama logika co SQL (14 dni od `trial_started_at`, brak `payment_completed`, plan `trial` lub `tier0`; oraz 14 dni po `billing_failed_at`). Ukrywa treść **od razu** po wejściu, bez czekania na cron. Nadal obowiązuje: **brak treści w HTML** (ekran „Strona chwilowo niedostępna”); pełne zamknięcie dostępu do JSON po stronie API wymagałoby zaostrzenia RLS (TODO).
- **`getPageBySlug`** zwraca też **`billing_failed_at`** do powyższej walidacji.
- **Usuwanie po 30 dniach:** funkcja **`purge_trial_blocked_pages_after_grace()`** — `DELETE` z `pages`, gdzie `trial_blocked_at` ≤ teraz − 30 dni. Wywoływana z tego samego Edge co `expire_trial_pages` (odpowiedź JSON zawiera `purged_after_grace_days_30`). **Migracja:** `20260404120000_purge_trial_blocked_pages_after_grace.sql`.

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
- **Stripe:** sekret webhooka tylko po stronie Edge; klient anon w przeglądarce.

---

## 5. TO-DO NEXT

| Priorytet | Zadanie |
|-----------|---------|
| Wysoki | **Landing** — iteracje copy/visual nad `index.html`; ewent. A/B vs `landing.html` (legacy). |
| Wysoki | **Tour Driver.js** — dopracowanie na mobile (popover przy ekranie startu kreatora, scroll sidebara). |
| Średni | **Inline validation** — spójne komunikaty przy polach (obok wykrzykników w menu). |
| Średni | **Testy** — smoke dla webhooka Stripe (mock) i krytycznej ścieżki `saveData` / auth. |
| Niższy | **CI** — automatyczny deploy Edge przy tagu / gałęzi. |
| Niższy | **Monitoring** — alert na błędy webhooka lub failed Edge invocations. |

---

## 6. USER JOURNEY

*Na podstawie plików (`rejestracja.html`, `registrationApp.js`, `admin.html`, `adminApp.js`, szablony, Stripe) i dotychczasowych wdrożeń.*

1. **Wejście marketingowe** — **`index.html`** (CTA do `rejestracja.html`); linki z panelu publicznego / stopki kierują na `index.html`. Stary długi plik **`landing.html`** pozostaje w repo (linki zaktualizowane).  
2. **Rejestracja** — formularz (`rejestracja.html`) → Supabase Auth; metadata ze **slugiem** strony; trigger / logika tworzy rekord `pages` (szablon startowy `setup`).  
3. **Potwierdzenie e-maila** — bez potwierdzenia panel pokazuje baner; kreator i pełny onboarding nie startują.  
4. **Pierwsze logowanie do panelu** — `admin.html` → `loadData` (ekran „Weryfikacja…” trwa do końca pierwszego wczytania, mniej migania) → ewentualnie **modal powitalny** → **Driver.js** (start kreatora → podgląd → menu) → zapis `welcome_onboarding_completed`.  
5. **Konfiguracja treści** — edycja zakładek (hero, szablon, kontakt, …); **Konfiguracja → Wygląd** — zmiana motywu branżowego (`switchTemplate`) z potwierdzeniem, zapis i przeładowanie panelu; opcjonalnie **pełny kreator** (także trzy szablony w kroku 1); checklista podstaw z **!** dopóki brakuje szablonu (nie `setup`) / nazwy / kontaktu.  
6. **Podgląd strony publicznej** — link w nagłówku panelu → plik **`{motyw}.html`** na localhost z `?site=`, lub domena `{slug}.{appDomain}` / custom domain po aktywacji.  
7. **Subskrypcja** — zakładka Subskrypcja → Stripe Checkout / Portal → webhook aktualizuje `content.pl.settings.subscription` i ewentualnie `trial_blocked_at` / blokady publikacji.  
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
