-- ==============================================================================
-- DFCMS Personal Presence Engine — Schemat Sygnałów i Propozycji Kuratora AI
-- Zgodność: EU AI Act (Art. 50, Human-in-the-loop) & RODO (Minimalizacja, Art. 5)
-- ==============================================================================

-- 1. Tabela Sygnałów Percepcji (surowy strumień zdarzeń z zewnętrznych zmysłów)
CREATE TABLE IF NOT EXISTS public.presence_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id bigint NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL, -- 'instagram', 'google_reviews', 'google_business', 'drive', 'direct_note'
  scope text NOT NULL DEFAULT 'public', -- 'public', 'work', 'direct'
  external_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.presence_signals IS
  'Strumień sygnałów zewnętrznych (opinie, posty, zdjęcia) zasilających cyfrowego bliźniaka.';

CREATE INDEX IF NOT EXISTS idx_presence_signals_page_created
  ON public.presence_signals(page_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_presence_signals_user_id
  ON public.presence_signals(user_id);

-- 2. Tabela Propozycji Ewolucji (bufor Human-in-the-loop — AI nie nadpisuje strony bez akceptacji)
CREATE TABLE IF NOT EXISTS public.presence_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id bigint NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL, -- 'new_project_case_study', 'review_spotlight', 'hero_focus_shift', 'timeline_update'
  title text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'superseded')),
  diff_patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_signal_ids uuid[] DEFAULT ARRAY[]::uuid[],
  rejection_reason text,
  applied_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.presence_proposals IS
  'Bufor propozycji kuratora AI. Użytkownik decyduje (1-Click OK) o publikacji lub odrzuceniu.';

CREATE INDEX IF NOT EXISTS idx_presence_proposals_page_status
  ON public.presence_proposals(page_id, status);

CREATE INDEX IF NOT EXISTS idx_presence_proposals_user_id
  ON public.presence_proposals(user_id);

-- 3. Row Level Security (RLS) — Anonimowy klient ma ZERO dostępu do sygnałów i propozycji
ALTER TABLE public.presence_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_proposals ENABLE ROW LEVEL SECURITY;

-- presence_signals: właściciel ma pełen dostęp do swoich sygnałów
CREATE POLICY presence_signals_owner_all ON public.presence_signals
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- presence_proposals: właściciel ma pełen dostęp do swoich propozycji
CREATE POLICY presence_proposals_owner_all ON public.presence_proposals
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
