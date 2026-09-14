# DFCMS Agent Operating Guidelines & Architectural Lenses

> **Główny dokument operacyjny dla wszystkich asystentów AI i agentów pracujących nad repozytorium DFCMS.**
> Obowiązuje bezwzględnie w każdym wątku, czacie i przy każdym zadaniu.

---

## 🏛️ Zasada Nadrzędna: ANTI-MONOLITH (Extract-First)

**Najważniejsza zasada inżynieryjna repozytorium: Nigdy nie pozwól na dalszy rozrost monolitów.**

Główne pliki historyczne (`js/features/adminApp.js`, `publicSiteApp.js`, `admin.html`) nie mogą być powiększane o nową logikę biznesową. Zanim dopiszesz choćby kilka linii kodu, zatrzymaj się i zastosuj regułę **Extract Before Grow**:

1. **Logika domenowa, reguły biznesowe, walidacje, kalkulacje:**
   * Trafiają do `js/core/<nazwa>Rules.js` jako **czyste funkcje (pure functions)** bez zależności od Alpine.js, Supabase UI czy DOM.
   * Muszą być w 100% testowalne jednostkowo w środowisku Node.js (`npm test`).
2. **Panele, moduły UI i interakcje:**
   * Trafiają do dedykowanego katalogu `js/features/<nazwa_modułu>/`.
   * Są dołączane do aplikacji panelowej wyłącznie za pomocą **pionowego wzorca attach** (`window.DFOPS_attach<Feature>(app)`).
   * **ZAKAZ mixinów i spreadu:** `{ ...createAdminApp(), ...mixin }` oraz `Object.assign` z getterami niszczą Proxy w Alpine.js 3.
   * Metody w attach muszą być nazwanymi funkcjami (`function foo() {}`), **zakaz arrow functions**, aby `this` poprawnie wskazywał na instancję Proxy Alpine.
   * Stan reaktywny musi być zadeklarowany z góry w literałowym obiekcie `createAdminApp()` z wartościami początkowymi (`null`, `false`, `''`, `[]`).
3. **HTML panelu:**
   * **BEZWZGLĘDNY ZAKAZ bezpośredniej edycji `admin.html`**. Plik ten jest generowany z `admin/partials/*.html`.
   * Wszelkie zmiany wprowadza się w odpowiednim pliku partial w `admin/partials/`, a następnie uruchamia `npm run build:admin`.

---

## 🔎 4 Obowiązkowe Soczewki Audytowe (Always-On Lenses)

Każde rozwiązanie techniczne, propozycja kodu i edycja MUSI przejść weryfikację przez poniższe soczewki:

```
[Audyt Soczewek]:
1. 🏛️ Anti-Monolith Lens      -> Czyste funkcje w js/core/ + wzorzec attach? Brak spreadu? Brak edycji admin.html?
2. 🛡️ Security Lens           -> RLS szczelne? Anon bez dostępu do draftu? CSP nienaruszone? Brak Prototype Pollution?
3. 🇪🇺 EU AI Act Lens          -> Art. 50 spełniony? Użytkownik wie o AI? Badge na witrynie? Human-in-the-loop (Undo/edycja)?
4. 🔒 RODO / GDPR Lens        -> Minimalizacja danych w JSON? Retencja trialu (purge 30 dni)? Brak zbędnych danych osobowych?
5. 🌍 Living Context Lens     -> docs/CONTEXT.md sprawdzony przed i zaktualizowany po? Staging vs Prod zweryfikowane?
```

### 1. 🏛️ Soczewka Architektoniczna (Anti-Monolith & Modular Kernel)
* Sprawdź, czy nowa funkcjonalność to nie "doklejka" do `adminApp.js`.
* W `adminApp.js` zostaje jedynie wywołanie hooka lub rejestracja w lifecycle (`app.onAfterLoadData`, `app.onAfterPublish`).
* Skrypty ładowane w `admin/partials/01-head.html` z atrybutem `defer` PRZED `adminApp.js` i PRZED biblioteką Alpine.

### 2. 🛡️ Soczewka Bezpieczeństwa (Security & Isolation)
* **Supabase & RLS:** Tabele `pages` i `billing_profiles` chronione przez RLS. Anonimowy klient ma dostęp tylko do opublikowanego `content` w aktywnych stronach.
* **Soft-block trialu:** RPC `get_public_site_route` dla wygasłych stron zwraca status 200 z `noindex`, ale **bez ujawniania `content`**.
* **Cloudflare CSP:** W `functions/_middleware.js` chronione są dyrektywy `default-src`, `frame-ancestors`, `connect-src` i `script-src`. Zakaz nieuzasadnionych wildcardów.
* **Prototype Pollution:** Wszelkie metody scalające lub aktualizujące obiekty (`applyBlockUpdate`, `aiBusinessContext`, `contentSchema`) muszą blokować klucze `__proto__`, `constructor`, `prototype`.

### 3. 🇪🇺 Soczewka EU AI Act (Rozporządzenie UE 2024/1689)
* **Artykuł 50 (Obowiązek informacyjny i przejrzystość):** Każdy moduł korzystający ze sztucznej inteligencji (AI Studio, Generator Treści, asystent) musi informować użytkownika o interakcji z modelem językowym (Gemini).
* **AI Content Disclosure / Badge:** Publiczne strony tworzone w kreatorach AI na darmowych/trialowych planach posiadają badge informacyjny (`⚡ Stworzono w DFCMS AI`).
* **Human-in-the-loop & Odwracalność:** Użytkownik musi mieć możliwość weryfikacji, edycji, odrzucenia lub cofnięcia (Undo/Redo) każdej zmiany zasugerowanej przez AI przed jej trwałym opublikowaniem.
* **Zakaz Deceptive Patterns:** AI nie generuje fałszywych certyfikatów, referencji medycznych ani wprowadzających w błąd oznaczeń prawnych.

### 4. 🔒 Soczewka RODO / GDPR (Rozporządzenie UE 2016/679)
* **Minimalizacja danych (Art. 5 ust. 1 lit. c):** CMS nie gromadzi w schematach stron nadmiarowych danych osobowych. Struktura `pages.content` zawiera tylko dane publiczne firmy i niezbędne linki kontaktowe.
* **Retencja i prawo do zapomnienia (Art. 17 i 5 ust. 1 lit. e):** Zablokowane i porzucone witryny trialowe podlegają zautomatyzowanemu cyklowi retencji (ostrzeżenie po 23 dniach, purging po 30 dniach przez procedury `expire-trial-pages`).
* **Zgody i analityka:** Kody śledzące (Google Analytics, Meta Pixel, GTM) są uruchamiane zgodnie z zasadami transparentności i polityką prywatności (`polityka.html`).

---

## 🤖 Dedykowane Role Subagentów

W razie potrzeby pogłębionej weryfikacji zadania, agent może oddelegować audyt do wyspecjalizowanych person:

1. **`anti-monolith-architect`**: Nadzór nad architekturą modułową, separacją czystych funkcji do `js/core/`, wzorcem `window.DFOPS_attach*(app)` i integralnością kompilacji `admin.html`.
2. **`security-auditor`**: Szczegółowy audyt RLS w PostgreSQL, reguł CSP w Cloudflare Pages, podatności JS i izolacji tenantów.
3. **`ai-act-compliance`**: Sprawdzenie wymogów Rozporządzenia UE 2024/1689, disclaimera AI, oznakowania treści wygenerowanych i kontroli ludzkiej.
4. **`rodo-gdpr-guardian`**: Kontrola przetwarzania danych osobowych, procedur retencji bazy danych oraz zgodności formularzy i polityki prywatności.

---

## 🧪 Zasada Weryfikacji w Testach (`npm test`)

Wszystkie powyższe zasady nie są tylko deklaracjami w dokumentacji – **są stale weryfikowane przez automatyczny pakiet testów w repozytorium**:
* `test:monolith-guard` — weryfikuje synchronizację `admin.html` z partialami oraz zakazane wzorce w kodzie Alpine/JS.
* `test:security` — weryfikuje szczelność nagłówków CSP i ochronę przed Prototype Pollution.
* `test:ai-act-rodo` — weryfikuje obecność disclaimera AI, badge'a transparentności oraz reguł retencji i minimalizacji danych.
* `test` — uruchamia pełen zestaw testów przed jakimkolwiek wdrożeniem.

---

## 📚 Baza Wiedzy i Wzorce Anty-Regresyjne

* Szczegółowe studia przypadków, błędy runtime i reguły unikania regresji (Save-First, History Stack Sync, zakaz DB writes w iframe, RODO payload strip) znajdują się w **[`docs/LESSONS_LEARNED.md`](docs/LESSONS_LEARNED.md)**. Obowiązuje zapoznanie się z nimi przed modyfikacją AI Studio i szablonów.
