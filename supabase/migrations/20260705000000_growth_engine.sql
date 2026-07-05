-- Silnik Wzrostu (Growth Autopilot) — G1 + G2.
-- Spec: docs/GROWTH_AUTOPILOT_ARCHITECTURE.md (§3).
-- Repurpose `analytics_events` (stary telemetry panelu — event_scope='legacy', nieużywany) na
-- konwersje publiczne (klik tel/rezerwacja/WhatsApp) + nowa tabela `growth_benchmarks`.

-- =====================================================================================
-- 1) analytics_events — rozszerzenie pod konwersje publiczne
-- =====================================================================================

ALTER TABLE public.analytics_events
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.analytics_events
  ADD COLUMN IF NOT EXISTS page_id bigint REFERENCES public.pages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS visitor_key text,
  ADD COLUMN IF NOT EXISTS event_scope text NOT NULL DEFAULT 'legacy';

-- Baseline zostawił `created_at` bez wartości domyślnej i bez strefy czasowej — Edge Function
-- (`record-site-event`) potrzebuje spójnego domyślnego znacznika czasu w UTC.
ALTER TABLE public.analytics_events
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
ALTER TABLE public.analytics_events
  ALTER COLUMN created_at SET DEFAULT timezone('utc', now());

CREATE INDEX IF NOT EXISTS analytics_events_page_created_idx
  ON public.analytics_events (page_id, created_at DESC)
  WHERE page_id IS NOT NULL AND event_scope = 'conversion';

CREATE INDEX IF NOT EXISTS analytics_events_slug_created_idx
  ON public.analytics_events (slug, created_at DESC)
  WHERE event_scope = 'conversion';

COMMENT ON COLUMN public.analytics_events.event_name IS
  'Typ zdarzenia: conversion → phone_click, booking_click, whatsapp_click, messenger_click, email_click, map_click; legacy → onboarding_* (deprecated, panel).';
COMMENT ON COLUMN public.analytics_events.event_scope IS
  'conversion = klik CTA na stronie publicznej (Silnik Wzrostu); legacy = stary telemetry panelu (nieużywany od G1).';
COMMENT ON COLUMN public.analytics_events.visitor_key IS
  'Hash dzienny liczony po stronie Edge (record-site-event) — bez PII; może być NULL w v0.';

-- =====================================================================================
-- 2) analytics_events — RLS: tylko Edge (service_role) insertuje; owner czyta konwersje
-- =====================================================================================

-- Panel przestaje insertować bezpośrednio (G1) — kolumny konwersji zapisuje wyłącznie
-- Edge Function `record-site-event` kluczem service_role (który omija RLS).
DROP POLICY IF EXISTS "Zezwalaj na insert tylko swoich zdarzen" ON public.analytics_events;

DROP POLICY IF EXISTS analytics_events_owner_select_conversion ON public.analytics_events;
CREATE POLICY analytics_events_owner_select_conversion
ON public.analytics_events FOR SELECT TO authenticated
USING (
  event_scope = 'conversion'
  AND page_id IN (SELECT id FROM public.pages WHERE user_id = auth.uid())
);

-- Zawężenie grantów: bez ALL dla anon/authenticated (RLS + granty razem decydują o dostępie).
REVOKE ALL ON TABLE public.analytics_events FROM anon;
REVOKE ALL ON TABLE public.analytics_events FROM authenticated;
GRANT SELECT ON TABLE public.analytics_events TO authenticated;
GRANT ALL ON TABLE public.analytics_events TO service_role;

-- Polityki superadminów (God Mode, 20260623100512) zostają bez zmian — dodatkowa ścieżka OR.

-- =====================================================================================
-- 3) growth_benchmarks — benchmarki anonimowe per motyw
-- =====================================================================================

CREATE TABLE IF NOT EXISTS public.growth_benchmarks (
  theme text NOT NULL,
  metric_key text NOT NULL,
  value numeric NOT NULL,
  sample_size int NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (theme, metric_key)
);

COMMENT ON TABLE public.growth_benchmarks IS
  'Benchmarki anonimowe per pages.theme (Silnik Wzrostu) — agregowane cronem aggregate-growth-benchmarks.';

ALTER TABLE public.growth_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS growth_benchmarks_select_authenticated ON public.growth_benchmarks;
CREATE POLICY growth_benchmarks_select_authenticated
ON public.growth_benchmarks FOR SELECT TO authenticated
USING (true);

REVOKE ALL ON TABLE public.growth_benchmarks FROM anon;
REVOKE ALL ON TABLE public.growth_benchmarks FROM authenticated;
GRANT SELECT ON TABLE public.growth_benchmarks TO authenticated;
GRANT ALL ON TABLE public.growth_benchmarks TO service_role;

-- =====================================================================================
-- 4) RPC aggregate_growth_benchmarks() — SECURITY DEFINER, tylko service_role (cron)
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.aggregate_growth_benchmarks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_themes_updated int := 0;
  v_ts timestamptz := timezone('utc', now());
BEGIN
  WITH page_flags AS (
    SELECT
      p.theme,
      p.id,
      (NULLIF(trim(p.content #>> '{pl,contact,phone}'), '') IS NOT NULL
        OR NULLIF(trim(p.content #>> '{pl,contact,email}'), '') IS NOT NULL) AS has_phone,
      (COALESCE(p.content #>> '{pl,settings,booking_mode}', 'schedule') <> 'schedule'
        AND NULLIF(trim(p.content #>> '{pl,contact,booking_url}'), '') IS NOT NULL) AS has_booking,
      (NULLIF(trim(p.content #>> '{pl,google_reviews,place_id}'), '') IS NOT NULL) AS has_google_reviews,
      (NULLIF(trim(p.content #>> '{pl,hero,image}'), '') IS NOT NULL
        OR NULLIF(trim(p.content #>> '{pl,nav,logoImage}'), '') IS NOT NULL) AS has_hero_image,
      (COALESCE(jsonb_array_length(p.content #> '{pl,services}'), 0) > 0
        OR COALESCE(jsonb_array_length(p.content #> '{pl,menu_items}'), 0) > 0) AS has_offer
    FROM public.pages p
    WHERE p.content IS NOT NULL
      AND p.trial_blocked_at IS NULL
      AND COALESCE(p.slug, '') NOT LIKE 'demo-%'
      AND COALESCE(NULLIF(trim(p.theme), ''), '') <> ''
  ),
  theme_counts AS (
    SELECT
      theme,
      count(*) AS n,
      count(*) FILTER (WHERE has_phone) AS n_phone,
      count(*) FILTER (WHERE has_booking) AS n_booking,
      count(*) FILTER (WHERE has_google_reviews) AS n_reviews,
      count(*) FILTER (WHERE has_hero_image) AS n_hero,
      count(*) FILTER (WHERE has_offer) AS n_offer
    FROM page_flags
    GROUP BY theme
  ),
  pct_metrics AS (
    SELECT theme, 'pct_has_phone' AS metric_key, round(100.0 * n_phone / NULLIF(n, 0), 1) AS value, n AS sample_size FROM theme_counts
    UNION ALL
    SELECT theme, 'pct_has_booking_url', round(100.0 * n_booking / NULLIF(n, 0), 1), n FROM theme_counts
    UNION ALL
    SELECT theme, 'pct_has_google_reviews', round(100.0 * n_reviews / NULLIF(n, 0), 1), n FROM theme_counts
    UNION ALL
    SELECT theme, 'pct_has_hero_image', round(100.0 * n_hero / NULLIF(n, 0), 1), n FROM theme_counts
    UNION ALL
    SELECT theme, 'pct_has_offer', round(100.0 * n_offer / NULLIF(n, 0), 1), n FROM theme_counts
  ),
  eligible_pages AS (
    SELECT p.id, p.theme
    FROM public.pages p
    WHERE p.content IS NOT NULL
      AND p.trial_blocked_at IS NULL
      AND COALESCE(p.slug, '') NOT LIKE 'demo-%'
      AND p.created_at <= (v_ts - interval '7 days')
  ),
  phone_click_counts AS (
    SELECT
      ep.theme,
      ep.id AS page_id,
      count(*) FILTER (WHERE ae.event_name = 'phone_click') AS clicks
    FROM eligible_pages ep
    LEFT JOIN public.analytics_events ae
      ON ae.page_id = ep.id
      AND ae.event_scope = 'conversion'
      AND ae.created_at >= (v_ts - interval '7 days')
    GROUP BY ep.theme, ep.id
  ),
  median_metrics AS (
    SELECT
      theme,
      'median_weekly_phone_clicks' AS metric_key,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY clicks), 0)::numeric AS value,
      count(*) AS sample_size
    FROM phone_click_counts
    GROUP BY theme
  ),
  all_metrics AS (
    SELECT * FROM pct_metrics
    UNION ALL
    SELECT * FROM median_metrics
  ),
  upserted AS (
    INSERT INTO public.growth_benchmarks (theme, metric_key, value, sample_size, computed_at)
    SELECT theme, metric_key, COALESCE(value, 0), sample_size, v_ts
    FROM all_metrics
    WHERE theme IS NOT NULL
    ON CONFLICT (theme, metric_key) DO UPDATE
      SET value = EXCLUDED.value,
          sample_size = EXCLUDED.sample_size,
          computed_at = EXCLUDED.computed_at
    RETURNING theme
  )
  SELECT count(DISTINCT theme) INTO v_themes_updated FROM upserted;

  RETURN jsonb_build_object('themes_updated', COALESCE(v_themes_updated, 0), 'computed_at', v_ts);
END;
$$;

REVOKE ALL ON FUNCTION public.aggregate_growth_benchmarks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aggregate_growth_benchmarks() TO service_role;

COMMENT ON FUNCTION public.aggregate_growth_benchmarks() IS
  'Cron (Edge aggregate-growth-benchmarks): przelicza growth_benchmarks per theme z pages.content + analytics_events (event_scope=conversion, 7 dni). Pomija sluga demo-*.';

-- =====================================================================================
-- 5) RPC get_page_growth_stats() — panel, SECURITY INVOKER (RLS właściciela wystarcza)
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.get_page_growth_stats(p_page_id bigint, p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(s.event_name, s.cnt), '{}'::jsonb)
  FROM (
    SELECT event_name, count(*) AS cnt
    FROM public.analytics_events
    WHERE event_scope = 'conversion'
      AND page_id = p_page_id
      AND created_at >= (timezone('utc', now()) - make_interval(days => GREATEST(p_days, 1)))
    GROUP BY event_name
  ) s;
$$;

REVOKE ALL ON FUNCTION public.get_page_growth_stats(bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_page_growth_stats(bigint, int) TO authenticated;

COMMENT ON FUNCTION public.get_page_growth_stats(bigint, int) IS
  'Panel (growthRepository.js): liczniki konwersji (phone_click, booking_click, whatsapp_click, …) dla własnej strony w oknie p_days. SECURITY INVOKER — chroniona przez analytics_events_owner_select_conversion.';
