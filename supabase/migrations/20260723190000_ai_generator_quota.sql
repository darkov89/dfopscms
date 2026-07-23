-- AI Site Generator — licznik generacji miesięcznych (aktualizacja tylko z Edge service_role).
ALTER TABLE public.billing_profiles
  ADD COLUMN IF NOT EXISTS ai_gen_month text,
  ADD COLUMN IF NOT EXISTS ai_gen_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.billing_profiles.ai_gen_month IS
  'Miesiąc kalendarzowy YYYY-MM dla licznika AI Site Generator.';
COMMENT ON COLUMN public.billing_profiles.ai_gen_count IS
  'Liczba udanych wywołań generate-ai-content w bieżącym ai_gen_month.';
