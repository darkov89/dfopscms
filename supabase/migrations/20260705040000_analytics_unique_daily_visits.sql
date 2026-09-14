-- Deduplikacja odwiedzin (event_scope='visit') — 1 wizyta dziennie per visitor_key.
-- visitor_key = sha256(ip | slug | YYYY-MM-DD), liczony w Edge Function record-site-event.
-- Unikalny indeks zapobiega zalewaniu tabeli analytics_events powtórnymi odsłonami
-- w ciągu tej samej doby, zachowując czystą zgodność z RODO (brak cookies, brak trwałego PII).

CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_unique_daily_visit_idx
  ON public.analytics_events (page_id, event_name, visitor_key)
  WHERE (event_scope = 'visit' AND visitor_key IS NOT NULL);

COMMENT ON INDEX public.analytics_events_unique_daily_visit_idx IS
  'Deduplikacja odsłon strony (event_scope=visit) — maksymalnie 1 wiersz per page_id + visitor_key (dzień) w oknie dobowym.';
