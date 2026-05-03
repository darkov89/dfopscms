# DFOPS CMS — skrót i changelog

> **Główny plik kontekstu projektu:** [`PROJECT_STATE.md`](../PROJECT_STATE.md) (katalog główny repozytorium) — architektura, płatności, onboarding, security, user journey, TO-DO. **Aktualizuj go na koniec sesji** przy istotnych zmianach.

Ten plik (`docs/LIVING_CONTEXT.md`) zostawiamy jako **krótki indeks** + **changelog** jednoliniowy, żeby nie dublować długich sekcji.

**Ostatnia aktualizacja treści:** 2026-05-03

---

## Szybki start (orientacja)

| Temat | Gdzie szczegóły |
|-------|------------------|
| Stos, deploy, katalogi | [`README.md`](../README.md) |
| Stan architektury, Stripe, onboarding, security, user journey | [`PROJECT_STATE.md`](../PROJECT_STATE.md) |
| Konfiguracja klienta | `js/core/config.js` |
| Landing marketingowy | `index.html` (m.in. **Demo na żywo** → `?site=demo-*`) · routing `?site=` / subdomeny → `router.html` |
| Demo / seed treści | [`docs/demo_seeds.json`](demo_seeds.json) · migracja `supabase/migrations/*_seed_demo_catalog_pages.sql` · lokalnie: `getPageBySlug` fallback z JSON (`pageRepository.js`) |
| Szablony publiczne | `beauty.html`, `consultant.html`, `fitness.html`, `services.html`, … · `routerApp.js` → `{pages.theme}.html` |
| Panel | `admin.html`, `js/features/adminApp.js` (motywy, kreator, `switchTemplate`) |
| Rejestr szablonów / merge | `js/templates/registry.js` · `contentSchema` / `contentUpgrader` |
| Edge Stripe | `supabase/functions/stripe-webhook/`, `_shared/stripeBilling.ts` |

---

## Changelog (skrót)

| Data | Co |
|------|-----|
| 2026-05-03 | **Landing / demo:** sekcja **„Gotowe szablony…”** (3 karty → `demo-beauty` / `demo-fitness` / `demo-services`), nav **Demo na żywo** · **`docs/demo_seeds.json`** + migracje Supabase (**`pages_slug_unique`**, UPSERT demo) · **`tier2` + payment_completed** w seedach (ominięcie bloku trial w cronie) · **localhost:** `pageRepository.getPageBySlug` czyta JSON gdy brak wiersza w `pages`. **Legacy `landing.html` usunięty.** **`README`** — `supabase db push`, regeneracja migracji (`scripts/generate-demo-pages-migration.mjs`). |
| 2026-05-03 | **Auth / UX:** Pod formularzem na **`rejestracja.html`** i **`admin.html`** (logowanie + reset hasła): linki do drugiego widoku oraz **`index.html`** (Quiet Luxury hover złoty). |
| 2026-05-03 | **Panel / szablony:** Zakładki **Grafik** (Fitness) i **Zaufanie** (services), etykiety menu + CTA dla Usługi w **Szablon i kolory**; link „Zaufanie” na `services.html` z `nav.menu.trust`; domyślne `trust`/`cta` w `contentUpgrader`; `ensureActiveTabForTheme` przy przełączaniu motywu. |
| 2026-04-03 | **Public blokada:** neutralny komunikat dla odwiedzających (prace techniczne / aktualizacja), bez wzmianki o płatnościach; `trialBlockedAdminHint` domyślnie pusty (ukryty w szablonach). **Szablon `services.html`** (usługi lokalne, granat + pomarańcz) + rejestr, `config` / `themeStyling` / `contentUpgrader`, panel, kreator. |
| 2026-04-04 | **Trial / public:** `shouldBlockPublicPageView` w `publicSiteApp.js` (blok jak `expire_trial_pages`, bez czekania na cron); `billing_failed_at` w `getPageBySlug`; RPC `purge_trial_blocked_pages_after_grace` + wywołanie w Edge `expire-trial-pages` (kasowanie `pages` 30 dni po `trial_blocked_at`). |
| 2026-04-04 | **Szablony / Epik 3:** `fitness.html` (dark neon, grafik `schedule[]`); `pages.theme` + `content.pl.settings.theme`; merge fallback (`DFOPS_resolveTemplateKeyForMerge`); panel — kafelki szablonów (w tym roadmap), `switchTemplate` dla beauty/consultant/fitness; **fix:** po zmianie szablonu zachowanie `welcome`/`onboarding`, czyszczenie LS kreatora, **Fitness w kroku 1 kreatora** (`admin.html` + `adminApp`). Presety `neon-*` / `bundlesByTheme.fitness` w `config.js`. |
| 2026-04-03 | **Marketing:** `index.html` (CRO: hero, jak to działa, cennik STARTER/PRO, FAQ Alpine, footer); **`router.html`** + przekierowania z `index` dla `?site=` / subdomen; `routerApp` / `publicSiteApp` → linki na `index.html`. (Historycznie współistniał `landing.html` — usunięty 2026-05-03.) |
| 2026-04-03 | **Panel:** pasek **„Twój postęp”** (`calculateProgress`); kreator — **localStorage** kroku, **zapis przy „Dalej”**, **„Wrócę później”** bez resetu stanu; Driver.js od startu kreatora; mniej migania przy pierwszym `loadData` (`loadingAuth`). |
| 2026-04-03 | Wprowadzono **`PROJECT_STATE.md`** w korzeniu — trwały kontekst sesji; ten plik skrócony do indeksu + changelog |
| 2026-04-03 | (historyczne wpisy — szczegóły w `PROJECT_STATE.md` i git) Żywa dokumentacja, auth recovery, Stripe SoT, onboarding Driver, checklista bez auto-kreatora, itd. |

---

## Jak utrzymywać

1. Po zadaniu zmieniającym produkcję: **najpierw** `PROJECT_STATE.md` (sekcje i data), **opcjonalnie** jedna linia tutaj w Changelog.  
2. Reguła Cursor: `.cursor/rules/living-context.mdc` — wskazuje na **`PROJECT_STATE.md`**.
