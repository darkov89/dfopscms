-- Idempotencja faktur wFirma (Stripe webhook retry → bez duplikatów FV).
-- Tylko service_role (Edge Functions); brak dostępu dla anon/authenticated.

CREATE TABLE IF NOT EXISTS public.wfirma_invoice_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_source text NOT NULL CHECK (stripe_source IN ('checkout', 'invoice')),
  stripe_reference text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'issued', 'failed')),
  wfirma_invoice_id text,
  error_message text,
  gross_paid_pln numeric(12, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wfirma_invoice_ledger_stripe_ref_unq UNIQUE (stripe_source, stripe_reference)
);

COMMENT ON TABLE public.wfirma_invoice_ledger IS
  'Rejestr wystawionych faktur wFirma po Stripe (idempotencja webhooków).';

CREATE INDEX IF NOT EXISTS wfirma_invoice_ledger_status_idx
  ON public.wfirma_invoice_ledger (status, updated_at);

ALTER TABLE public.wfirma_invoice_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.wfirma_invoice_ledger FROM PUBLIC;
GRANT ALL ON TABLE public.wfirma_invoice_ledger TO service_role;
