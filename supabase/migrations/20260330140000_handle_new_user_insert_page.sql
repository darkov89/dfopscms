-- Po rejestracji (auth.users) tworzy wiersz w public.pages bez sesji JWT — działa z włączonym „Confirm email”.
-- Slug musi trafić do user metadata: signUp({ options: { data: { slug: '...' } } }) → raw_user_meta_data.slug
-- Uruchom w Supabase → SQL Editor. W Authentication → URL Configuration dodaj redirect: .../admin.html

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

  INSERT INTO public.pages (user_id, slug, theme, color_preset, content)
  VALUES (NEW.id, slug_text, 'setup', 'gold', '{}'::jsonb);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();
