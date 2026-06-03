


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."expire_trial_pages"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH targets AS (
    -- Wybieramy strony, które nie mają aktywnej subskrypcji w billing_profiles
    -- I nie mają żadnego statusu płatności (failed/blocked)
    SELECT p.id
    FROM public.pages p
    WHERE p.trial_blocked_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.billing_profiles bp
        WHERE bp.user_id = p.user_id
          AND bp.status IN ('active', 'trialing')
      )
      -- Blokujemy tylko jeśli strona jest "nieopłacona" (np. billing_plan nie jest tier1)
      AND COALESCE(NULLIF(trim(p.billing_plan), ''), 'trial') NOT IN ('tier1')
  ),
  marked AS (
    UPDATE public.pages x
    SET trial_blocked_at = timezone('utc', now())
    FROM targets t
    WHERE x.id = t.id
    RETURNING x.slug
  )
  SELECT jsonb_build_object(
    'count', (SELECT count(*)::int FROM marked),
    'slugs', COALESCE((SELECT jsonb_agg(m.slug ORDER BY m.slug) FROM marked m), '[]'::jsonb)
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{"count":0,"slugs":[]}'::jsonb);
END;
$$;


ALTER FUNCTION "public"."expire_trial_pages"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."handle_new_user"() IS 'Po INSERT auth.users tworzy pages (slug z raw_user_meta_data). Kolizja slug → rollback rejestracji.';



CREATE OR REPLACE FUNCTION "public"."purge_trial_blocked_pages_after_grace"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  n int;
BEGIN
  DELETE FROM public.pages x
  WHERE x.trial_blocked_at IS NOT NULL
    AND x.trial_blocked_at <= (timezone('utc', now()) - interval '30 days');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deleted_count', COALESCE(n, 0));
END;
$$;


ALTER FUNCTION "public"."purge_trial_blocked_pages_after_grace"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_trial_blocked_pages_after_grace"() IS 'Usuwa pages gdzie trial_blocked_at jest ustawione co najmniej 30 dni temu.';



CREATE OR REPLACE FUNCTION "public"."set_billing_profiles_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_billing_profiles_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_name" "text",
    "created_at" timestamp without time zone
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "plan" "text",
    "status" "text",
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."billing_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_profiles" IS 'Profil rozliczeniowy Stripe (1:1 z auth.users). Aktualizowany przez Edge Functions (service_role).';



COMMENT ON COLUMN "public"."billing_profiles"."plan" IS 'tier0 (Starter), tier1 (Standard) — zgodnie ze Stripe price.';



CREATE TABLE IF NOT EXISTS "public"."pages" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "slug" "text",
    "content" "jsonb",
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "theme" "text" DEFAULT '''''consultant''''::text'::"text",
    "color_preset" "text" DEFAULT 'gold'::"text",
    "custom_domain" "text",
    "custom_domain_status" "text" DEFAULT 'none'::"text",
    "trial_blocked_at" timestamp with time zone,
    "billing_failed_at" timestamp with time zone,
    "billing_plan" "text" DEFAULT 'trial'::"text" NOT NULL,
    "draft_content" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."pages" OWNER TO "postgres";


COMMENT ON TABLE "public"."pages" IS 'storing client pages to load into CMS';



COMMENT ON COLUMN "public"."pages"."theme" IS 'template';



COMMENT ON COLUMN "public"."pages"."billing_failed_at" IS 'Pierwszy znacznik problemu z płatnością; po 14 dniach cron ustawia trial_blocked_at. Czyść przy udanej płatności.';



COMMENT ON COLUMN "public"."pages"."billing_plan" IS 'Plan rozliczeniowy (trial, tier0–tier2). Aktualizuje service_role z billing_profiles; nie edytować z panelu.';



ALTER TABLE "public"."pages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."pages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_profiles"
    ADD CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_profiles"
    ADD CONSTRAINT "billing_profiles_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."billing_profiles"
    ADD CONSTRAINT "billing_profiles_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."billing_profiles"
    ADD CONSTRAINT "billing_profiles_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."billing_profiles"
    ADD CONSTRAINT "billing_profiles_user_id_unq" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_custom_domain_key" UNIQUE ("custom_domain");



ALTER TABLE ONLY "public"."pages"
    ADD CONSTRAINT "pages_pkey" PRIMARY KEY ("id");



CREATE INDEX "billing_profiles_user_id_idx" ON "public"."billing_profiles" USING "btree" ("user_id");



CREATE UNIQUE INDEX "pages_slug_unique_idx" ON "public"."pages" USING "btree" ("slug");



ALTER TABLE ONLY "public"."billing_profiles"
    ADD CONSTRAINT "billing_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Enable delete for users based on user_id" ON "public"."pages" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Enable insert for authenticated users only" ON "public"."pages" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable read access for all users" ON "public"."pages" FOR SELECT USING (true);



CREATE POLICY "Update for authenticated users" ON "public"."pages" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Zezwalaj na insert tylko swoich zdarzen" ON "public"."analytics_events" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_profiles_insert_own_empty" ON "public"."billing_profiles" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "user_id") AND ("stripe_customer_id" IS NULL) AND ("stripe_subscription_id" IS NULL)));



CREATE POLICY "billing_profiles_select_own" ON "public"."billing_profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."pages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pages_insert_own" ON "public"."pages" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."pages";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."expire_trial_pages"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_trial_pages"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_trial_pages"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_trial_pages"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_trial_blocked_pages_after_grace"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_trial_blocked_pages_after_grace"() TO "anon";
GRANT ALL ON FUNCTION "public"."purge_trial_blocked_pages_after_grace"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."purge_trial_blocked_pages_after_grace"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_billing_profiles_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_billing_profiles_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_billing_profiles_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT ALL ON TABLE "public"."billing_profiles" TO "anon";
GRANT ALL ON TABLE "public"."billing_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."pages" TO "anon";
GRANT ALL ON TABLE "public"."pages" TO "authenticated";
GRANT ALL ON TABLE "public"."pages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pages_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































  create policy "wgrywanie zdjec dla zalogowanych 1ffg0oo_0"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'images'::text));



  create policy "wgrywanie zdjec dla zalogowanych 1ffg0oo_1"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using ((bucket_id = 'images'::text));



  create policy "wgrywanie zdjec dla zalogowanych 1ffg0oo_2"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using ((bucket_id = 'images'::text));



  create policy "wgrywanie zdjec dla zalogowanych 1ffg0oo_3"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using ((bucket_id = 'images'::text));



