---
name: trello-dfcms
description: >-
  Integracja z tablicą Trello projektu DFCMS (https://trello.com/b/cOmeKcyQ/dfcms).
  Używaj do sprawdzania backlogu, pobierania zadań, aktualizacji statusów kart,
  przenoszenia kart (To do, In progress, Done, Future) oraz dodawania komentarzy
  i raportów wdrożeniowych.
---

# Trello — DFCMS

Tablica projektu DFCMS: [https://trello.com/b/cOmeKcyQ/dfcms](https://trello.com/b/cOmeKcyQ/dfcms)
- **Board ID**: `69bec5f8834fd43d93d3b716`
- **Konfiguracja**: Dane uwierzytelniające (`TRELLO_API`, `TRELLO_TOKEN`) znajdują się w `.env.local`.

## Kolumny na Tablicy (Listy)

| Nazwa Listy | ID Listy | Przeznaczenie |
|-------------|----------|---------------|
| **To do** | `69bec5fd9c3991a3e4c3fc9a` | Zadania oczekujące na realizację |
| **In progress** | `69bec600b5fd6a81ad9d8cb3` | Zadania aktualnie realizowane |
| **Done** | `69bec601496a8e71aef31561` | Zadania zakończone i zweryfikowane |
| **Future** | `69bec608f015cb7e404a454b` | Pomysły i rozwój w dalszej perspektywie |

## Dostępne Narzędzia CLI

W projekcie dostępny jest skrypt `tools/trello.mjs`:

```bash
# 1. Sprawdzenie stanu tablicy i liczby zadań
node tools/trello.mjs status
npm run trello

# 2. Wyświetlenie wszystkich kart lub wybranej kolumny
node tools/trello.mjs list
node tools/trello.mjs list "To do"
node tools/trello.mjs list "In progress"

# 3. Wyświetlenie szczegółów danej karty (opis, komentarze)
node tools/trello.mjs show <cardId_lub_nazwa>

# 4. Przeniesienie karty do innej kolumny
node tools/trello.mjs move <cardId_lub_nazwa> "In progress"
node tools/trello.mjs move <cardId_lub_nazwa> "Done"

# 5. Dodanie komentarza ze statusem wdrożenia
node tools/trello.mjs comment <cardId_lub_nazwa> "🚀 Wdrożono i przetestowano: ..."

# 6. Dodanie nowej karty
node tools/trello.mjs add "To do" "Nazwa zadania" "Szczegółowy opis"
```

## Workflow Pracy z Zadaniami

1. **Pobranie zadania**: Wyświetl `node tools/trello.mjs list "To do"` i wybierz zadanie.
2. **Rozpoczęcie prac**: Przenieś kartę do `In progress` (`node tools/trello.mjs move <id> "In progress"`).
3. **Zakończenie i weryfikacja**:
   - Uruchom testy repozytorium: `npm test`.
   - Przenieś kartę do `Done` (`node tools/trello.mjs move <id> "Done"`).
   - Dodaj komentarz z opisem wykonanych prac i wynikami testów (`node tools/trello.mjs comment <id> "..."`).
