-- Security audit: zawęża publiczny odczyt pages.
-- Anon dostaje tylko kolumny potrzebne do renderu publicznego, bez draft_content.

DROP POLICY IF EXISTS "Enable read access for all users" ON public.pages;
DROP POLICY IF EXISTS pages_select_public_or_owner ON public.pages;

CREATE POLICY pages_select_public_or_owner
ON public.pages
FOR SELECT
USING (
  (
    auth.uid() = user_id
  )
  OR
  (
    content IS NOT NULL
    AND trial_blocked_at IS NULL
    AND (
      billing_failed_at IS NULL
      OR billing_failed_at > (timezone('utc', now()) - interval '14 days')
    )
  )
);

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
