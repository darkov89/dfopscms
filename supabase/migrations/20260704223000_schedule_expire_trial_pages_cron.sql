-- Codzienny cron: ustawia trial_blocked_at (sync z publicSiteApp.shouldBlockPublicPageView).
-- Wymaga pg_cron w Dashboard → Database → Extensions (hosted Supabase).
-- Telegram / raport kasacji: opcjonalnie osobny harmonogram Edge expire-trial-pages (CRON_SECRET).

CREATE OR REPLACE FUNCTION public.run_expire_trial_pages_cron()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expire jsonb;
  v_warn jsonb;
BEGIN
  v_expire := public.expire_trial_pages();
  v_warn := public.notify_purge_upcoming_pages();
  RETURN jsonb_build_object(
    'ts', timezone('utc', now()),
    'expire', COALESCE(v_expire, '{"count":0,"slugs":[]}'::jsonb),
    'purge_warning', COALESCE(v_warn, '{"count":0,"pages":[]}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_expire_trial_pages_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_expire_trial_pages_cron() TO postgres;
GRANT EXECUTE ON FUNCTION public.run_expire_trial_pages_cron() TO service_role;

-- Backfill: od razu po migracji ustaw trial_blocked_at tam, gdzie trial > 14 dni.
SELECT public.run_expire_trial_pages_cron();

DO $do$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING
      'pg_cron nie jest włączony — włącz w Supabase Dashboard → Database → Extensions, '
      'potem uruchom: SELECT cron.schedule(''dfcms-expire-trial-pages'', ''0 3 * * *'', '
      '$cron$ SELECT public.run_expire_trial_pages_cron(); $cron$);';
    RETURN;
  END IF;

  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'dfcms-expire-trial-pages'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'dfcms-expire-trial-pages',
    '0 3 * * *',
    $cron$ SELECT public.run_expire_trial_pages_cron(); $cron$
  );
END $do$;
