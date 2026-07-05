-- Silnik Wzrostu — domknięcie reguły `publish_reminder` (docs/GROWTH_AUTOPILOT_ARCHITECTURE.md §6.3, §11).
-- Problem: reguła sprawdzała `weekStats.draft_stale_days`, ale nic go nie liczyło — reguła nigdy
-- się nie wyzwalała. Rozwiązanie: znacznik czasu rozbieżności draft/content liczony triggerem
-- w bazie (zero zmian w adminApp.js — zgodnie z ochroną monolitu, §14).

-- =====================================================================================
-- 1) pages.draft_updated_at — znacznik "od kiedy draft_content różni się od content"
-- =====================================================================================

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;

COMMENT ON COLUMN public.pages.draft_updated_at IS
  'Ustawiane triggerem pages_set_draft_updated_at(): moment, od kiedy draft_content różni się od content (niepublikowane zmiany). NULL = brak rozbieżności (draft = content).';

-- Backfill: strony z aktualnie rozbieżnym draft/content dostają znacznik "teraz" (lepsze niż
-- fałszywe "0 dni" przy pierwszym uruchomieniu reguły, ale nie chcemy też natychmiastowego alertu
-- dla stron z wieloletnią, nieświeżą rozbieżnością — `now()` jest bezpiecznym punktem startowym).
UPDATE public.pages
SET draft_updated_at = timezone('utc', now())
WHERE draft_content IS DISTINCT FROM content;

-- =====================================================================================
-- 2) Trigger: aktualizuje znacznik przy każdym UPDATE, gdy zmienia się content/draft_content
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.pages_set_draft_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.draft_content IS DISTINCT FROM NEW.content THEN
    -- Rozbieżność właśnie powstała (autosave draftu) → zapamiętaj moment startu odliczania.
    -- Jeśli rozbieżność już trwała (kolejny autosave), zostaw istniejący znacznik bez zmian.
    IF OLD.draft_content IS NOT DISTINCT FROM OLD.content THEN
      NEW.draft_updated_at := timezone('utc', now());
    END IF;
  ELSE
    -- Publikacja zrównała draft_content = content → reset (brak niepublikowanych zmian).
    NEW.draft_updated_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pages_set_draft_updated_at ON public.pages;
CREATE TRIGGER trg_pages_set_draft_updated_at
BEFORE UPDATE ON public.pages
FOR EACH ROW
WHEN (NEW.draft_content IS DISTINCT FROM OLD.draft_content OR NEW.content IS DISTINCT FROM OLD.content)
EXECUTE FUNCTION public.pages_set_draft_updated_at();

COMMENT ON FUNCTION public.pages_set_draft_updated_at() IS
  'Silnik Wzrostu: liczy od kiedy draft_content != content (patrz get_page_growth_stats → draft_stale_days, reguła publish_reminder).';

-- =====================================================================================
-- 3) get_page_growth_stats() — dołóż draft_stale_days do wyniku (bez zmiany podpisu funkcji)
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
         WHERE event_scope = 'conversion'
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
  'Panel (growthRepository.js): liczniki konwersji (phone_click, booking_click, whatsapp_click, …) dla własnej strony w oknie p_days + draft_stale_days (dni od rozbieżności draft/content). SECURITY INVOKER — chroniona przez analytics_events_owner_select_conversion i RLS pages (owner/superadmin).';
