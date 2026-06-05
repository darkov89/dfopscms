# DFOPS CMS — skrót i changelog

> **Główny plik kontekstu projektu:** [`PROJECT_STATE.md`](../PROJECT_STATE.md) (katalog główny repozytorium) — architektura, płatności, onboarding, security, user journey, TO-DO. **Aktualizuj go na koniec sesji** przy istotnych zmianach.

Ten plik (`docs/LIVING_CONTEXT.md`) zostawiamy jako **krótki indeks** + **changelog** jednoliniowy, żeby nie dublować długich sekcji.

**Ostatnia aktualizacja treści:** 2026-06-05 (porządek repo)

---

## Szybki start (orientacja)

| Temat | Gdzie szczegóły |
|-------|------------------|
| Stos, deploy, katalogi | [`README.md`](../README.md) |
| Diagram architektury, środowiska | [`ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Onboarding dev, migracje, deploy | [`WORKFLOW.md`](../WORKFLOW.md) |
| Stan architektury, Stripe, onboarding, security, user journey | [`PROJECT_STATE.md`](../PROJECT_STATE.md) |
| Konfiguracja klienta / ceny fallback | `js/core/config.js` (`stripePrices`: starter, starterYearly, standard, standardYearly) |
| Landing marketingowy + cennik | `index.html#cennik` · `js/features/landingPricing.js` |
| Panel — subskrypcja | `admin.html` (toggle mies./rok, karty `<details>`) · `adminApp.js` (`billingInterval`, `subscribe`) |
| Panel — UI (CSS) | `css/styles.css` — `.dfops-admin-sidebar-scroll`, `.dfops-plan-card`, `.dfops-plan-features` |
| Plany / watermark / domena | `js/core/planUtils.js` (`DFOPS_normalizePlan` — legacy tier2→tier1) |
| Profil Stripe w panelu | `billingProfileView.js` · `loadBillingProfile()` w `adminApp.js` |
| Demo / seed treści | [`data/seeds/demo_pages.json`](../data/seeds/demo_pages.json) (`tier1` + `payment_completed`) |
| Rejestracja | `rejestracja.html` · `registrationApp.js` · trigger `handle_new_user` (`20260525130000`) |
| Edge Stripe | `create-checkout`, `stripe-webhook`, `sync-stripe-subscription`, `_shared/stripeBilling.ts` |
| Custom / Premium (zapytanie) | `zapytanie-custom.html` · `mailto:kontakt@dfops.eu` |

---

## Changelog (skrót)

| Data | Co |
|------|-----|
| **2026-06-05** | **Porządek repo:** usunięte martwe pliki (`templates.js`, `app.js`, mp4); `data/seeds/demo_pages.json`; `docs/roadmap/`; `.env.example` bez `VITE_`; docs bez starych migracji. |
| **2026-06-05** | **wFirma fix:** `tax_id_type` eu_vat/nip, stawka `np`; faktury przy `invoice.payment_succeeded` (upgrade/odnowienie). |
| **2026-06-05** | **Checkout + wFirma:** `billing_address_collection` + `tax_id_collection`; webhook → faktura e-mail (`WFIRMA_*` Secrets). |
| **2026-06-03** | **config.js:** routing Supabase po hoście — localhost / `staging.dfcms.pl` / `*.pages.dev` → Staging; produkcja → Production; usunięty Docker `127.0.0.1:54321`. |
| **2026-06-03** | **Infrastruktura:** separacja Staging/Production (Supabase CLI, Stripe Test/Live, Cloudflare Pages + SaaS); `ARCHITECTURE.md`, `WORKFLOW.md`, `.gitignore`, `npm run dev`; migracja `remote_schema` bez triggerów `http_request`. |
| **2026-06-02** | **Edge — Telegram webhook:** router Sentry → Database Webhooks (`users`/`pages`/`billing_profiles`) → Log Alerts → fallback; Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). |
| **2026-06-02** | **Panel — monitoring błędów:** dodano **Sentry Loader Script** jako pierwszy element w `<head>` w `admin.html` (bez `Sentry.init()`). |
| **2026-06-02** | **Panel — Subskrypcja UI (spójność):** usunięto „czarny portal” w stylu obcym do admina → jedna biała karta statusu + sekcja „Zarządzanie rozliczeniami” (badge „Obsługa: Stripe” + ikonka), przyciski w stylu panelu (primary slate, secondary white, danger red outline). |
| **2026-06-02** | **Panel — dialogi systemowe:** zastąpiono systemowy `confirm()` globalnym modalem zwracającym `Promise<boolean>` (`confirmAsync` + `await` w call-site’ach: usuwanie konta, zmiana szablonu, domena, odrzucenie zmian). Toasty: 3s auto-dismiss, success zielony. |
| **2026-06-01** | **Publikacja — pozytywne tarcie:** główny przycisk „Publikuj zmiany” → `requestPublish()` otwiera modal potwierdzenia („Opublikować zmiany?”), właściwy zapis dopiero w `confirmPublish()` → `publishChanges()`; modal znika po sukcesie + toast. Wewnętrzne wywołania (wizard/domena) publikują bez modala. |
| **2026-06-01** | **Live Preview draftu (fix):** podgląd otwiera się w nowej karcie, więc sesja z `sessionStorage` (bez „Zapamiętaj mnie”) nie była dziedziczona → handoff draftu przez `localStorage` (`dfops_preview_draft:{slug}`, TTL 30 min, szczelne wobec anona) w `adminApp.stashDraftForPreview()` + odczyt w `publicSiteApp` (DB `getDraftContentForOwner` jako fallback). Cache-bust `?v=20260601c` na szablonach (`beauty/consultant/fitness/services/setup.html`). |
| **2026-05-25** | **Portal Stripe (UX):** 3 akcje w karcie — zmiana planu / faktury+karta / anuluj (`subscription_update` + `subscription_cancel` deep links). |
| **2026-05-25** | **Portal Stripe:** `create-portal-session` — `flow_data.subscription_update` przy zmianie planu; front przekazuje `subscription_id` + `flow`. |
| **2026-05-25** | **Rejestracja:** signUp `user:null` (ten sam e-mail) → sukces gdy slug zajęty; trigger `handle_new_user` — rollback przy kolizji slug. |
| **2026-05-22** | **Tarcze anty-zombie:** `killZombieSubscriptionEvent` + heal przy `active`/`trialing` w `applyStripeSubscriptionToPage`; potrójny guard przed upsert/block w `applySubscriptionCanceledToPage`. |
| **2026-05-22** | **Invoice webhook:** `extractInvoiceSubscriptionId` — Basil `parent.subscription_details.subscription` + API fallback (fix `brak invoice.subscription`); sync wymusza `clearPageBillingBlocksForPaidUser`. |
| **2026-05-22** | **Kolejka Stripe:** `stripeCustomerHasLiveSubscription` + heal `pages` przy pominiętym cancel; logi `stripe-webhook-queue`; podwójne czyszczenie po checkout (prod deploy). |
| **2026-05-24** | **Fix blokady po płatności:** `expire_trial_pages` respektuje `billing_profiles` + `pages.billing_plan`; anulowanie Stripe nie nadpisuje aktywnej sub; publicSite — paid plan przed `trial_blocked_at`. |
| **2026-05-22** | **Dual SoT:** `syncPageBillingMirrorFromProfile` — po aktywnej sub zawsze czyści `pages.trial_blocked_at` / `billing_failed_at`. |
| **2026-05-22** | **Zombie webhooks:** `shouldIgnoreStaleBillingDowngradeWebhook` — stary `canceled`/`past_due` nie nadpisuje innej `active`/`trialing` sub w `billing_profiles`. |
| **2026-05-22** | **Stripe returning customer:** checkout reuse `cus_…`; `upsertBillingProfile` + `resolvePageForStripeSubscription` (customer przed sub id). |
| **2026-05-22** | **Panel:** `hasActivePaidSubscription` / `isSubscriptionCanceledButValid` — tylko Stripe (`sid`+status, `cancel_at_period_end`), bez `payment_completed`. |
| **2026-06-01** | **Live preview + cichy auto-save:** debounce 1000ms → `draft_content`; podgląd renderuje draft tylko dla zalogowanego właściciela (`getDraftContentForOwner`), anon zawsze `content`; publish-toast. Staging-aware preview URL. |
| **2026-06-01** | **Draft vs Published:** `pages.draft_content` (migracja `20260601155000`); panel pracuje na drafcie, `publishChanges()` kopiuje do `content`, `revertChanges()` do produkcji; blokada publikacji premium motywu na darmowym planie. Public czyta tylko `content`. |
| **2026-05-22** | **Opinie Google (panel):** autocomplete wizytówki → `google_reviews.place_id`; Edge `reviews_for_place_id` + `listPlaces` (klucz tylko serwer). |
| **2026-05-22** | **Panel billing UX:** `billingProfileReady` + `panelBootLoading` (bez migania banerów); toast wygasającej/zakończonej sub raz po `loadBillingProfile`; portal przy zakupie tylko `stripe_customer_id` + `active`/`trialing`/`past_due`; `create-checkout` reuse `customer` (bez `customer_email`). |
| **2026-05-23** | **Refaktor rozliczeń:** cykle mies./rok, Starter/Standard/Custom, `billing_profiles`, landing `#cennik`, Edge deploy, migracja tier2→tier1 — commit **`72ea349`**. |
| **2026-05-23** | **Lifting UI panelu (tylko HTML/CSS):** sidebar bez scrolla na desktopie (`.dfops-admin-sidebar-scroll`); top bar — sam **Publikuj zmiany** + `title`; Subskrypcja — karty odchudzone (`<details>` funkcji, `.dfops-plan-card`). Bez zmian JS. |
| 2026-05-22 | **Supabase Data API:** migracja **`20260522104231_explicit_grants_pages.sql`** — jawne `GRANT` na `public.pages`. |
| 2026-05-16 | **Panel:** sidebar scroll; accordion warunków rozliczeń; bez `stripe_subscription_id` w UI. |
| 2026-05-15 | **Panel:** hash `#tab`; subskrypcja wygasająca (`cancel_at_period_end`); usunięty plan testowy dzienny; Starter → bezpośredni checkout. |
| 2026-05-06 | **Analityka + RODO:** GTM/Pixel po zgodzie cookies; zakładka SEO w panelu; `dfcms_preview=1`. |
| 2026-05-03 | **Demo / landing:** `demo_seeds.json`, sekcja demo na `index.html`; portal Stripe `showStripeBillingPortal`; siatka planów `xl`. |
| 2026-04-04 | **Trial / public:** `shouldBlockPublicPageView`; purge po 30 dniach `trial_blocked_at`. |
| 2026-04-04 | **Szablony:** fitness, `pages.theme`, kreator, presety neon. |
| 2026-04-03 | **`PROJECT_STATE.md`** w korzeniu; marketing `index.html`; onboarding Driver.js. |

---

## Jak utrzymywać

1. Po zadaniu zmieniającym produkcję: **najpierw** `PROJECT_STATE.md` (sekcje i data), **opcjonalnie** jedna linia tutaj w Changelog.  
2. Reguła Cursor: `.cursor/rules/living-context.mdc` — wskazuje na **`PROJECT_STATE.md`**.
