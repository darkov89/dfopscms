# Silnik Wzrostu (Growth Autopilot) — moduł panelu

Pierwszy pionowy wycinek produktowy poza monolitem `js/features/adminApp.js`.
Pełna specyfikacja: [`docs/GROWTH_AUTOPILOT_ARCHITECTURE.md`](../../../docs/GROWTH_AUTOPILOT_ARCHITECTURE.md) (§14).

## Warstwy

```
js/core/growthRules.js              ← domena (pure functions, bez Alpine, bez Supabase)
js/features/growth/
  growthRepository.js               ← adapter DB (benchmarks, RPC stats, wiek strony)
  growthPanel.js                    ← wiązanie Alpine (stan + metody UI dashboardu) + hook
  README.md                         ← ten plik
js/core/siteAnalytics.js            ← tracking publiczny (osobny, współdzielony z szablonami)
```

| Warstwa | Zależności dozwolone | Zakaz |
|---------|----------------------|-------|
| `growthRules.js` | `themeConfig` (`DFOPS_themeHasSection`), `planUtils` (`DFOPS_planAllowsQuickChat`) | Alpine, Supabase, `adminApp` |
| `growthRepository.js` | `DFOPS_getSupabaseClient`, config | Alpine, reguły UI |
| `growthPanel.js` | reguły + repository + host (`app`) | bezpośredni SQL poza repository |

IIFE + `window.DFOPS_*` (bez bundlera, bez ESM) — spójne z resztą repo.

## Kontrakt hosta (`adminApp.js`)

`window.DFOPS_attachGrowthPanel(app)` **mutuje** obiekt `app` (bez spreadu — niszczyłby gettery
Alpine 3). Wywoływane raz, na końcu `buildAdminAlpineState()`:

```javascript
if (typeof window.DFOPS_attachGrowthPanel === 'function') {
  window.DFOPS_attachGrowthPanel(fromApp);
}
```

Growth **czyta** z hosta (nie duplikuje stanu): `this.theme`, `this.slug`, `this.pageId`,
`this.content` (draft), `this.supabase`, `this.setTab(tabId)`, `this.scheduleDraftAutosave()` /
`this.autosaveDraftNow()`. Jeśli host nie ma pola — growth nie crashuje (guard + `growthLoading: false`).

Growth dodaje na `app`: `growthLoading`, `growthBenchmarks`, `growthWeekStats`, `growthPriority`,
`growthHasEnoughData`, `growthDataError`, oraz metody `loadGrowthData()`, `refreshGrowthPriority()`,
`dismissGrowthPriority()`, `goToGrowthAction()`. Owija `app.afterLoadData` (jeśli istnieje) lub
`app.loadData` — po każdym wczytaniu strony odświeża priorytet tygodnia.

## Kolejne moduły panelu (po Growth)

Ten sam wzorzec — **nie** powrót do mixins per warstwa techniczna (rollback 2026-07-04,
`docs/MASTER_CONTEXT.md` §4):

| Moduł (przyszłość) | Katalog | Hook |
|---------------------|---------|------|
| Subskrypcja / billing UI | `js/features/billing-panel/` | `DFOPS_attachBillingPanel` |
| Kreator | `js/features/wizard-panel/` | `DFOPS_attachWizardPanel` |
