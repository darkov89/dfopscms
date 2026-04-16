# DFOPS CMS — żywa wiedza projektu

> **Cel:** jeden plik, który agent i ludzie aktualizują po istotnych zmianach. Nie zastępuje `README.md` (start, stos, deploy), ale **utrwala decyzje i gdzie co leży**.

**Ostatnia aktualizacja treści:** 2026-04-03

---

## 1. Produkt w skrócie

- Lekki CMS (wizytówki): front statyczny (HTML/JS), treść w **Supabase** (`pages`), Auth, Storage.
- Panel: **`admin.html`** + Alpine **`js/features/adminApp.js`**.
- Płatności: **Stripe** (Checkout, Customer Portal, webhooki → Edge Functions).

---

## 2. Kluczowe pliki (orientacja)

| Obszar | Pliki |
|--------|--------|
| Konfiguracja frontu | `js/core/config.js` (URL Supabase, domeny, Stripe price IDs, `supportEmail`, opcj. `passwordResetRedirectUrl`) |
| Klient Supabase | `js/core/supabaseClient.js` |
| Panel admin | `admin.html`, `js/features/adminApp.js` |
| Rejestracja | `rejestracja.html`, `js/features/registrationApp.js` |
| Edge: Stripe | `supabase/functions/stripe-webhook/`, `create-checkout/`, `create-portal-session/`, `sync-stripe-subscription/`, `change-subscription-plan/` |
| Wspólna logika Stripe + merge `content` | `supabase/functions/_shared/stripeBilling.ts` |

---

## 3. Uwierzytelnianie i reset hasła

- Logowanie: `signInWithPassword`; sesja Supabase (`DFOPS_getSupabaseClient`).
- **Reset hasła:** `resetPasswordForEmail` z `redirectTo` — canonical URL z `resolvePasswordResetRedirectUrl()` (prod → `https://{appDomain}/admin.html` gł. domena).
- **Link recovery (`type=recovery`):** `exchangeCodeForSession` w `consumeEmailConfirmParamsFromUrl`; **`isForcedPasswordReset`** = izolatka UI — **brak `loadData()`** do ustawienia hasła; po udanym `updateUser` → **toast, `replaceState` na pathname, `logout()`** — użytkownik wraca na **ekran logowania** (nie wchodzi od razu do panelu).
- **Walidacja hasła w izolatce:** min. 8 znaków, litera (`\p{L}`), cyfra; dwa pola (hasło + potwierdzenie). Zakładka Konto: nadal min. 6 znaków + zgodność pól.
- Support w UI: `supportEmailDisplay()` / `supportMailtoHref()` — domyślnie `kontakt@dfops.eu` z `config.supportEmail`.

---

## 4. Stripe i treść strony

- Źródło prawdy dla **harmonogramu opłat / `current_period_end`:** wyłącznie **`Stripe.Subscription.current_period_end`** po `subscriptions.retrieve`, zapisywane w `content.pl.settings.subscription` (merge w `stripeBilling.ts`). **Nie** używać `invoice.period_end` do ustawiania tego pola na ścieżce faktury z subskrypcją.
- Webhook: `constructEventAsync` (Deno); m.in. `invoice.paid` / `invoice.payment_succeeded` bez fallbacku na datę z faktury przy braku subskrypcji.

---

## 5. Konwencje

- Podbijanie cache panelu: query `?v=` na importach w `admin.html` przy większych zmianach JS/CSS.
- Zmiany Edge Functions: deploy przez Supabase CLI po merge.

---

## 6. Changelog (skrót)

| Data | Co |
|------|-----|
| 2026-04-03 | Żywa dokumentacja + reguła Cursor; opis auth recovery (logout), walidacji hasła, Stripe SoT, plików kluczowych |
| 2026-04-03 | Onboarding: `content.pl.settings.business_name` + powitalny modal (pusty `business_name`); migracja w `normalizeContent` dla treści sprzed pola (logo przy ukończonym kreatorze) |
| 2026-04-03 | Powitanie: po modalu tour **driver.js** (3 kroki); `welcome_onboarding_completed` w `content.pl.settings` + zapis przez `saveData`; CDN driver `1.4.0` w `admin.html` |
| 2026-04-03 | Onboarding: **nie** auto-otwieranie pełnoekranowego kreatora; checklista w treści + „!” przy zakładkach; po „Pomiń kreator” modal zamiast paska „ninja”; auto `onboarding_completed` gdy lista braków pusta |
| 2026-04-03 | Modal powitalny: copy bez zapowiedzi „oprowadzenia po kreatorze” — zgodnie z toursem Driver + opcjonalnym kreatorem z menu |

---

## 7. Jak utrzymywać ten plik

1. Po zadaniu, które zmienia zachowanie API, auth, Stripe lub układ panelu — **dopisz sekcję lub wiersz w tabeli Changelog**.
2. Jeśli stara instrukcja jest nieaktualna — **edytuj powyżej**, zamiast dorzucać sprzeczne akapity.
3. Trzymaj skrót: szczegóły implementacyjne w kodzie (komentarze), tu **decyzje i mapa**.
