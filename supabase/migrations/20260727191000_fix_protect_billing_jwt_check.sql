-- Fix SECURITY DEFINER billing guard: do not trust current_user (always
-- postgres when definer). Allow changes only for service_role JWT or no JWT
-- (cron / dashboard SQL). Freeze for authenticated/anon JWT.

CREATE OR REPLACE FUNCTION public.protect_pages_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
BEGIN
  -- Stripe/Edge service_role: full write to entitlement columns
  IF jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Cron / SQL editor / SECURITY DEFINER RPCs without a user JWT
  IF auth.jwt() IS NULL THEN
    RETURN NEW;
  END IF;

  -- authenticated / anon JWT: freeze entitlement fields
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
  'SECURITY DEFINER: freeze billing_*/purge_warning for client JWTs; allow service_role JWT or null JWT (cron).';
