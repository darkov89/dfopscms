-- Demo katalogowe są publiczną prezentacją template, nie stronami trialowymi.
-- Utrzymujemy je jako tier1 i czyścimy flagi blokady, żeby cron trialowy
-- oraz publiczny widok nie pokazywały komunikatu "strona niedostępna".

UPDATE public.pages
SET
  billing_plan = 'tier1',
  trial_blocked_at = NULL,
  billing_failed_at = NULL
WHERE slug IN (
  'demo-beauty',
  'demo-fitness',
  'demo-services',
  'demo-gastro',
  'demo-care',
  'demo-consultant'
);
