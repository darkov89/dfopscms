/**
 * Ręczny retry wFirma bez ponownego webhooka Stripe.
 * POST + Authorization: Bearer CRON_SECRET
 * Body: { "checkoutSessionId": "cs_live_..." } lub { "stripeInvoiceId": "in_..." }
 */
import Stripe from "npm:stripe@^14.0.0";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import {
  firstRecurringPriceId,
  normalizeStripePaidTier,
  readStripePriceEnv,
  tierFromStripePrice,
} from "../_shared/stripeBilling.ts";
import {
  tryIssueWfirmaInvoiceForCheckout,
  tryIssueWfirmaInvoiceForStripeInvoice,
} from "../_shared/wfirmaBilling.ts";
import {
  prepareLedgerForForcedRetry,
} from "../_shared/wfirmaInvoiceLedger.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const cronSecret = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!cronSecret || token !== cronSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const stripeSecret = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceRole = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  if (!stripeSecret || !supabaseUrl || !serviceRole) {
    return jsonResponse({ error: "Server misconfiguration" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const checkoutSessionId = typeof body.checkoutSessionId === "string"
    ? body.checkoutSessionId.trim()
    : "";
  const stripeInvoiceId = typeof body.stripeInvoiceId === "string"
    ? body.stripeInvoiceId.trim()
    : "";

  if (!checkoutSessionId && !stripeInvoiceId) {
    return jsonResponse({
      error: "Podaj checkoutSessionId (cs_…) lub stripeInvoiceId (in_…)",
    }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2022-11-15",
    httpClient: Stripe.createFetchHttpClient(),
  });
  const prices = readStripePriceEnv();

  try {
    if (checkoutSessionId) {
      const { data: ledger } = await supabase
        .from("wfirma_invoice_ledger")
        .select("id, status, wfirma_invoice_id")
        .eq("stripe_source", "checkout")
        .eq("stripe_reference", checkoutSessionId)
        .maybeSingle();

      if (ledger?.id) {
        const prep = await prepareLedgerForForcedRetry(supabase, ledger.id);
        if (prep.skip) {
          return jsonResponse({
            ok: true,
            skipped: true,
            reason: "already_issued",
            checkoutSessionId,
            wfirma_invoice_id: prep.wfirmaInvoiceId ?? null,
          });
        }
      }

      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
        expand: ["customer_details.tax_ids"],
      });

      if (session.mode !== "subscription") {
        return jsonResponse({ error: "Sesja nie jest subskrypcją" }, 400);
      }

      const subRef = session.subscription;
      const subId = typeof subRef === "string" ? subRef : subRef?.id ?? "";
      let tierLabel: "tier0" | "tier1" = "tier1";
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        const priceId = firstRecurringPriceId(sub);
        tierLabel = normalizeStripePaidTier(
          tierFromStripePrice(
            priceId,
            prices.priceStarter,
            prices.priceStarterYearly,
            prices.pricePro,
            prices.priceProYearly,
            "tier1",
          ),
        );
      }

      let productName = tierLabel === "tier0" ? "DFCMS Starter" : "DFCMS Standard";
      try {
        const items = await stripe.checkout.sessions.listLineItems(checkoutSessionId, { limit: 1 });
        const item = items.data[0];
        if (item?.description) productName = item.description;
      } catch {
        // ignore
      }

      await tryIssueWfirmaInvoiceForCheckout({
        session,
        tierLabel,
        productName,
      }, supabase);

      const { data: after } = await supabase
        .from("wfirma_invoice_ledger")
        .select("status, wfirma_invoice_id, error_message")
        .eq("stripe_source", "checkout")
        .eq("stripe_reference", checkoutSessionId)
        .maybeSingle();

      return jsonResponse({
        ok: after?.status === "issued",
        checkoutSessionId,
        ledger: after ?? null,
      });
    }

    const { data: ledger } = await supabase
      .from("wfirma_invoice_ledger")
      .select("id, status, wfirma_invoice_id")
      .eq("stripe_source", "invoice")
      .eq("stripe_reference", stripeInvoiceId)
      .maybeSingle();

    if (ledger?.id) {
      const prep = await prepareLedgerForForcedRetry(supabase, ledger.id);
      if (prep.skip) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: "already_issued",
          stripeInvoiceId,
          wfirma_invoice_id: prep.wfirmaInvoiceId ?? null,
        });
      }
    }

    const invoice = await stripe.invoices.retrieve(stripeInvoiceId);
    await tryIssueWfirmaInvoiceForStripeInvoice(stripe, { invoice }, supabase);

    const { data: after } = await supabase
      .from("wfirma_invoice_ledger")
      .select("status, wfirma_invoice_id, error_message")
      .eq("stripe_source", "invoice")
      .eq("stripe_reference", stripeInvoiceId)
      .maybeSingle();

    return jsonResponse({
      ok: after?.status === "issued",
      stripeInvoiceId,
      ledger: after ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ tag: "retry-wfirma-invoice", error: msg }));
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
