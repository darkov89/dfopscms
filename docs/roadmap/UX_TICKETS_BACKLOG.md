## UX Tickets — Backlog (MVP)

Poniżej jest lista ticketów UX gotowa do przeniesienia do Trello/Jira/GitHub Issues.

### P0 — Krytyczne

1) **Ujednolicić branding (DFCMS vs DFOPSCMS)**
- **DoD**: 1 nazwa produktu wszędzie + spójne tytuły stron + komunikaty
- **Pliki**: `index.html`, `rejestracja.html`, `admin.html`

2) **Poprawić czytelność zgody (Regulamin/Polityka) w rejestracji**
- **DoD**: kontrast OK na ciemnym tle, linki wyraźne, duży obszar kliknięcia
- **Pliki**: `rejestracja.html`

3) **Zastąpić `alert()` w krytycznych flow spójnym komponentem komunikatu**
- **DoD**: toast/banner z akcją „Spróbuj ponownie”, brak `alert()`
- **Pliki**: `js/features/adminApp.js`

4) **Domena ≠ publikacja — rozdzielić flow**
- **DoD**: podpięcie domeny nie wymusza publikacji wszystkich zmian; jasne kroki + komunikaty
- **Pliki**: `admin.html`, `js/features/adminApp.js`

### P1 — Ważne

5) **Sticky status bar w panelu (unsaved/publish)**
- **DoD**: pasek statusu: „Masz nieopublikowane zmiany”, „Ostatnia publikacja”, CTA: Zapisz/Opublikuj
- **Pliki**: `admin.html`, `js/features/adminApp.js`

6) **Lepsze empty states w panelu (galeria/opinie/mapa/FAQ)**
- **DoD**: dla pustych sekcji pokazuj instrukcję + CTA „Dodaj pierwszy element”
- **Pliki**: `admin.html`, `js/features/adminApp.js`

7) **Prezentacja finalnego adresu strony po rejestracji**
- **DoD**: pokaż `slug.dfcms.pl` + informacja o własnej domenie w Pro (zamiast samego `?site=`)
- **Pliki**: `rejestracja.html`

8) **Ujednolicić język błędów (mniej technicznie, co dalej)**
- **DoD**: błąd = problem + 1–2 kroki naprawy + kontakt do wsparcia
- **Pliki**: `js/features/adminApp.js`, `js/features/registrationApp.js`

9) **Loading states w panelu (skeleton/spinner + blokada akcji)**
- **DoD**: jasny stan ładowania przy `load/save/checkout/upload`, blokada przycisków, feedback postępu
- **Pliki**: `admin.html`, `js/features/adminApp.js`

### P2 — A11y / jakość

10) **Focus management dla modali (ESC, trap, return focus)**
- **DoD**: focus trap, ESC zamyka, powrót fokusu po zamknięciu
- **Pliki**: `consultant.html`, `beauty.html` (opcjonalnie `admin.html`)

11) **Widoczne focus ringi dla elementów interaktywnych**
- **DoD**: focus ring widoczny na wszystkich kontrolkach, test klawiaturą przechodzi
- **Pliki**: `css/styles.css` + HTML

12) **Inline field errors w rejestracji + `aria-describedby`**
- **DoD**: błędy przy polach, `aria-describedby`, stan invalid
- **Pliki**: `rejestracja.html`, `js/features/registrationApp.js`

13) **Spójne mikrocopy dla planów i ograniczeń (watermark/domena)**
- **DoD**: jednoznaczne opisy planów, kiedy znika znak wodny, co daje domena
- **Pliki**: `index.html`, `admin.html`, public templates

### P3 — Nice-to-have

14) **Onboarding checklist w panelu**
- **DoD**: checklist 5 kroków + progress; linki do odpowiednich sekcji
- **Pliki**: `admin.html`, `js/features/adminApp.js`

15) **Preview link i szybki podgląd po publikacji**
- **DoD**: po publikacji link do strony + „Otwórz w nowej karcie”
- **Pliki**: `admin.html`, `js/features/adminApp.js`

