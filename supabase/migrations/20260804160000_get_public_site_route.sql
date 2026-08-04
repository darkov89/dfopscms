-- Publiczny soft-block bez wycieku content: meta routingu dla anon/authenticated.
-- RLS pages_select_public bez zmian — zablokowane wiersze nadal niewidoczne w SELECT content.

CREATE OR REPLACE FUNCTION public.get_public_site_route(
  p_slug text DEFAULT NULL,
  p_host text DEFAULT NULL
)
RETURNS TABLE (
  slug text,
  theme text,
  billing_plan text,
  trial_blocked_at timestamptz,
  billing_failed_at timestamptz,
  blocked boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text;
  v_host text;
  v_row public.pages%ROWTYPE;
  v_blocked boolean;
BEGIN
  v_slug := lower(trim(COALESCE(p_slug, '')));
  v_host := lower(trim(COALESCE(p_host, '')));

  IF v_slug = '' AND v_host = '' THEN
    RETURN;
  END IF;

  -- Slug: tylko bezpieczny format tenantowy.
  IF v_slug <> '' AND v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RETURN;
  END IF;

  -- Host: FQDN bez protokołu / ścieżki.
  IF v_host <> '' THEN
    IF length(v_host) > 253 OR position('..' in v_host) > 0
       OR v_host !~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' THEN
      RETURN;
    END IF;
  END IF;

  IF v_slug <> '' THEN
    SELECT * INTO v_row
    FROM public.pages p
    WHERE p.slug = v_slug
      AND p.content IS NOT NULL
    LIMIT 1;
  ELSE
    SELECT * INTO v_row
    FROM public.pages p
    WHERE p.custom_domain = v_host
      AND p.content IS NOT NULL
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_blocked :=
    v_row.trial_blocked_at IS NOT NULL
    OR (
      v_row.billing_failed_at IS NOT NULL
      AND v_row.billing_failed_at <= (timezone('utc', now()) - interval '14 days')
    );

  slug := v_row.slug;
  theme := v_row.theme;
  billing_plan := COALESCE(NULLIF(trim(v_row.billing_plan), ''), 'trial');
  trial_blocked_at := v_row.trial_blocked_at;
  billing_failed_at := v_row.billing_failed_at;
  blocked := v_blocked;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.get_public_site_route(text, text) IS
  'Meta publicznego routingu (slug/theme/blocked) bez content/draft — soft-block zamiast 404.';

REVOKE ALL ON FUNCTION public.get_public_site_route(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_site_route(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_site_route(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_site_route(text, text) TO service_role;
