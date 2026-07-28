# Roadmap

> **Plan strategiczny** po fazie MVP / po ~10 płacących klientach. Stan bieżący produkcji: [`CONTEXT.md`](CONTEXT.md).

**Ostatnia aktualizacja:** 2026-07-28 — Uniwersalne nazwy docs

---

## 0. Silnik Wzrostu (Growth Autopilot)

**Priorytet produktowy post-MVP** — CMS, który po publikacji strony co tydzień podpowiada jedną zmianę związaną z klientami (telefon, rezerwacja, opinie), z licznikami konwersji i benchmarkami branżowymi.

**Spec wdrożeniowy (fazy G0–G4, DB, Edge, panel):** [`docs/specs/growth.md`](specs/growth.md).

Nie blokuje architektury V2 poniżej — fazy G0–G1 można wdrażać na obecnym stacku (bez Vite/bundlera).

---

## 0b. Wielojęzyczność witryn (i18n) — PL + EN + DE

**Spec:** [`docs/specs/i18n.md`](specs/i18n.md) — fazy L0–L4 (wdrożone w kodzie 2026-07-23).

- Jeden `pages` row; `meta.locales` + bloki `pl`/`en`/`de`; URL `/` vs `/en` vs `/de`; hreflang; AI generate/adapt.
- Starter = tylko PL; Standard/Custom = do 3 locale.
- Panel: przełącznik języka edycji + Dashboard dodaj/usuń.

---

## 0c. Język UI platformy (PL / EN)

**Cel:** landing, rejestracja i logowanie w EN dla użytkowników spoza PL (VPN / zagraniczny rynek). **Nie** mylić z i18n treści witryn (§0b).

| Faza | Zakres | Status |
|------|--------|--------|
| U1 | Landing + rejestracja + ekran logowania; przełącznik PL\|EN; `localStorage` | **wdrożone** 2026-07-24 |
| U2 | Panel CMS po zalogowaniu (toasty, zakładki, kreator) | backlog |
| U3 | Regulamin / Polityka EN albo jasny disclaimer | backlog |

**Decyzja:** ręczny wybór > geo/IP (VPN myli). Auto z przeglądarki tylko jako sugestia startowa.

---

## 1. Architektura V2

**Kontekst:** MVP w fazie launch. Refaktoryzacja **po kawałku**, bez big-bang rewrite. Kompatybilność: `pages.content`, `template_version`, API Supabase/Edge.

**Kierunki:**

1. **Vite + bundling** — kontrola zależności, wersjonowanie, build artifacts
2. **ES Modules zamiast `window.*`** — jawne importy, DI przez moduły
3. **Hexagonal Architecture (Ports & Adapters)** — domena oddzielona od integracji
4. **Edge caching / publish step** — mniej fetchy do Supabase na każdy request HTML
5. **Kontrakt danych (schema governance)** — typy/JSON schema + migracje

### Faza 0 — przygotowanie (1–2 dni)

- Inwentaryzacja entrypointów: public (`index.html`, szablony), `admin.html`, `functions/_middleware.js`, `supabase/functions/*`
- Metryki baseline: TTFB public pages; liczba requestów Supabase per pageview
- Uzgodnienie minimalnego API contract do renderu public page

**DoD:** spis „co renderuje co” + metryki baseline.

### Faza 1 — Vite: build + dependency hygiene (2–4 dni)

- Vite → `dist/`; JS do modułów (na start bez zmiany logiki)
- Pinowanie wersji w `package.json`; docelowo usunięcie krytycznych CDN runtime
- HTML entrypointy na początku bez zmian — tylko `<script>` → bundlowane assety

**Pattern:** Strangler Fig.

**DoD:** `npm run dev` / `npm run build` działają; cache-busting assetów.

### Faza 2 — ES Modules + ograniczenie `window.*` (3–6 dni)

- `window.DFOPS_*` → eksporty modułowe; shim kompatybilności tylko gdzie konieczne
- `createPublicSiteApp()` / admin składają zależności w composition root (`src/entrypoints/`)

**DoD:** brak krytycznej zależności od kolejności `<script>` w HTML.

### Faza 3 — Hexagonal Architecture (1–2 tygodnie)

**Docelowa struktura:**

- `src/domain/` — pages, billing, domains
- `src/app/` — use-case’y public/admin
- `src/ports/` — `PagesRepositoryPort`, `AnalyticsPort`, `StoragePort`, `EdgeFunctionsPort`
- `src/adapters/` — `supabase/`, ewent. `cloudflare/`
- `src/entrypoints/` — composition root per szablon

**Pierwsze rozdzielenia:** `pageRepository.js` (domena vs adapter Supabase); `adminApp.js` → `SavePage`, `UploadImage`, `AttachCustomDomain`, `CreateCheckout`.

**DoD:** domena nie importuje Supabase; adaptery wymienne w testach.

### Faza 4 — Edge caching / publish step (1–2 tygodnie)

**Opcja A (preferowana):** Cache API w `functions/_middleware.js` — cache fetch Supabase REST (klucz: host + site + lang), TTL 30–120s; inwalidacja po publish.

**Opcja B:** Publish step — znormalizowany „public payload” przy publikacji (CQRS-lite read model).

**DoD:** niższy TTFB; przewidywalna propagacja po publikacji.

### Faza 5 — Kontrakt danych (1–2 tygodnie, ciągłe)

- Typy TS per theme + wspólne pola
- Walidacja runtime (np. Zod) inbound z DB i panelu
- Migratory per `template_version` jako jawne funkcje

**DoD:** każda zmiana schema ma migrator i test.

### Priorytet wykonania (rekomendowany)

1. Faza 1 (Vite)
2. Faza 2 (ESM)
3. Faza 3 (Hexagonal)
4. Faza 4 (Edge caching)
5. Faza 5 (Schema governance — równolegle od Fazy 2)

### Notatki wdrożeniowe

- `functions/_middleware.js` — krytyczna ścieżka SEO/multi-domen; każda zmiana z planem rollbacku.
- Anon key zawsze w przeglądarce — granice wymuszane przez RLS i Edge Functions.
- Po bundlingu: możliwość zaostrzenia CSP (usunięcie `'unsafe-inline'` dla Tailwind config).

---

## 2. UX i dostępność

Elementy **świadomie odkładane** po wdrożeniu krytycznych P0 (branding, rejestracja, powiadomienia).

### A11y — P2

- **Focus management modali:** focus trap, `Esc`, powrót fokusu (public + panel)
- **Widoczne focus ringi** — nawigacja klawiaturą
- **Inline field errors** w rejestracji + `aria-describedby` + stany invalid

### Stany UI i feedback — P1/P2

- **Skeletony/loader** w panelu (`load` / `save` / `checkout` / `upload`)
- **Empty states** (galeria, opinie, mapa, FAQ) z CTA
- **Sticky status bar** (unsaved / publish / ostatnia publikacja)

### Flow i komunikaty — P1/P2

- **Rozdzielenie flow domeny od publikacji** (jeśli nie domknięte w P0)
- **Ujednolicenie języka błędów** — mniej technicznie, więcej „co dalej” + kontakt
- **Spójne mikrocopy planów** (watermark, domena, limity) — landing + panel

### Jakość doświadczenia — P3

- **Onboarding checklist** w panelu (5 kroków + progress)
- **Preview link** po publikacji + szybki podgląd w nowej karcie

### Techniczne (wpływ na UX)

- Refaktor `adminApp.js` na moduły/use-case’y
- Vite/bundling — stabilność zależności, performance, lepsza kontrola CSP

---

## 3. Aktywny backlog MVP (Tickets)

Lista gotowa do Trello / Jira / GitHub Issues.

### P0 — Krytyczne

| # | Ticket | DoD | Pliki |
|---|--------|-----|-------|
| 1 | **Ujednolicić branding (DFCMS vs DFOPSCMS)** | 1 nazwa produktu wszędzie; spójne tytuły i komunikaty | `index.html`, `rejestracja.html`, `admin.html` |
| 2 | **Czytelność zgody (Regulamin/Polityka) w rejestracji** | Kontrast OK na ciemnym tle; wyraźne linki; duży obszar kliknięcia | `rejestracja.html` |
| 3 | **Zastąpić `alert()` spójnym komponentem** | Toast/banner z „Spróbuj ponownie”; brak `alert()` | `js/features/adminApp.js` |
| 4 | **Domena ≠ publikacja — rozdzielić flow** | Podpięcie domeny nie wymusza publikacji wszystkich zmian; jasne kroki | `admin.html`, `js/features/adminApp.js` |

### P1 — Ważne

| # | Ticket | DoD | Pliki |
|---|--------|-----|-------|
| 5 | **Sticky status bar (unsaved/publish)** | „Masz nieopublikowane zmiany”, „Ostatnia publikacja”, CTA Zapisz/Opublikuj | `admin.html`, `adminApp.js` |
| 6 | **Empty states w panelu** | Instrukcja + CTA „Dodaj pierwszy element” dla pustych sekcji | `admin.html`, `adminApp.js` |
| 7 | **Finalny adres strony po rejestracji** | Pokaż `slug.dfcms.pl` + info o własnej domenie w Standard | `rejestracja.html` |
| 8 | **Ujednolicić język błędów** | Problem + 1–2 kroki naprawy + kontakt wsparcia | `adminApp.js`, `registrationApp.js` |
| 9 | **Loading states (skeleton/spinner)** | Stan ładowania przy load/save/checkout/upload; blokada przycisków | `admin.html`, `adminApp.js` |

### P2 — A11y / jakość

| # | Ticket | DoD | Pliki |
|---|--------|-----|-------|
| 10 | **Focus management modali** | Focus trap, ESC, powrót fokusu | `templates/consultant.html`, `templates/beauty.html`, opcj. `admin.html` |
| 11 | **Widoczne focus ringi** | Test klawiaturą przechodzi | `css/styles.css`, HTML |
| 12 | **Inline field errors w rejestracji** | Błędy przy polach, `aria-describedby`, invalid | `rejestracja.html`, `registrationApp.js` |
| 13 | **Spójne mikrocopy planów** | Kiedy znika watermark; co daje domena | `index.html`, `admin.html`, szablony publiczne |

### P3 — Nice-to-have

| # | Ticket | DoD | Pliki |
|---|--------|-----|-------|
| 14 | **Onboarding checklist w panelu** | 5 kroków + progress; linki do sekcji | `admin.html`, `adminApp.js` |
| 15 | **Preview link po publikacji** | Link do strony + „Otwórz w nowej karcie” | `admin.html`, `adminApp.js` |

---

## Powiązane TO-DO z MASTER CONTEXT (operacyjne, nie UX)

| Priorytet | Zadanie |
|-----------|---------|
| Wysoki | Tour Driver.js — mobile |
| Średni | Smoke webhook Stripe; inline validation w panelu |
| Niższy | CI deploy Edge; monitoring failed invocations; zaawansowany CMP (cofnięcie tagów bez reload) |
