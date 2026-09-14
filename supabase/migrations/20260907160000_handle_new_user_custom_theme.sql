-- Migration: allow handle_new_user to set theme from raw_user_meta_data (e.g. 'custom' for AI Studio)
CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  slug_text text;
  theme_val text;
  theme_type_val text;
BEGIN
  slug_text := NULLIF(trim(NEW.raw_user_meta_data->>'slug'), '');
  IF slug_text IS NULL THEN
    RETURN NEW;
  END IF;
  slug_text := lower(slug_text);

  IF slug_text !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid_registration_slug' USING ERRCODE = '22023';
  END IF;

  theme_val := NULLIF(trim(NEW.raw_user_meta_data->>'theme'), '');
  IF theme_val IS NULL OR theme_val NOT IN ('setup', 'custom', 'beauty', 'fitness', 'services', 'gastro', 'care', 'consultant') THEN
    theme_val := 'setup';
  END IF;

  theme_type_val := NULLIF(trim(NEW.raw_user_meta_data->>'theme_type'), '');
  IF theme_type_val IS NULL OR theme_type_val NOT IN ('cinematic', 'quick_card') THEN
    theme_type_val := 'cinematic';
  END IF;

  BEGIN
    IF theme_val = 'custom' THEN
      INSERT INTO public.pages (user_id, slug, theme, color_preset, content, draft_content)
      VALUES (
        NEW.id,
        slug_text,
        'custom',
        'gold',
        NULL,
        jsonb_build_object(
          'theme_type', theme_type_val,
          'pl', jsonb_build_object(
            'settings', jsonb_build_object(
              'welcome_onboarding_completed', true,
              'subscription', jsonb_build_object(
                'plan', 'trial',
                'trial_started_at', to_jsonb(timezone('utc', now())::text),
                'selected_plan', null
              )
            )
          )
        )
      );
    ELSE
      INSERT INTO public.pages (user_id, slug, theme, color_preset, content, draft_content)
      VALUES (
        NEW.id,
        slug_text,
        theme_val,
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
        ),
        NULL
      );
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'registration_slug_taken' USING ERRCODE = '23505';
  END;

  RETURN NEW;
END;
$_$;
