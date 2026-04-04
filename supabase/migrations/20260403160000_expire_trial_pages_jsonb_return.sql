-- Postgres nie pozwala zmienić typu zwracanego przez CREATE OR REPLACE (było: integer → jsonb).
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS billing_failed_at timestamptz;

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
      AND s.sub IS NOT NULL
      AND jsonb_typeof(s.sub) = 'object'
      AND s.sub ? 'trial_started_at'
      AND NULLIF(trim(s.sub->>'trial_started_at'), '') IS NOT NULL
      AND (s.sub->>'trial_started_at')::timestamptz <= (timezone('utc', now()) - interval '14 days')
      AND NOT COALESCE((s.sub->>'payment_completed')::boolean, false)
      AND (
        (s.sub->>'plan') = 'trial'
        OR (
          (s.sub->>'plan') = 'tier0'
          AND NOT COALESCE((s.sub->>'payment_completed')::boolean, false)
        )
      )
  ),
  billing_targets AS (
    SELECT p.id
    FROM public.pages p
    WHERE p.trial_blocked_at IS NULL
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
