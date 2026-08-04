-- Ręczny grant planu (God Mode) vs Stripe Checkout.
-- grant_source: 'stripe' | 'manual' | null

ALTER TABLE public.billing_profiles
  ADD COLUMN IF NOT EXISTS grant_source text;

COMMENT ON COLUMN public.billing_profiles.grant_source IS
  'Źródło aktywnego planu: stripe (Checkout/webhook) lub manual (God Mode). Null = nieustalone / trial.';

UPDATE public.billing_profiles
SET grant_source = 'stripe'
WHERE grant_source IS NULL
  AND stripe_subscription_id IS NOT NULL
  AND NULLIF(trim(stripe_subscription_id), '') IS NOT NULL;

-- Superadmin (God Mode) może czytać wszystkie profile rozliczeniowe (jak pages).
DROP POLICY IF EXISTS billing_profiles_superadmins_select ON public.billing_profiles;
CREATE POLICY billing_profiles_superadmins_select
  ON public.billing_profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.superadmins sa
      WHERE sa.user_id = (SELECT auth.uid())
    )
  );

-- Wygaszanie ręcznych grantów po current_period_end (wołane z Edge expire-trial-pages).
CREATE OR REPLACE FUNCTION public.expire_manual_grants()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH expired AS (
    SELECT bp.user_id
    FROM public.billing_profiles bp
    WHERE bp.grant_source = 'manual'
      AND bp.current_period_end IS NOT NULL
      AND bp.current_period_end < timezone('utc', now())
      AND (
        bp.stripe_subscription_id IS NULL
        OR NULLIF(trim(bp.stripe_subscription_id), '') IS NULL
        OR lower(COALESCE(bp.status, '')) NOT IN ('active', 'trialing', 'past_due')
      )
  ),
  cleared AS (
    UPDATE public.billing_profiles bp
    SET
      plan = 'trial',
      status = 'canceled',
      current_period_end = NULL,
      cancel_at_period_end = false,
      grant_source = NULL,
      updated_at = timezone('utc', now())
    FROM expired e
    WHERE bp.user_id = e.user_id
    RETURNING bp.user_id
  ),
  pages_updated AS (
    UPDATE public.pages p
    SET
      billing_plan = 'trial',
      trial_blocked_at = COALESCE(p.trial_blocked_at, timezone('utc', now()))
    FROM cleared c
    WHERE p.user_id = c.user_id
      AND COALESCE(NULLIF(trim(p.billing_plan), ''), 'trial') <> 'trial'
    RETURNING p.slug
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*)::int FROM cleared),
    'slugs', COALESCE(
      (SELECT jsonb_agg(DISTINCT pu.slug ORDER BY pu.slug) FROM pages_updated pu),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{"count":0,"slugs":[]}'::jsonb);
END;
$$;

ALTER FUNCTION public.expire_manual_grants() OWNER TO postgres;

COMMENT ON FUNCTION public.expire_manual_grants() IS
  'Cofnięcie grantów God Mode (grant_source=manual) po current_period_end; lustro pages → trial + trial_blocked_at.';

REVOKE ALL ON FUNCTION public.expire_manual_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_manual_grants() TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_manual_grants() TO postgres;
