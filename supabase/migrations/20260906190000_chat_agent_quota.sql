-- AI Studio Chat Agent — oddzielny licznik zapytań asystenta w edytorze Studio (aktualizacja z Edge service_role).
ALTER TABLE public.billing_profiles
  ADD COLUMN IF NOT EXISTS agent_chat_month text,
  ADD COLUMN IF NOT EXISTS agent_chat_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.billing_profiles.agent_chat_month IS
  'Miesiąc kalendarzowy YYYY-MM dla licznika zapytań chat-site-agent w Studio.';
COMMENT ON COLUMN public.billing_profiles.agent_chat_count IS
  'Liczba wywołań chat-site-agent w bieżącym agent_chat_month.';
