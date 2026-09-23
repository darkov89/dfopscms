# DFCMS Lessons Learned & Anti-Regression Guide

> **Zbiór realnych lekcji inżynieryjnych i wzorców anty-regresyjnych.**
> Zebrany na podstawie testów runtime, code review i wdrożeń w środowiskach Staging/Production.
> Każdy agent i programista pracujący nad repozytorium DFCMS ma obowiązek stosować te zasady.

---

## 1. 🛡️ Save-First Pattern dla Akcji z Side-Effectem na Bazie

### ❌ Antywzorzec (Optimistic UI Trap)
Mutowanie stanu wiadomości, wygaszanie przycisków akcji (`hasChanges = false`, `rejected = true`) lub czyszczenie historii **przed** potwierdzeniem zapisu w Supabase / Edge.
```javascript
// BŁĄD:
const { snapshotToRestore } = rules.markMessageRejected(this.messages, msg.id);
// UI już pokazuje "odrzucono", przycisk zniknął!
const res = await repo.savePageByIdForOwner(...);
if (res.error) {
  // Podgląd iframe przeładuje się z bazy (gdzie zmiany nadal są!),
  // a użytkownik nie może ponowić odrzucenia!
}
```

### ✅ Wzorzec Wymagany (Save-First & Fail-Open UI)
1. Najpierw wykonaj asynchroniczny zapis do bazy (`savePageByIdForOwner`).
2. W razie błędu API / sieci:
   - **Nie mutuj flag wiadomości** — `hasChanges` pozostaje `true`, przycisk odrzucenia nadal jest klikalny.
   - Pokaż czytelny toast błędu i zaloguj problem.
3. Dopiero po potwierdzonym sukcesie (`!res.error`) oznacz wiadomość jako odrzuconą, odśwież iframe i zsynchronizuj stan.

---

## 2. 🔄 Dual-Stack Desynchronization (Izolacja Stosów Historii)

### ❌ Antywzorzec
Istnienie dwóch niezależnych mechanizmów cofania zmian (np. odrzucenie per-message w czacie vs ogólny przycisk "Cofnij" w toolbarze), które operują na osobnych stosach bez wzajemnej synchronizacji.
Użytkownik klika "Odrzuć tę zmianę", a potem wciska toolbar "Cofnij" — co przywraca stan odrzucony!

### ✅ Wzorzec Wymagany
Wszelkie cofnięcie lub odrzucenie stanu do punktu $T_0$ musi:
1. Przyciąć nadrzędny stos `draftHistory` do $T_0$ (usunąć wszystkie nowsze migawki).
2. Wyczyścić `draftRedoStack = []` (ścieżka "w przód" została unieważniona).
3. Oznaczyć w czacie wszystkie wiadomości nowsze niż $T_0$ jako przestarzałe (`stale = true`).

---

## 3. 🚫 Zakaz Asynchronicznych Zapisów z Wnętrza Szablonów (Iframe Side-Effects)

### ❌ Antywzorzec
Szablon publiczny (`templates/custom.html`) podczas renderowania podglądu w iframe wykonuje cichy zapis do bazy danych (np. auto-healing `theme_type`).
Powoduje to:
- Wyścigi zapisu (race conditions) z operacjami użytkownika i Agenta AI w Studio.
- Nadpisywanie świeżo odrzuconych draftów.
- Niekontrolowany ruch sieciowy i mutacje DB z powierzchni prezentacyjnej.

### ✅ Wzorzec Wymagany
- Szablony i komponenty podglądu dokonują leczenia (healingu) **wyłącznie in-memory** (`rawContent.theme_type = this.themeType`).
- Trwały zapis w bazie (`pages.draft_content` / `content`) może być wyzwalany **wyłącznie** przez nadrzędny kontroler (`studio.html`, `adminApp.js`) lub wyspecjalizowaną Edge Function (`chat-site-agent`).

---

## 4. 📦 Minimalizacja Payloadu HTTP (EU AI Act & RODO Lens)

### ❌ Antywzorzec
Przekazywanie całych obiektów wiadomości z wewnętrznym stanem widoku do endpointów AI:
```javascript
// BŁĄD: payload zawiera pełne drzewa snapshotBefore (kopie całego draftu JSON!)
body: { history: this.messages }
```

### ✅ Wzorzec Wymagany
Przed wysyłką do API zewnętrznego lub Edge Function, zawsze dokonaj projekcji (mapowania) do minimalnego kontraktu:
```javascript
const cleanHistory = (this.messages || [])
    .filter(m => !m.text?.startsWith('Przepraszam, wystąpił problem'))
    .slice(-6)
    .map(m => ({ role: m.role || 'user', text: String(m.text || '') }));
```

---

## 5. ⚓ Semantyczna Unikalność Kotwic HTML (ID Disambiguation)

### ❌ Antywzorzec
Statyczne przypisanie tego samego `id` (np. `id="faq"`) do wielu różnych klocków z tej samej kategorii (np. `faq_simple` i `faq_accordion`). Jeśli użytkownik doda oba klocki, powstaje nieprawidłowy HTML z duplikatem ID, a link w menu nawigacyjnym zawsze skacze do pierwszego.

### ✅ Wzorzec Wymagany
- Główny klocek (np. `faq_accordion`) otrzymuje `id="faq"`.
- Klocki alternatywne stosują dynamiczne powiązanie:
  `:id="hasBlock('faq_accordion') ? 'faq-lista' : 'faq'"`.
- Dzięki temu kotwica `#faq` z menu zawsze działa prawidłowo i nie tworzy duplikatów ID w DOM.

---

## 6. 🔍 Integralność Opisu w Dokumentacji (Code-Truth Alignment)

### ❌ Antywzorzec
Deklarowanie w walkthrough, CONTEXT.md lub changelogu reguł CSS lub zachowań kodu, które w rzeczywistości nie zostały dodane do pliku źródłowego.

### ✅ Wzorzec Wymagany
Wszystkie diffy i opisy w dokumentacji muszą być wiernym odzwierciedleniem kodu. Jeśli reguła nie istnieje w pliku źródłowym, nie wolno jej symulować w dokumentacji.

---

## 7. 🎯 Inline WYSIWYG & Zero-Latency Visual Studio Architecture

### ❌ Antywzorzec (Prompt Roulette & Wasting AI Quota)
Wymuszanie na użytkowniku pisania promptu do modelu językowego (np. "popraw literówkę w nagłówku...", "zamień zdjęcie na inne..."), co niepotrzebnie spala quotę tokenów AI użytkownika, wprowadza 5-10 sekund opóźnienia sieciowego i stwarza ryzyko halucynacji struktury bloków przez LLM dla trywialnych modyfikacji.

### ✅ Wzorzec Wymagany
1. **Direct Inline WYSIWYG:** Zwykłe edycje tekstowe powinny być dokonywane bezpośrednio na podglądzie canvasu (`contenteditable="plaintext-only"`), z debounced auto-save do `pages.draft_content` przez `postMessage('dfcms:inline-edit')` — z zerową latencją i bez zużywania zapytań AI.
2. **Clickable Media Picker:** Zmiana multimediów/zdjęć powinna odbywać się bezpośrednio przez klikalny selektor (`dfcms:pick-image`) oferujący upload na Supabase Storage (`{user.id}/media_*`), wybór z kolekcji lub podanie adresu URL, zamiast przesyłania plików przez czat asystenta.
3. **Pływające kontrolki sekcji (Hover Toolbars):** Każdy klocek powinien udostępniać natychmiastowe akcje strukturalne (`↑`, `↓`, `🗑️`, `✨ AI`), a przycisk `+ Dodaj sekcję tutaj` musi pozwalać na precyzyjne wstawianie komponentów z katalogu dokładnie w pożądane miejsce.
4. **Zarządzanie motywem bez LLM:** Zmiana palety barw i typografii powinna działać natychmiastowo przez zmienne CSS (`dfcms:theme-preview`) i zapis do `theme_type`/`color_palette`, a nie generowanie kodu od nowa.

---

## 8. 📱 Mobilna Architektura AI Studio (Mobile-First Viewport & Tab Swapping)

### ❌ Antywzorzec
- Używanie `fixed inset-y-16 w-full` dla szuflady czatu na urządzeniach mobilnych z domyślnym stanem `chatOpen: true`. Efekt: użytkownik widzi wyłącznie okno czatu z komunikatem „sprawdź podgląd po lewej stronie”, podczas gdy podgląd jest całkowicie zasłonięty, a nagłówek z 8 przyciskami (szerokość > 530px) ulega obcięciu na ekranach smartfonów (360-390px).
- Dodawanie sztucznych obramowań symulatora telefonu (`border-[10px] rounded-[48px] max-w-[92vw]`) na prawdziwych ekranach mobilnych, co drastycznie zawęża viewport do 300px i powoduje podwójny scroll.

### ✅ Wzorzec Wymagany
1. **Segmentowy przełącznik widoku (`mobileTab: 'preview' | 'chat'`):** Na ekranach `< sm` użytkownik ma czytelny przełącznik `[ 👁️ Podgląd ]` vs `[ 💬 Agent AI ]`.
2. **Pływające CTA na podglądzie:** Pływający przycisk `💬 Rozmawiaj z Agentem AI` na dole podglądu pozwala na natychmiastowe przejście do czatu.
3. **Kontekstowy powrót do podglądu:** Każda odpowiedź asystenta wprowadzająca modyfikację zawiera przycisk `👁️ Zobacz zmiany na podglądzie →`, który od razu przenosi użytkownika do wyrenderowanej strony.
4. **Naturalny 100% viewport mobilny:** Na prawdziwym telefonie podgląd wypełnia 100% szerokości i wysokości ekranu (`border-0 rounded-none p-0`), z obsługą `env(safe-area-inset-bottom)` w formularzu czatu.

---

## 9. 🛡️ Ochrona przed Coercion `[object Object]` we Wszystkich Warstwach Danych

### ❌ Antywzorzec
- Bezpośrednie rzutowanie wartości do stringa (`String(val)` lub interpolacja w szablonie `${val}` / `x-text="item.title"`), gdy zewnętrzne API (np. Google Places API v1 zwracające `{ primaryTypeDisplayName: { text: "Barber" } }`) lub model językowy (Gemini zwracający `{ text: "..." }` w parametrze narzędzia) przekazuje zagnieżdżony obiekt. Efekt: w UI i bazie danych pojawia się skażenie literalnym napisem `[object Object]`.

### ✅ Wzorzec Wymagany
1. **Unwrapper-First:** Wszystkie funkcje pomocnicze (`toCleanString`, `str`, `cleanString`, `stripControlAndHtml`) muszą najpierw sprawdzić, czy wartość jest obiektem i rozpakować klucze `{ text, title, name, value, desc, content }`.
2. **Filtracja literału:** Wartości równe ciągowi `'[object Object]'` muszą być automatycznie traktowane jako pusty string / fallback.
3. **Sanityzacja tablic i pętli:** W rendererach Alpine (`safeText(feat)`) oraz mutatorach (`applyBlockUpdate`, `replaceBlockItems`) tablice ciągów tekstowych (np. `pricing_tiers.features`) muszą być mapowane przez funkcję oczyszczającą przed wstawieniem do stanu reaktywnego.
