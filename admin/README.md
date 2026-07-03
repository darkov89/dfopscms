# Panel admin — źródła HTML

`admin.html` w korzeniu repo jest **generowany**. Nie edytuj go ręcznie.

## Edycja

1. Zmień pliki w `admin/partials/` (np. `tab-dashboard.html`, `12-sidebar.html`).
2. Zbuduj: `npm run build:admin`
3. Commit: partials + wygenerowany `admin.html`.

## Awaryjny re-split

Gdy `admin.html` był edytowany poza partials:

```bash
npm run split:admin   # admin.html → admin/partials/
npm run build:admin   # weryfikacja składania
```

Kolejność plików: `admin/manifest.json`.
