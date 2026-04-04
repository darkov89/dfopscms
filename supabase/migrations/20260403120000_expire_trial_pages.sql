-- Pierwsza wersja usuwała wiersze. Od migracji 20260403140000_trial_blocked_at.sql
-- stosujemy kolumnę trial_blocked_at (blokada zamiast DELETE). Ta migracja pozostaje
-- dla historycznych wdrożeń; funkcja jest nadpisywana przez 20260403140000.
--
-- (historyczny opis) Usuwała wiersze pages po zakończeniu 14-dniowego trialu bez opłaconej subskrypcji.
-- Warunki zgodne z panelem: plan trial (lub legacy tier0 bez payment_completed), payment_completed ≠ true,
-- trial_started_at starszy niż 14 dni.
--
-- Harmonogram (po włączeniu rozszerzenia w Dashboard → Database → Extensions → pg_cron):
--   SELECT cron.schedule(
--     'expire-trial-pages-daily',
--     '0 3 * * *',
--     $$SELECT public.expire_trial_pages();$$
--   );
--
-- Alternatywa bez pg_cron: wdroż Edge Function expire-trial-pages + Supabase → Edge Functions → Schedules
-- albo zewnętrzny cron (np. GitHub Actions) z nagłówkiem Authorization: Bearer CRON_SECRET.

CREATE OR REPLACE FUNCTION public.expire_trial_pages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  WITH targets AS (
    SELECT p.id
    FROM public.pages p
    CROSS JOIN LATERAL (
      SELECT (p.content->'pl'->'settings'->'subscription') AS sub
    ) s
    WHERE s.sub IS NOT NULL
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
  removed AS (
    DELETE FROM public.pages x
    USING targets t
    WHERE x.id = t.id
    RETURNING x.id
  )
  SELECT count(*)::integer INTO deleted_count FROM removed;

  RETURN COALESCE(deleted_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.expire_trial_pages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_trial_pages() TO postgres;
GRANT EXECUTE ON FUNCTION public.expire_trial_pages() TO service_role;
