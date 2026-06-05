## UX_ROADMAP_V2 (po wdrożeniu P0)

Ten plik zbiera elementy UX, które **świadomie odkładamy** po wdrożeniu krytycznych P0 (branding, czytelność rejestracji, powiadomienia).

### 1) A11y (dostępność) — P2

- **Focus management dla modali**: focus trap, zamykanie `Esc`, powrót fokusu po zamknięciu (public templates + panel jeśli ma modale).
- **Widoczne focus ringi** dla wszystkich elementów interaktywnych (klawiatura).
- **Inline field errors** w rejestracji + `aria-describedby` + stany invalid.

### 2) Stany UI i feedback — P1/P2

- **Skeletony/loader** w panelu dla `load/save/checkout/upload` (nie tylko tekst).
- **Empty states** dla pustych sekcji (galeria/opinie/mapa/FAQ) z jasnym CTA.
- **Sticky status bar** (unsaved/publish/ostatnia publikacja).

### 3) Flow i komunikaty — P1/P2

- **Rozdzielenie flow domeny od publikacji** (jeśli nie zamknięte w P0).
- **Ujednolicenie języka błędów** (mniej technicznie, więcej “co dalej” + kontakt).
- **Spójne mikrocopy planów** (watermark/domena/limity) w landing + panel.

### 4) Jakość doświadczenia — P3

- **Onboarding checklist** w panelu (5 kroków + progress).
- **Preview link** po publikacji + szybki podgląd w nowej karcie.

### 5) Techniczne (wpływ na UX, ale nie P0)

- **Refaktor logiki panelu** (podział `adminApp.js` na moduły/use-case’y).
- **Build tooling** (Vite/bundling) w celu stabilności zależności, performance i lepszej kontroli CSP (docelowo usunięcie `'unsafe-inline'`).

