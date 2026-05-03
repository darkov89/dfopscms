-- Unikalny slug wymagany do UPSERT dem (ON CONFLICT (slug)).
-- Bezpieczne uruchomienie wielokrotne: CREATE INDEX IF NOT EXISTS.

CREATE UNIQUE INDEX IF NOT EXISTS pages_slug_unique_idx ON public.pages (slug);
