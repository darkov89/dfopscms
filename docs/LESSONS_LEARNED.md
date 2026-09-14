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
