-- Po 30 dniach od ustawienia trial_blocked_at — usuń wiersz pages.
-- Wywoływane z Edge expire-trial-pages po expire_trial_pages() (ten sam cron).

CREATE OR REPLACE FUNCTION public.purge_trial_blocked_pages_after_grace()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  DELETE FROM public.pages x
  WHERE x.trial_blocked_at IS NOT NULL
    AND x.trial_blocked_at <= (timezone('utc', now()) - interval '30 days');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deleted_count', COALESCE(n, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.purge_trial_blocked_pages_after_grace() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_trial_blocked_pages_after_grace() TO postgres;
GRANT EXECUTE ON FUNCTION public.purge_trial_blocked_pages_after_grace() TO service_role;

COMMENT ON FUNCTION public.purge_trial_blocked_pages_after_grace() IS
  'Usuwa pages gdzie trial_blocked_at jest ustawione co najmniej 30 dni temu.';
