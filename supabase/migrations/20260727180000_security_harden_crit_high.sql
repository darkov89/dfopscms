-- Security hotfix Critical + High (C1–C3, H2–H3).
-- C1: revoke purge RPC from anon/authenticated
-- C2: protect pages billing columns from client writes
-- C3: drop client INSERT on billing_profiles
-- H2: split pages SELECT (anon public vs authenticated owner-only; superadmin unchanged)
-- H3: storage images ownership (user_id/ prefix or legacy slug-owned flat name)

-- ---------------------------------------------------------------------------
-- C1 — purge_trial_blocked_pages_after_grace: service_role / postgres only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.purge_trial_blocked_pages_after_grace() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_trial_blocked_pages_after_grace() FROM anon;
REVOKE ALL ON FUNCTION public.purge_trial_blocked_pages_after_grace() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_trial_blocked_pages_after_grace() TO postgres;
GRANT EXECUTE ON FUNCTION public.purge_trial_blocked_pages_after_grace() TO service_role;

-- ---------------------------------------------------------------------------
-- C2 — billing columns on pages: only service_role / postgres may change
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_pages_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
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

  -- UPDATE: freeze entitlement / block fields from client JWT
  NEW.billing_plan := OLD.billing_plan;
  NEW.trial_blocked_at := OLD.trial_blocked_at;
  NEW.billing_failed_at := OLD.billing_failed_at;
  NEW.purge_warning_sent_at := OLD.purge_warning_sent_at;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_pages_billing_columns() IS
  'Blokuje client JWT przed zmianą billing_plan / trial_blocked_at / billing_failed_at / purge_warning_sent_at. Zapis tylko service_role (Stripe/cron).';

DROP TRIGGER IF EXISTS pages_protect_billing_columns ON public.pages;
CREATE TRIGGER pages_protect_billing_columns
  BEFORE INSERT OR UPDATE ON public.pages
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_pages_billing_columns();

REVOKE ALL ON FUNCTION public.protect_pages_billing_columns() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_pages_billing_columns() TO postgres;
GRANT EXECUTE ON FUNCTION public.protect_pages_billing_columns() TO service_role;

-- ---------------------------------------------------------------------------
-- C3 — billing_profiles: no client INSERT (Edge upsert via service_role)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS billing_profiles_insert_own_empty ON public.billing_profiles;

-- ---------------------------------------------------------------------------
-- H2 — pages SELECT: anon = public branch; authenticated = owner only
--      (pages_superadmins_select remains for God Mode)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS pages_select_public_or_owner ON public.pages;

CREATE POLICY pages_select_public
ON public.pages
FOR SELECT
TO anon
USING (
  content IS NOT NULL
  AND trial_blocked_at IS NULL
  AND (
    billing_failed_at IS NULL
    OR billing_failed_at > (timezone('utc', now()) - interval '14 days')
  )
);

CREATE POLICY pages_select_owner
ON public.pages
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Narrow table grants for authenticated (keep draft for owners; RLS gates rows).
-- Billing entitlement columns: SELECT ok, no UPDATE/INSERT privilege for clients.
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
  color_preset,
  custom_domain,
  custom_domain_status
) ON public.pages TO authenticated;

GRANT UPDATE (
  slug,
  content,
  draft_content,
  theme,
  color_preset,
  custom_domain,
  custom_domain_status,
  draft_updated_at
) ON public.pages TO authenticated;

GRANT DELETE ON public.pages TO authenticated;

REVOKE ALL ON SEQUENCE public.pages_id_seq FROM authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pages_id_seq TO authenticated;

-- anon column grants unchanged (no draft_content) — reaffirm after any drift
REVOKE ALL ON TABLE public.pages FROM anon;
GRANT SELECT (
  slug,
  theme,
  content,
  color_preset,
  custom_domain,
  trial_blocked_at,
  billing_failed_at,
  billing_plan
) ON public.pages TO anon;

REVOKE ALL ON SEQUENCE public.pages_id_seq FROM anon;

-- ---------------------------------------------------------------------------
-- H3 — storage.objects images: owner path or legacy slug-owned flat name
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "wgrywanie zdjec dla zalogowanych 1ffg0oo_0" ON storage.objects;
DROP POLICY IF EXISTS "wgrywanie zdjec dla zalogowanych 1ffg0oo_1" ON storage.objects;
DROP POLICY IF EXISTS "wgrywanie zdjec dla zalogowanych 1ffg0oo_2" ON storage.objects;
DROP POLICY IF EXISTS "wgrywanie zdjec dla zalogowanych 1ffg0oo_3" ON storage.objects;

CREATE OR REPLACE FUNCTION public.storage_images_owned_by_caller(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (storage.foldername(object_name))[1] = (SELECT auth.uid())::text
    OR EXISTS (
      SELECT 1
      FROM public.pages p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.slug IS NOT NULL
        AND object_name LIKE (p.slug || '-%')
        AND position('/' in object_name) = 0
    );
$$;

COMMENT ON FUNCTION public.storage_images_owned_by_caller(text) IS
  'Storage images: {user_id}/… lub legacy flat {slug}-… należące do pages.user_id.';

REVOKE ALL ON FUNCTION public.storage_images_owned_by_caller(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_images_owned_by_caller(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_images_owned_by_caller(text) TO service_role;

CREATE POLICY images_insert_own
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'images'
  AND public.storage_images_owned_by_caller(name)
);

CREATE POLICY images_update_own
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'images'
  AND public.storage_images_owned_by_caller(name)
)
WITH CHECK (
  bucket_id = 'images'
  AND public.storage_images_owned_by_caller(name)
);

CREATE POLICY images_select_authenticated
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'images');

CREATE POLICY images_delete_own
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND public.storage_images_owned_by_caller(name)
);
