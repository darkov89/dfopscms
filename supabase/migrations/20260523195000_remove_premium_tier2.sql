-- Dawny Premium (tier2) → Standard (tier1). Pakiety: Starter, Standard, Custom.

UPDATE public.billing_profiles
SET plan = 'tier1'
WHERE plan = 'tier2';

UPDATE public.pages
SET billing_plan = 'tier1'
WHERE billing_plan = 'tier2';

COMMENT ON COLUMN public.billing_profiles.plan IS 'tier0 (Starter), tier1 (Standard) — zgodnie ze Stripe price.';
