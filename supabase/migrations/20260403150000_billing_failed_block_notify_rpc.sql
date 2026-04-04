-- Okres karencji po problemie z płatnością subskrypcji (Stripe / ręczna flaga).
-- billing_failed_at — po 14 dniach cron ustawia trial_blocked_at (definicja funkcji w 20260403160000).
-- Powodzenie płatności: trial_blocked_at = NULL, billing_failed_at = NULL.

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS trial_blocked_at timestamptz;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS billing_failed_at timestamptz;

COMMENT ON COLUMN public.pages.billing_failed_at IS 'Pierwszy znacznik problemu z płatnością; po 14 dniach cron ustawia trial_blocked_at. Czyść przy udanej płatności.';
