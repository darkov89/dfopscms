-- Przywraca pełną logikę 14 dni (trial + billing_failed_at), zgodną z publicSiteApp.shouldBlockPublicPageView.
-- Baseline 20260603072317_remote_schema.sql uprościł funkcję i pomijał warunki czasowe.
-- Respektuje billing_profiles (active/trialing) oraz pages.billing_plan (tier0/tier1/tier2).

DROP FUNCTION IF EXISTS public.expire_trial_pages();

CREATE FUNCTION public.expire_trial_pages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH trial_targets AS (
    SELECT p.id
    FROM public.pages p
    CROSS JOIN LATERAL (
      SELECT (p.content->'pl'->'settings'->'subscription') AS sub
    ) s
    WHERE p.trial_blocked_at IS NULL
      AND COALESCE(NULLIF(trim(p.billing_plan), ''), 'trial') NOT IN ('tier0', 'tier1', 'tier2')
      AND NOT EXISTS (
        SELECT 1
        FROM public.billing_profiles bp
        WHERE bp.user_id = p.user_id
          AND bp.status IN ('active', 'trialing')
      )
      AND s.sub IS NOT NULL
      AND jsonb_typeof(s.sub) = 'object'
      AND s.sub ? 'trial_started_at'
      AND NULLIF(trim(s.sub->>'trial_started_at'), '') IS NOT NULL
      AND (s.sub->>'trial_started_at')::timestamptz <= (timezone('utc', now()) - interval '14 days')
      AND (
        (s.sub->>'plan') = 'trial'
        OR (s.sub->>'plan') = 'tier0'
      )
  ),
  billing_targets AS (
    SELECT p.id
    FROM public.pages p
    WHERE p.trial_blocked_at IS NULL
      AND COALESCE(NULLIF(trim(p.billing_plan), ''), 'trial') NOT IN ('tier0', 'tier1', 'tier2')
      AND NOT EXISTS (
        SELECT 1
        FROM public.billing_profiles bp
        WHERE bp.user_id = p.user_id
          AND bp.status IN ('active', 'trialing')
      )
      AND p.billing_failed_at IS NOT NULL
      AND p.billing_failed_at <= (timezone('utc', now()) - interval '14 days')
  ),
  targets AS (
    SELECT id FROM trial_targets
    UNION
    SELECT id FROM billing_targets
  ),
  marked AS (
    UPDATE public.pages x
    SET trial_blocked_at = timezone('utc', now())
    FROM targets t
    WHERE x.id = t.id
      AND x.trial_blocked_at IS NULL
    RETURNING x.slug
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*)::int FROM marked),
    'slugs', COALESCE((SELECT jsonb_agg(m.slug ORDER BY m.slug) FROM marked m), '[]'::jsonb)
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{"count":0,"slugs":[]}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trial_pages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_trial_pages() TO postgres;
GRANT EXECUTE ON FUNCTION public.expire_trial_pages() TO service_role;

COMMENT ON FUNCTION public.expire_trial_pages() IS
  'Ustawia trial_blocked_at po 14 dniach trialu bez płatności lub 14 dni po billing_failed_at. Pomija aktywne billing_profiles i płatne billing_plan.';
