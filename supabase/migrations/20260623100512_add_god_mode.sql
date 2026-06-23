-- God Mode / Master Admin: lista kont z pełnym dostępem operacyjnym do stron klientów.
-- Nie zmienia istniejących polityk właścicielskich; dodaje wyłącznie alternatywną ścieżkę dla superadminów.

CREATE TABLE IF NOT EXISTS public.superadmins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.superadmins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.superadmins FROM anon;
REVOKE ALL ON TABLE public.superadmins FROM authenticated;
GRANT SELECT ON TABLE public.superadmins TO authenticated;
GRANT ALL ON TABLE public.superadmins TO service_role;

DROP POLICY IF EXISTS superadmins_select_self ON public.superadmins;
CREATE POLICY superadmins_select_self
ON public.superadmins
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS pages_superadmins_select ON public.pages;
CREATE POLICY pages_superadmins_select
ON public.pages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS pages_superadmins_update ON public.pages;
CREATE POLICY pages_superadmins_update
ON public.pages
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS pages_superadmins_delete ON public.pages;
CREATE POLICY pages_superadmins_delete
ON public.pages
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS analytics_events_superadmins_select ON public.analytics_events;
CREATE POLICY analytics_events_superadmins_select
ON public.analytics_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS analytics_events_superadmins_update ON public.analytics_events;
CREATE POLICY analytics_events_superadmins_update
ON public.analytics_events
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS analytics_events_superadmins_delete ON public.analytics_events;
CREATE POLICY analytics_events_superadmins_delete
ON public.analytics_events
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.superadmins sa
    WHERE sa.user_id = (SELECT auth.uid())
  )
);
