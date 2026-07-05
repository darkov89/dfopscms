-- Silnik Wzrostu — zakładka „Statystyki” (Faza B): dowolny zakres dat + unikalne odwiedziny.
-- Osobny RPC od get_page_growth_stats (dashboard, okno 7 dni + draft_stale_days) — tu liczymy
-- total ORAZ unique per event_name w dowolnym oknie [p_from, p_to).
--
-- UWAGA semantyka „unique”: visitor_key = hash(IP+slug+DZIEŃ) liczony w Edge (record-site-event),
-- więc count(distinct visitor_key) = „unikalni w rozbiciu dziennym” (jedna osoba raz na dobę).
-- To świadoma decyzja pro-RODO (brak stałego identyfikatora w czasie) — patrz backlog §13 spec.

CREATE OR REPLACE FUNCTION public.get_page_stats_range(
  p_page_id bigint,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      e.event_name,
      jsonb_build_object('total', e.total, 'unique', e.uniq)
    ),
    '{}'::jsonb
  )
  FROM (
    SELECT
      event_name,
      count(*) AS total,
      count(DISTINCT visitor_key) AS uniq
    FROM public.analytics_events
    WHERE event_scope IN ('conversion', 'visit')
      AND page_id = p_page_id
      AND (p_from IS NULL OR created_at >= p_from)
      AND (p_to IS NULL OR created_at < p_to)
    GROUP BY event_name
  ) e;
$$;

REVOKE ALL ON FUNCTION public.get_page_stats_range(bigint, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_page_stats_range(bigint, timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.get_page_stats_range(bigint, timestamptz, timestamptz) IS
  'Zakładka Statystyki (statsPanel.js): total + unique (distinct visitor_key) per event_name dla własnej strony w oknie [p_from, p_to). NULL = brak ograniczenia (all-time / do teraz). SECURITY INVOKER — chroniona przez analytics_events_owner_select_conversion i RLS pages (owner/superadmin).';
