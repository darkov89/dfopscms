-- Zamiast usuwać wiersz — archiwizacja / blokada publicznego widoku:
-- trial_blocked_at = timestamptz ustawiany przez expire_trial_pages().
-- Strona pozostaje w bazie; klient i panel pokazują CTA do subskrypcji.
-- Po zaksięgowaniu płatności ustaw trial_blocked_at = NULL (panel przy zapisie lub webhook).

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS trial_blocked_at timestamptz;

CREATE OR REPLACE FUNCTION public.expire_trial_pages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  WITH targets AS (
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
  marked AS (
    UPDATE public.pages x
    SET trial_blocked_at = timezone('utc', now())
    FROM targets t
    WHERE x.id = t.id
      AND x.trial_blocked_at IS NULL
    RETURNING x.id
  )
  SELECT count(*)::integer INTO updated_count FROM marked;

  RETURN COALESCE(updated_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trial_pages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_trial_pages() TO postgres;
GRANT EXECUTE ON FUNCTION public.expire_trial_pages() TO service_role;
