# Panel admin — źródła JS

Logika Alpine panelu (`admin.html`) jest podzielona na pliki domenowe i składana w jeden plik ładowany przez przeglądarkę.

## Pliki

| Plik | Zawartość |
|------|-----------|
| `shared.js` | Helpery, stałe, `createAdminContentShell`, wizard helpers |
| `billingView.js` | Mapowanie `billing_profiles` → widok subskrypcji (w bundlu adminApp) |
| `mixins/ui.js` | Gettery, nawigacja, wygląd, toasty, onboarding UI |
| `mixins/auth.js` | Logowanie, sesja, reset hasła |
| `mixins/data.js` | load/save/publish, domena, szablony |
| `mixins/billing.js` | Stripe, checkout, portal |
| `mixins/wizard.js` | Kreator startowy, tour Driver.js |
| `mixins/integrations.js` | Media, Google Places, mapa |
| `app-core.js` | `createAdminApp`, `buildAdminAlpineState`, eksporty |

Mixiny przyjmują `ctx` z closure `createAdminApp` (`cfg`, `repo`, timeouty).

**Reaktywność Alpine:** gettery na `x-data` zamrażają się przy init — stan UI (billing, kreator, checklisty, presety) trzymaj w jawnych polach i odświeżaj przez `refreshBillingSubscriptionView()`, `syncWizardView()`, `syncUiDerivedView()`, `syncPasswordFormView()`. Nowe szablony: `registry.js` + `themeConfig.js` + `presetsByTheme` w config — bez zmian w syncu.

## Komendy

```bash
# Po edycji źródeł — przebuduj adminApp.js (wymagane przed testem)
npm run build:admin-js

# Jednorazowy podział z monolitu (nie uruchamiaj na wygenerowanym adminApp.js)
npm run split:admin-js
```

**Nie edytuj ręcznie** `js/features/adminApp.js` — ma baner `GENERATED`.

W `admin/partials/01-head.html` jeden `<script defer src="js/features/adminApp.js">` (bundel: shared + billingView + mixiny).
