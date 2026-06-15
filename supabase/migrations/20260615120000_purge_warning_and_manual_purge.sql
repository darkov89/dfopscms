-- Ostrzeżenie e-mail 7 dni przed planowaną kasacją (30 dni od trial_blocked_at).
-- purge_warning_sent_at = jednorazowy znacznik wysłania ostrzeżenia.

ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS purge_warning_sent_at timestamptz;

COMMENT ON COLUMN public.pages.purge_warning_sent_at IS
  'Kiedy wysłano operacyjne ostrzeżenie (7 dni przed kasacją po 30 dniach od trial_blocked_at).';

-- Strony kwalifikujące się do ostrzeżenia: zablokowane ≥23 dni temu, jeszcze <30 dni (7 dni do purge).
CREATE OR REPLACE FUNCTION public.notify_purge_upcoming_pages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH warn_targets AS (
    SELECT p.id, p.slug, p.trial_blocked_at
    FROM public.pages p
    WHERE p.trial_blocked_at IS NOT NULL
      AND p.purge_warning_sent_at IS NULL
      AND p.trial_blocked_at <= (timezone('utc', now()) - interval '23 days')
      AND p.trial_blocked_at > (timezone('utc', now()) - interval '30 days')
  ),
  marked AS (
    UPDATE public.pages x
    SET purge_warning_sent_at = timezone('utc', now())
    FROM warn_targets w
    WHERE x.id = w.id
    RETURNING x.slug, x.trial_blocked_at
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*)::int FROM marked),
    'pages', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'slug', m.slug,
          'trial_blocked_at', m.trial_blocked_at,
          'purge_scheduled_at', m.trial_blocked_at + interval '30 days'
        )
        ORDER BY m.slug
      ) FROM marked m),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{"count":0,"pages":[]}'::jsonb);
END;
$$;

-- Strony gotowe do ręcznej kasacji (≥30 dni od trial_blocked_at).
CREATE OR REPLACE FUNCTION public.list_pages_pending_purge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'count', count(*)::int,
      'pages', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'slug', p.slug,
            'trial_blocked_at', p.trial_blocked_at,
            'days_blocked', (extract(epoch FROM (timezone('utc', now()) - p.trial_blocked_at)) / 86400)::int
          )
          ORDER BY p.slug
        ),
        '[]'::jsonb
      )
    )
    FROM public.pages p
    WHERE p.trial_blocked_at IS NOT NULL
      AND p.trial_blocked_at <= (timezone('utc', now()) - interval '30 days')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_purge_upcoming_pages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_purge_upcoming_pages() TO postgres;
GRANT EXECUTE ON FUNCTION public.notify_purge_upcoming_pages() TO service_role;

REVOKE ALL ON FUNCTION public.list_pages_pending_purge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_pages_pending_purge() TO postgres;
GRANT EXECUTE ON FUNCTION public.list_pages_pending_purge() TO service_role;
