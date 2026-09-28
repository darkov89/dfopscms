-- Deduplikacja odwiedzin (event_scope='visit') — 1 wizyta dziennie per visitor_key.
-- visitor_key = sha256(ip | slug | YYYY-MM-DD), liczony w Edge Function record-site-event.
-- Unikalny indeks zapobiega zalewaniu tabeli analytics_events powtórnymi odsłonami
-- w ciągu tej samej doby, zachowując czystą zgodność z RODO (brak cookies, brak trwałego PII).

-- Usuń duplikaty historyczne przed utworzeniem indeksu unikalnego
DELETE FROM public.analytics_events a
USING public.analytics_events b
WHERE a.ctid < b.ctid
  AND a.page_id = b.page_id
  AND a.event_name = b.event_name
  AND a.visitor_key = b.visitor_key
  AND a.event_scope = 'visit'
  AND a.visitor_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_unique_daily_visit_idx
  ON public.analytics_events (page_id, event_name, visitor_key)
  WHERE (event_scope = 'visit' AND visitor_key IS NOT NULL);

COMMENT ON INDEX public.analytics_events_unique_daily_visit_idx IS
  'Deduplikacja odsłon strony (event_scope=visit) — maksymalnie 1 wiersz per page_id + visitor_key (dzień) w oknie dobowym.';
