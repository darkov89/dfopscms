-- Lustrzany plan na pages (anon: watermark, blokada trial) + backfill billing_profiles z JSON.
ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS billing_plan text NOT NULL DEFAULT 'trial';

COMMENT ON COLUMN public.pages.billing_plan IS
  'Plan rozliczeniowy (trial, tier0–tier2). Aktualizuje service_role z billing_profiles; nie edytować z panelu.';

INSERT INTO public.billing_profiles (
  user_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  current_period_end,
  cancel_at_period_end
)
SELECT
  p.user_id,
  NULLIF(TRIM(p.content #>> '{pl,settings,subscription,stripe_customer_id}'), ''),
  NULLIF(TRIM(p.content #>> '{pl,settings,subscription,stripe_subscription_id}'), ''),
  COALESCE(NULLIF(TRIM(p.content #>> '{pl,settings,subscription,plan}'), ''), 'trial'),
  NULLIF(TRIM(p.content #>> '{pl,settings,subscription,status}'), ''),
  CASE
    WHEN NULLIF(TRIM(p.content #>> '{pl,settings,subscription,current_period_end}'), '') IS NOT NULL
    THEN (p.content #>> '{pl,settings,subscription,current_period_end}')::timestamptz
    ELSE NULL
  END,
  COALESCE(
    (p.content #>> '{pl,settings,subscription,cancel_at_period_end}') IN ('true', 't', '1'),
    false
  )
FROM public.pages p
WHERE p.user_id IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET
  stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, billing_profiles.stripe_customer_id),
  stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, billing_profiles.stripe_subscription_id),
  plan = EXCLUDED.plan,
  status = COALESCE(EXCLUDED.status, billing_profiles.status),
  current_period_end = COALESCE(EXCLUDED.current_period_end, billing_profiles.current_period_end),
  cancel_at_period_end = EXCLUDED.cancel_at_period_end,
  updated_at = timezone('utc', now());

UPDATE public.pages p
SET billing_plan = COALESCE(
  NULLIF(TRIM(bp.plan), ''),
  NULLIF(TRIM(p.content #>> '{pl,settings,subscription,plan}'), ''),
  'trial'
)
FROM public.billing_profiles bp
WHERE bp.user_id = p.user_id;

UPDATE public.pages p
SET billing_plan = COALESCE(NULLIF(TRIM(p.content #>> '{pl,settings,subscription,plan}'), ''), 'trial')
WHERE NOT EXISTS (
  SELECT 1 FROM public.billing_profiles bp WHERE bp.user_id = p.user_id
);
