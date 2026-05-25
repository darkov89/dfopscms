-- Rejestracja: pages dopiero po INSERT do auth.users (trigger AFTER INSERT).
-- Przy kolizji slug — cofnij całą transakcję (bez osieroconego auth.users bez strony / odwrotnie).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  slug_text text;
BEGIN
  slug_text := NULLIF(trim(NEW.raw_user_meta_data->>'slug'), '');
  IF slug_text IS NULL THEN
    RETURN NEW;
  END IF;
  slug_text := lower(slug_text);

  IF slug_text !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid_registration_slug' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.pages (user_id, slug, theme, color_preset, content)
    VALUES (
      NEW.id,
      slug_text,
      'setup',
      'gold',
      jsonb_build_object(
        'pl',
        jsonb_build_object(
          'settings',
          jsonb_build_object(
            'subscription',
            jsonb_build_object(
              'plan', 'trial',
              'trial_started_at', to_jsonb(timezone('utc', now())::text),
              'selected_plan', null
            )
          )
        )
      )
    );
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'registration_slug_taken' USING ERRCODE = '23505';
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Po INSERT auth.users tworzy pages (slug z raw_user_meta_data). Kolizja slug → rollback rejestracji.';
