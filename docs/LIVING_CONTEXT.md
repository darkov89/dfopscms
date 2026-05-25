# DFOPS CMS — skrót i changelog

> **Główny plik kontekstu projektu:** [`PROJECT_STATE.md`](../PROJECT_STATE.md) (katalog główny repozytorium) — architektura, płatności, onboarding, security, user journey, TO-DO. **Aktualizuj go na koniec sesji** przy istotnych zmianach.

Ten plik (`docs/LIVING_CONTEXT.md`) zostawiamy jako **krótki indeks** + **changelog** jednoliniowy, żeby nie dublować długich sekcji.

**Ostatnia aktualizacja treści:** 2026-05-22 (fix Checkout vs Portal przy trial / anulowanej sub)

---

## Szybki start (orientacja)

| Temat | Gdzie szczegóły |
|-------|------------------|
| Stos, deploy, katalogi | [`README.md`](../README.md) |
| Stan architektury, Stripe, onboarding, security, user journey | [`PROJECT_STATE.md`](../PROJECT_STATE.md) |
| Konfiguracja klienta / ceny fallback | `js/core/config.js` (`stripePrices`: starter, starterYearly, standard, standardYearly) |
| Landing marketingowy + cennik | `index.html#cennik` · `js/features/landingPricing.js` |
| Panel — subskrypcja | `admin.html` (toggle mies./rok, karty `<details>`) · `adminApp.js` (`billingInterval`, `subscribe`) |
| Panel — UI (CSS) | `css/styles.css` — `.dfops-admin-sidebar-scroll`, `.dfops-plan-card`, `.dfops-plan-features` |
| Plany / watermark / domena | `js/core/planUtils.js` (`DFOPS_normalizePlan` — legacy tier2→tier1) |
| Profil Stripe w panelu | `billingProfileView.js` · `loadBillingProfile()` w `adminApp.js` |
| Demo / seed treści | [`docs/demo_seeds.json`](demo_seeds.json) (`tier1` + `payment_completed`) |
| Edge Stripe | `create-checkout`, `stripe-webhook`, `sync-stripe-subscription`, `_shared/stripeBilling.ts` |
| Custom / Premium (zapytanie) | `zapytanie-custom.html` · `mailto:kontakt@dfops.eu` |

---

## Changelog (skrót)

| Data | Co |
|------|-----|
| **2026-05-22** | **Panel:** `hasActivePaidSubscription` / `isSubscriptionCanceledButValid` — tylko Stripe (`sid`+status, `cancel_at_period_end`), bez `payment_completed`. |
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
