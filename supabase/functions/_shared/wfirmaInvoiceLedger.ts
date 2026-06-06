/**
 * Idempotencja wFirma — jedna faktura na (stripe_source, stripe_reference).
 * Używaj klienta Supabase z service_role (stripe-webhook).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";

export type WfirmaStripeSource = "checkout" | "invoice";

export type WfirmaLedgerClaim =
  | { action: "proceed"; ledgerId: string }
  | {
    action: "skip";
    reason: "already_issued" | "in_progress";
    wfirmaInvoiceId?: string | null;
  };

const STALE_PENDING_MS = 15 * 60 * 1000;

type LedgerRow = {
  id: string;
  status: string;
  wfirma_invoice_id: string | null;
  updated_at: string;
};

async function fetchLedgerRow(
  supabase: SupabaseClient,
  source: WfirmaStripeSource,
  reference: string,
): Promise<LedgerRow | null> {
  const { data, error } = await supabase
    .from("wfirma_invoice_ledger")
    .select("id, status, wfirma_invoice_id, updated_at")
    .eq("stripe_source", source)
    .eq("stripe_reference", reference)
    .maybeSingle();

  if (error) {
    console.error("wfirma-ledger: select", error.message);
    throw new Error(`wfirma-ledger select failed: ${error.message}`);
  }
  return data as LedgerRow | null;
}

function isStalePending(updatedAt: string): boolean {
  return Date.now() - new Date(updatedAt).getTime() > STALE_PENDING_MS;
}

async function markLedgerPending(
  supabase: SupabaseClient,
  ledgerId: string,
  grossPaidPln?: number,
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: "pending",
    error_message: null,
    updated_at: new Date().toISOString(),
  };
  if (grossPaidPln != null && grossPaidPln > 0) {
    patch.gross_paid_pln = grossPaidPln;
  }
  const { error } = await supabase
    .from("wfirma_invoice_ledger")
    .update(patch)
    .eq("id", ledgerId);
  if (error) {
    throw new Error(`wfirma-ledger reset pending failed: ${error.message}`);
  }
}

/**
 * Rezerwuje slot na wystawienie faktury. Zwraca skip gdy FV już wystawiona lub trwa równoległy attempt.
 */
export async function claimWfirmaInvoiceLedger(
  supabase: SupabaseClient,
  source: WfirmaStripeSource,
  reference: string,
  grossPaidPln?: number,
): Promise<WfirmaLedgerClaim> {
  const existing = await fetchLedgerRow(supabase, source, reference);

  if (existing?.status === "issued") {
    return {
      action: "skip",
      reason: "already_issued",
      wfirmaInvoiceId: existing.wfirma_invoice_id,
    };
  }

  if (existing?.status === "pending" && !isStalePending(existing.updated_at)) {
    return { action: "skip", reason: "in_progress" };
  }

  if (existing) {
    await markLedgerPending(supabase, existing.id, grossPaidPln);
    return { action: "proceed", ledgerId: existing.id };
  }

  const { data: inserted, error } = await supabase
    .from("wfirma_invoice_ledger")
    .insert({
      stripe_source: source,
      stripe_reference: reference,
      status: "pending",
      gross_paid_pln: grossPaidPln != null && grossPaidPln > 0 ? grossPaidPln : null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return claimWfirmaInvoiceLedger(supabase, source, reference, grossPaidPln);
    }
    throw new Error(`wfirma-ledger insert failed: ${error.message}`);
  }

  return { action: "proceed", ledgerId: (inserted as { id: string }).id };
}

export async function markWfirmaInvoiceLedgerIssued(
  supabase: SupabaseClient,
  ledgerId: string,
  wfirmaInvoiceId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("wfirma_invoice_ledger")
    .update({
      status: "issued",
      wfirma_invoice_id: wfirmaInvoiceId,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ledgerId);

  if (error) {
    console.error("wfirma-ledger: mark issued", error.message);
  }
}

export async function markWfirmaInvoiceLedgerFailed(
  supabase: SupabaseClient,
  ledgerId: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await supabase
    .from("wfirma_invoice_ledger")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ledgerId);

  if (error) {
    console.error("wfirma-ledger: mark failed", error.message);
  }
}
