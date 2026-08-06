-- Security: freeze pages.custom_domain / custom_domain_status for client JWTs.
-- Only service_role (Edge add-custom-domain) may set or clear custom domains.
-- Mirrors protect_pages_billing_columns (auth.jwt() role check).

CREATE OR REPLACE FUNCTION public.protect_pages_custom_domain_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
BEGIN
  -- Edge / service_role: full write
  IF jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Cron / Dashboard SQL / SECURITY DEFINER without user JWT
  IF auth.jwt() IS NULL THEN
    RETURN NEW;
  END IF;

  -- authenticated / anon JWT: cannot claim or clear custom domains via PostgREST
  IF TG_OP = 'INSERT' THEN
    NEW.custom_domain := NULL;
    NEW.custom_domain_status := 'none';
    RETURN NEW;
  END IF;

  NEW.custom_domain := OLD.custom_domain;
  NEW.custom_domain_status := OLD.custom_domain_status;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_pages_custom_domain_columns() IS
  'SECURITY DEFINER: freeze custom_domain / custom_domain_status for client JWTs; allow service_role JWT or null JWT. Prevents domain claim without Edge/Cloudflare ownership check.';

DROP TRIGGER IF EXISTS pages_protect_custom_domain_columns ON public.pages;
CREATE TRIGGER pages_protect_custom_domain_columns
  BEFORE INSERT OR UPDATE ON public.pages
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_pages_custom_domain_columns();

REVOKE ALL ON FUNCTION public.protect_pages_custom_domain_columns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_pages_custom_domain_columns() TO postgres;
GRANT EXECUTE ON FUNCTION public.protect_pages_custom_domain_columns() TO service_role;

-- Narrow grants: clients may SELECT domain fields; writes only via service_role.
REVOKE ALL ON TABLE public.pages FROM authenticated;

GRANT SELECT (
  id,
  created_at,
  slug,
  content,
  draft_content,
  user_id,
  theme,
  color_preset,
  custom_domain,
  custom_domain_status,
  trial_blocked_at,
  billing_failed_at,
  billing_plan,
  purge_warning_sent_at,
  draft_updated_at
) ON public.pages TO authenticated;

GRANT INSERT (
  slug,
  content,
  draft_content,
  user_id,
  theme,
  color_preset
) ON public.pages TO authenticated;

GRANT UPDATE (
  slug,
  content,
  draft_content,
  theme,
  color_preset,
  draft_updated_at
) ON public.pages TO authenticated;

GRANT DELETE ON public.pages TO authenticated;

REVOKE ALL ON SEQUENCE public.pages_id_seq FROM authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pages_id_seq TO authenticated;
