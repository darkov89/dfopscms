-- Silnik Wzrostu — odwiedziny strony (page_view), obok istniejących konwersji (klik CTA).
-- Decyzja: surowe odsłony (bez odduplikowania po visitor_key), bez nowej reguły/benchmarku —
-- na razie tylko licznik "Odwiedziny (7 dni)" na dashboardzie panelu.
-- `event_scope='visit'` (odwiedziny) obok istniejącego `event_scope='conversion'` (klik CTA):
-- osobna semantyka w danych, ale ta sama tabela/RLS-owner/indeksy (rozszerzone poniżej).

-- =====================================================================================
-- 1) RLS: właściciel czyta też event_scope='visit' (nie tylko 'conversion')
-- =====================================================================================

DROP POLICY IF EXISTS analytics_events_owner_select_conversion ON public.analytics_events;
CREATE POLICY analytics_events_owner_select_conversion
ON public.analytics_events FOR SELECT TO authenticated
USING (
  event_scope IN ('conversion', 'visit')
  AND page_id IN (SELECT id FROM public.pages WHERE user_id = auth.uid())
);

COMMENT ON POLICY analytics_events_owner_select_conversion ON public.analytics_events IS
  'Właściciel strony czyta własne zdarzenia konwersji (klik CTA) i odwiedzin (page_view) — Silnik Wzrostu.';

-- =====================================================================================
-- 2) Indeksy — poszerzone o event_scope='visit' (te same wzorce dostępu co conversion)
-- =====================================================================================

DROP INDEX IF EXISTS analytics_events_page_created_idx;
CREATE INDEX IF NOT EXISTS analytics_events_page_created_idx
  ON public.analytics_events (page_id, created_at DESC)
  WHERE page_id IS NOT NULL AND event_scope IN ('conversion', 'visit');

DROP INDEX IF EXISTS analytics_events_slug_created_idx;
CREATE INDEX IF NOT EXISTS analytics_events_slug_created_idx
  ON public.analytics_events (slug, created_at DESC)
  WHERE event_scope IN ('conversion', 'visit');

COMMENT ON COLUMN public.analytics_events.event_scope IS
  'conversion = klik CTA na stronie publicznej; visit = odsłona strony (page_view); legacy = stary telemetry panelu (nieużywany od G1). Silnik Wzrostu.';

-- =====================================================================================
-- 3) get_page_growth_stats() — dołóż event_scope='visit' do zakresu liczonego RPC
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.get_page_growth_stats(p_page_id bigint, p_days int DEFAULT 7)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COALESCE(
      (SELECT jsonb_object_agg(s.event_name, s.cnt)
       FROM (
         SELECT event_name, count(*) AS cnt
         FROM public.analytics_events
         WHERE event_scope IN ('conversion', 'visit')
           AND page_id = p_page_id
           AND created_at >= (timezone('utc', now()) - make_interval(days => GREATEST(p_days, 1)))
         GROUP BY event_name
       ) s),
      '{}'::jsonb
    )
    || jsonb_build_object(
      'draft_stale_days',
      COALESCE(
        (SELECT floor(EXTRACT(EPOCH FROM (timezone('utc', now()) - p.draft_updated_at)) / 86400)
         FROM public.pages p
         WHERE p.id = p_page_id),
        0
      )
    );
$$;

COMMENT ON FUNCTION public.get_page_growth_stats(bigint, int) IS
  'Panel (growthRepository.js): liczniki konwersji (phone_click, booking_click, whatsapp_click, …) + odwiedziny (page_view) dla własnej strony w oknie p_days, plus draft_stale_days. SECURITY INVOKER — chroniona przez analytics_events_owner_select_conversion i RLS pages (owner/superadmin).';
