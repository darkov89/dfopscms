# DFOPS CMS — skrót i changelog

> **Główny plik kontekstu projektu:** [`PROJECT_STATE.md`](../PROJECT_STATE.md) (katalog główny repozytorium) — architektura, płatności, onboarding, security, user journey, TO-DO. **Aktualizuj go na koniec sesji** przy istotnych zmianach.

Ten plik (`docs/LIVING_CONTEXT.md`) zostawiamy jako **krótki indeks** + **changelog** jednoliniowy, żeby nie dublować długich sekcji.

**Ostatnia aktualizacja treści:** 2026-04-03

---

## Szybki start (orientacja)

| Temat | Gdzie szczegóły |
|-------|------------------|
| Stos, deploy, katalogi | [`README.md`](../README.md) |
| Stan architektury, Stripe, onboarding, security, user journey | [`PROJECT_STATE.md`](../PROJECT_STATE.md) |
| Konfiguracja klienta | `js/core/config.js` |
| Landing marketingowy | `index.html` · routing `?site=` / subdomeny → `router.html` |
| Panel | `admin.html`, `js/features/adminApp.js` |
| Edge Stripe | `supabase/functions/stripe-webhook/`, `_shared/stripeBilling.ts` |

---

## Changelog (skrót)

| Data | Co |
|------|-----|
| 2026-04-03 | **Marketing:** `index.html` (CRO: hero, jak to działa, cennik STARTER/PRO, FAQ Alpine, footer); **`router.html`** + przekierowania z `index` dla `?site=` / subdomen; `routerApp` / `publicSiteApp` → linki na `index.html`; `landing.html` / `zapytanie-custom.html` zsynchronizowane. |
| 2026-04-03 | **Panel:** pasek **„Twój postęp”** (`calculateProgress`); kreator — **localStorage** kroku, **zapis przy „Dalej”**, **„Wrócę później”** bez resetu stanu; Driver.js od startu kreatora; mniej migania przy pierwszym `loadData` (`loadingAuth`). |
| 2026-04-03 | Wprowadzono **`PROJECT_STATE.md`** w korzeniu — trwały kontekst sesji; ten plik skrócony do indeksu + changelog |
| 2026-04-03 | (historyczne wpisy — szczegóły w `PROJECT_STATE.md` i git) Żywa dokumentacja, auth recovery, Stripe SoT, onboarding Driver, checklista bez auto-kreatora, itd. |

---

## Jak utrzymywać

1. Po zadaniu zmieniającym produkcję: **najpierw** `PROJECT_STATE.md` (sekcje i data), **opcjonalnie** jedna linia tutaj w Changelog.  
2. Reguła Cursor: `.cursor/rules/living-context.mdc` — wskazuje na **`PROJECT_STATE.md`**.
