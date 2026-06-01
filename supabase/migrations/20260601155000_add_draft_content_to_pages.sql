-- Draft vs Published: roboczy stan kreatora oddzielony od publikowanego `content`.
-- `content`  → wersja widoczna publicznie (renderowana przez strony klientów).
-- `draft_content` → stan roboczy panelu; trafia do `content` dopiero przy "Publikuj zmiany".
-- Strony publiczne NADAL czytają wyłącznie `content` — zero regresji dla klientów końcowych.

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS draft_content JSONB DEFAULT '{}'::jsonb;

-- Backfill: dla istniejących stron kopiujemy aktualny `content` jako punkt startowy draftu,
-- żeby panel od razu miał spójny stan roboczy (gdy draft jeszcze pusty).
UPDATE public.pages
SET draft_content = content
WHERE draft_content IS NULL
   OR draft_content = '{}'::jsonb;
