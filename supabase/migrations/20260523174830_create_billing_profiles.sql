-- Wydzielenie wrażliwych danych Stripe z pages.content → billing_profiles.
-- Odczyt: właściciel (authenticated + RLS). Zapis: wyłącznie service_role (Edge / webhook).

CREATE TABLE public.billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text,
  status text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT billing_profiles_user_id_key UNIQUE (user_id),
  CONSTRAINT billing_profiles_stripe_customer_id_key UNIQUE (stripe_customer_id),
  CONSTRAINT billing_profiles_stripe_subscription_id_key UNIQUE (stripe_subscription_id)
);

COMMENT ON TABLE public.billing_profiles IS
  'Profil rozliczeniowy Stripe (1:1 z auth.users). Aktualizowany przez Edge Functions (service_role).';

COMMENT ON COLUMN public.billing_profiles.plan IS 'tier0 (Starter), tier1 (Pro), tier2 (Premium) — zgodnie z config.js / Stripe price.';

CREATE INDEX billing_profiles_user_id_idx ON public.billing_profiles (user_id);

CREATE OR REPLACE FUNCTION public.set_billing_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_profiles_set_updated_at ON public.billing_profiles;

CREATE TRIGGER billing_profiles_set_updated_at
  BEFORE UPDATE ON public.billing_profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_billing_profiles_updated_at();

ALTER TABLE public.billing_profiles ENABLE ROW LEVEL SECURITY;

-- Właściciel może odczytać własny profil (panel — późniejszy odczyt z tabeli zamiast JSON).
DROP POLICY IF EXISTS "billing_profiles_select_own" ON public.billing_profiles;

CREATE POLICY "billing_profiles_select_own"
  ON public.billing_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Pusty profil po rejestracji: bez ID Stripe (wypełnia webhook / sync).
DROP POLICY IF EXISTS "billing_profiles_insert_own_empty" ON public.billing_profiles;

CREATE POLICY "billing_profiles_insert_own_empty"
  ON public.billing_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND stripe_customer_id IS NULL
    AND stripe_subscription_id IS NULL
  );

-- Brak polityk UPDATE/DELETE dla authenticated — modyfikacje tylko przez service_role (omija RLS).

GRANT SELECT ON public.billing_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_profiles TO service_role;
