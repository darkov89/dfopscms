-- Explicit grants for PostgREST / Data API compliance (Supabase May/Oct 2026 update)
-- DFCMS: public.pages — anon (odczyt publiczny po slug / demo), authenticated (panel), service_role (Edge).
-- RLS nadal ogranicza wiersze; GRANT nadaje uprawnienia na poziomie tabeli wymagane przez Data API.

GRANT SELECT ON public.pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO service_role;
