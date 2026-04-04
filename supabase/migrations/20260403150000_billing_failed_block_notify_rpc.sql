-- Okres karencji po problemie z płatnością subskrypcji (Stripe / ręczna flaga).
-- Ustaw billing_failed_at (np. w webhooku invoice.payment_failed) — po 14 dniach
-- ta sama blokada publiczna co przy wygasłym trialu (trial_blocked_at).
-- Powodzenie płatności: trial_blocked_at = NULL, billing_failed_at = NULL.
-- RPC zwraca jsonb { count, slugs } pod powiadomienia (Edge Function).

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS trial_blocked_at timestamptz;
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS billing_failed_at timestamptz;

COMMENT ON COLUMN public.pages.billing_failed_at IS 'Pierwszy znacznik problemu z płatnością; po 14 dniach cron ustawia trial_blocked_at. Czyść przy udanej płatności.';

-- Zwraca { count, slugs } dla logów i powiadomień e-mail (Edge Function).
CREATE OR REPLACE FUNCTION public.expire_trial_pages()
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
