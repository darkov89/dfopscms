-- Fix: protect_pages_billing_columns must be SECURITY DEFINER.
-- As SECURITY INVOKER it assigned NEW.billing_* on every UPDATE; authenticated
-- lacks column UPDATE on those fields → PostgREST 403 on publish/autosave.

CREATE OR REPLACE FUNCTION public.protect_pages_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  db_role text := coalesce(current_setting('role', true), '');
BEGIN
  IF jwt_role = 'service_role'
     OR db_role IN ('service_role', 'postgres')
     OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.billing_plan := 'trial';
    NEW.trial_blocked_at := NULL;
    NEW.billing_failed_at := NULL;
    NEW.purge_warning_sent_at := NULL;
    RETURN NEW;
  END IF;

  NEW.billing_plan := OLD.billing_plan;
  NEW.trial_blocked_at := OLD.trial_blocked_at;
  NEW.billing_failed_at := OLD.billing_failed_at;
  NEW.purge_warning_sent_at := OLD.purge_warning_sent_at;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_pages_billing_columns() IS
  'SECURITY DEFINER: blokuje client JWT przed zmianą billing_*/purge_warning. Zapis entitlement tylko service_role.';

REVOKE ALL ON FUNCTION public.protect_pages_billing_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_pages_billing_columns() FROM anon;
REVOKE ALL ON FUNCTION public.protect_pages_billing_columns() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.protect_pages_billing_columns() TO postgres;
GRANT EXECUTE ON FUNCTION public.protect_pages_billing_columns() TO service_role;
-- Trigger fires as table owner; authenticated still needs EXECUTE to run the trigger function.
GRANT EXECUTE ON FUNCTION public.protect_pages_billing_columns() TO authenticated;
