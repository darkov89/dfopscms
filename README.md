# DFOPS CMS (dfopscms)

Lekki CMS pod strony wizytówkowe: statyczny front (HTML + JavaScript), treść i ustawienia w **Supabase** (PostgreSQL, Auth, Storage), publikacja pod własną domeną z obsługą **Cloudflare** (Pages + Custom Hostnames).

## Stos technologiczny

- **Front:** HTML, JavaScript (moduły w `js/`), Alpine.js w panelu (`admin.html`), Tailwind (CDN) tam, gdzie używany.
- **Backend:** Supabase — uwierzytelnianie, tabela `pages`, publiczny storage obrazów.
- **Edge Functions (Supabase, Deno):** m.in. `add-custom-domain` (Cloudflare for SaaS), `get-google-reviews`.
- **Hosting:** Cloudflare Pages z `functions/_middleware.js` (SEO, routing pod custom domain, wstrzykiwanie treści z API).

## Struktura katalogów (skrót)

| Ścieżka | Znaczenie |
|--------|-----------|
| `admin.html` | Panel administratora (logowanie, edycja treści, domena, szablony) |
| `index.html`, `consultant.html`, `beauty.html`, … | Szablony / strony publiczne |
| `js/core/config.js` | **Konfiguracja klienta:** `supabaseUrl`, `supabaseAnonKey`, domeny systemowe, presety |
| `js/core/supabaseClient.js` | Singleton klienta Supabase |
| `js/core/pageRepository.js` | Odczyt i zapis stron użytkownika (REST) |
| `js/features/adminApp.js` | Logika panelu admina |
| `js/features/routerApp.js` | Routing pod wieloma domenami (host → strona) |
| `supabase/functions/` | Kod Edge Functions (deploy przez Supabase CLI) |
| `functions/_middleware.js` | Middleware Cloudflare Pages |

## Konfiguracja frontu

1. Skopiuj lub edytuj `js/core/config.js`.
2. Ustaw `supabaseUrl` i `supabaseAnonKey` z panelu Supabase (Project Settings → API).
3. Dopasuj `appDomain`, `systemDomains` i `localHosts` do swojej infrastruktury DNS / hostingu.

> Klucz anonimowy (publishable) jest przeznaczony do użycia w przeglądarce — i tak jest widoczny w bundle; nadal nie commituj **service role** ani sekretów serwerowych do repozytorium.

## Supabase Edge Functions

Wdrożenie (lokalnie, z zainstalowanym [Supabase CLI](https://supabase.com/docs/guides/cli)):

```bash
supabase functions deploy add-custom-domain
supabase functions deploy get-google-reviews
```

### Zmienne środowiskowe funkcji (Secrets)

W projekcie Supabase ustaw m.in.:

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — zwykle ustawiane automatycznie w środowisku Edge.
- **`add-custom-domain`:** `CF_ZONE_ID`, `CF_API_TOKEN` (token z uprawnieniami do Custom Hostnames w strefie Cloudflare).

## Cloudflare Pages (`functions/`)

W projekcie Pages ustaw zmienne środowiskowe:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Szczegóły w nagłówku `functions/_middleware.js`.

## Rozwój lokalny

Front to pliki statyczne — wystarczy serwer HTTP (np. Live Server, `python3 -m http.server`, `npx serve`).

**Nie otwieraj `admin.html` z `file://`** — wywołania do Supabase i Edge Functions wymagają originu `http://` lub `https://`.

## Własna domena (skrót przepływu)

1. W panelu (**Szablon i kolory**) użytkownik wpisuje hostname i używa **„Podepnij domenę”** — po potwierdzeniu wykonywany jest zapis treści (`saveData`), potem wywołanie `add-custom-domain`, które tworzy Custom Hostname w Cloudflare i aktualizuje rekord w `pages`.
2. Instrukcje DNS (rekordy CNAME) są pokazywane w panelu po sukcesie; propagacja DNS bywa od kilku minut do 24 h.

## Licencja

Określ licencję repozytorium tutaj lub w osobnym pliku `LICENSE`.
