# ARCHITECTURE_ROADMAP_V2 (po MVP / po 10 płacących klientów)

Ten dokument opisuje **plan refaktoryzacji architektury** DFOPSCMS po fazie MVP. Celem jest zwiększenie **modularności**, ograniczenie **sprzężeń**, poprawa **skalowalności** (ruch + zespół), oraz uporządkowanie odpowiedzialności **frontend ↔ backend/edge**.

## Kontekst i założenia

- **Status**: MVP w fazie launch. Priorytetem jest stabilność i szybkie iteracje.
- **Moment startu**: po osiągnięciu **pierwszych 10 płacących klientów**.
- **Cel nadrzędny**: wprowadzić nowe granice i tooling **bez big-bang rewrite**.
- **Zasada**: refaktoryzujemy “po kawałku”, utrzymując kompatybilność formatów danych (`pages.content`, `template_version`) i API (Supabase/Edge Functions).

## Najważniejsze kierunki (V2)

1. **Vite + bundling** (kontrola zależności, wersjonowanie, build artifacts)
2. **ES Modules zamiast `window.*`** (jawne importy, DI przez moduły)
3. **Hexagonal Architecture (Ports & Adapters)** (oddzielenie domeny od integracji)
4. **Edge caching / publish step** (mniej fetchy do Supabase “na każdy request”)
5. **Kontrakt danych (schema governance)** (typy/JSON schema + migracje)

---

## Faza 0 — przygotowanie (1–2 dni)

**Cel**: zebrać metryki i ograniczyć ryzyko.

- **Inwentaryzacja entrypointów**:
  - public: `consultant.html`, `beauty.html`, `index.html` (router), landing / rejestracja
  - admin: `admin.html`
  - edge: `functions/_middleware.js`, `supabase/functions/*`
- **Metryki**:
  - baseline time-to-first-byte (TTFB) dla public pages (apex/subdomain/custom domain)
  - liczba requestów do Supabase per pageview (public + admin)
- **Uzgodnienie “API contract”**:
  - lista pól wymaganych do renderu public page (MVP minimal)

**DoD**:
- spis “co renderuje co” + lista plików kluczowych + metryki baseline w tym dokumencie lub w osobnym `docs/`.

---

## Faza 1 — Vite: build + dependency hygiene (2–4 dni)

**Cel**: mieć kontrolę nad zależnościami (Tailwind/Alpine/Supabase/DOMPurify), wprowadzić wersjonowanie bundle i podwaliny pod modułową architekturę.

- **Wprowadź Vite**:
  - build do `dist/`
  - przenieś JS do modułów (na start: bez zmiany logiki, tylko packaging)
- **Zależności**:
  - pinowanie wersji przez `package.json`
  - usunięcie krytycznych CDN runtime (docelowo) i zastąpienie bundlowaniem
  - (opcjonalnie) SRI jeśli część CDN zostaje tymczasowo
- **Strategia migracji**:
  - na początku: zachować HTML entrypointy, zmienić tylko `<script src="...">` na bundlowane zasoby

**Patterny**:
- “Strangler Fig” (nowe moduły wchodzą stopniowo)

**DoD**:
- `npm run dev` / `npm run build` generuje działający panel i public templates.
- assety mają wersjonowanie (cache-busting).

---

## Faza 2 — ES Modules + ograniczenie `window.*` (3–6 dni)

**Cel**: zmniejszyć sprzężenia wynikające z globalnych singletonów i kolejności `<script>` w HTML.

- **Zamiana globalnych eksportów**:
  - `window.DFOPS_*` → modułowe eksporty i importy
  - zostawić “shim” kompatybilności tylko tam, gdzie to krytyczne (krótko)
- **Jawne kompozycje**:
  - `createPublicSiteApp(...)` i `createAdminApp()` składają zależności w konstruktorze (np. repo, config, analytics)

**Patterny**:
- Dependency Injection przez moduły (bez frameworka)
- Composition Root (np. `src/entrypoints/public.ts`, `src/entrypoints/admin.ts`)

**DoD**:
- Public i admin nie wymagają już globalnych `window.DFOPS_*` (albo ich liczba spada do minimum).
- Kolejność skryptów w HTML przestaje być krytyczna.

---

## Faza 3 — Hexagonal Architecture: wyraźne granice domenowe (1–2 tygodnie)

**Cel**: poprawa separacji odpowiedzialności, spójność modułów, łatwiejsze testy i rozwój.

### 3.1 Proponowana struktura (docelowa)

- `src/domain/`
  - `pages/` (modele, walidacje, migracje contentu, `template_version`)
  - `billing/` (modele planów, uprawnienia funkcjonalne)
  - `domains/` (custom domain state machine)
- `src/app/` (use-case’y)
  - `public/` (load + render view model)
  - `admin/` (save + publish + upload)
- `src/ports/` (interfejsy)
  - `PagesRepositoryPort`
  - `AnalyticsPort`
  - `StoragePort`
  - `EdgeFunctionsPort` (checkout, domain, google reviews)
- `src/adapters/` (implementacje portów)
  - `supabase/` (repo, auth, storage)
  - `cloudflare/` (tylko jeśli potrzebne po stronie klienta; preferuj Edge Functions)
- `src/entrypoints/` (composition root)
  - `public-consultant.ts`, `public-beauty.ts`, `admin.ts`, `router.ts`

### 3.2 Najpierw rozdziel:

- `pageRepository.js`:
  - wydziel *domenę*: normalizacja, migracje, walidacje contentu (bez I/O)
  - wydziel *adapter Supabase*: same zapytania `.from('pages')...`
- `adminApp.js`:
  - wydziel use-case’y: `SavePage`, `UploadImage`, `AttachCustomDomain`, `CreateCheckout`

**Patterny**:
- Ports & Adapters (Hexagonal)
- Application Services / Use Cases
- Repository (czysty)

**DoD**:
- domena nie importuje Supabase i nie zna implementacji I/O
- adaptery są wymienne (w testach mock)

---

## Faza 4 — Edge caching / publish step (1–2 tygodnie)

**Cel**: ograniczyć “fetch contentu z Supabase na każdy request HTML” i zwiększyć wydajność przy rosnącym ruchu/tenantach.

### Opcja A (preferowana na start): Edge Cache (Cache API na Cloudflare)

- `functions/_middleware.js`:
  - cache’uj wynik fetch z Supabase REST (po kluczu: `host` + `site` + ewentualnie `lang`)
  - ustaw sensowne TTL (np. 30–120s) + “stale-while-revalidate” jeśli możliwe
- Inwalidacja:
  - po `saveData` w adminie wywołuj endpoint/edge-function do purge (lub zmieniaj cache key przez `updated_at`/etag)

### Opcja B: Publish step (pre-render)

- przy publikacji w panelu generuj “public payload” (znormalizowany, zminimalizowany) i zapisuj w osobnej tabeli/kolumnie
- middleware czyta “public payload” zamiast pełnego `content`

**Patterny**:
- Cache-aside
- CQRS-lite: osobny “read model” dla public render

**DoD**:
- TTFB spada, liczba zapytań do Supabase per request HTML spada znacząco
- publikacja ma przewidywalne opóźnienie propagacji

---

## Faza 5 — Kontrakt danych: typy + walidacja + migracje (ciągłe, 1–2 tygodnie na wdrożenie)

**Cel**: zatrzymać “schema drift” i ułatwić ewolucję `pages.content`.

- Zdefiniuj typy (TS) dla contentu per theme + wspólne pola
- Wprowadź walidację runtime (np. Zod) dla kluczowych ścieżek:
  - inbound z DB
  - inbound z panelu
- Migracje:
  - migratory per `template_version` (już istnieje) jako jawne funkcje

**Patterny**:
- Schema versioning
- Migrator pipeline

**DoD**:
- każdy release, który zmienia schema, ma migrator i test

---

## Priorytety wykonania (rekomendowane)

1. **Faza 1 (Vite)** – odblokowuje resztę (dependency control)
2. **Faza 2 (ESM + mniej globali)** – obniża sprzężenie i ryzyko regresji
3. **Faza 3 (Hexagonal)** – porządek domenowy i testowalność
4. **Faza 4 (Edge caching / publish)** – skalowanie ruchu i kosztów
5. **Faza 5 (Schema governance)** – stabilność długofalowa (może iść równolegle od Fazy 2)

---

## Notatki wdrożeniowe (ważne w tym projekcie)

- Cloudflare Pages middleware (`functions/_middleware.js`) jest dziś “krytyczną ścieżką” dla SEO i multi-domen. Każda zmiana powinna mieć możliwość szybkiego rollbacku.
- Supabase anon key będzie zawsze widoczny w przeglądarce — dlatego granice “co wolno z anon” muszą być wymuszone przez RLS i Edge Functions.
- Gdy przejdziemy na bundling, CSP da się docelowo wzmocnić (usunąć `'unsafe-inline'`) przez eliminację inline `<script>` dla Tailwind config.

