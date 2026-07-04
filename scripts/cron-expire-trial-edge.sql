-- Opcjonalnie: codzienne powiadomienia Telegram (Edge expire-trial-pages).
-- Uruchom w SQL Editor PO ustawieniu secretów w Vault (Dashboard → Project Settings → Vault):
--
--   select vault.create_secret('https://PROJECT_REF.supabase.co', 'dfcms_project_url');
--   select vault.create_secret('YOUR_CRON_SECRET', 'dfcms_cron_secret');
--
-- Zamień PROJECT_REF (staging: asxrsdsprrbvjvgcsckh, prod: tawywecinkubmouyprab).

DO $do$
DECLARE
  v_job_id bigint;
  v_url text;
  v_secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Włącz pg_cron w Database → Extensions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'Włącz pg_net w Database → Extensions';
  END IF;

  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'dfcms_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'dfcms_cron_secret' LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE EXCEPTION 'Brak vault: dfcms_project_url / dfcms_cron_secret';
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'dfcms-expire-trial-edge' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'dfcms-expire-trial-edge',
    '15 3 * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L
        ),
        body := jsonb_build_object('source', 'pg_cron', 'ts', now())
      );
      $cron$,
      rtrim(v_url, '/') || '/functions/v1/expire-trial-pages',
      v_secret
    )
  );
END $do$;
