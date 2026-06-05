/**
 * wFirma API2 — wystawianie faktury po Stripe Checkout.
 * Dokumentacja: https://doc.wfirma.pl/ (autoryzacja nagłówkami accessKey / secretKey / appKey, body XML).
 *
 * Uwaga: oficjalne API2 nie przyjmuje JSON na /invoices/add — używamy XML (inputFormat=xml).
 */
import type Stripe from "npm:stripe@^14.0.0";

const WFIRMA_BASE = (Deno.env.get("WFIRMA_API_BASE") ?? "https://api2.wfirma.pl").replace(
  /\/$/,
  "",
);

export type WfirmaCredentials = {
  accessKey: string;
  secretKey: string;
  appKey: string;
  companyId?: string;
};

export function readWfirmaCredentials(): WfirmaCredentials | null {
  if (Deno.env.get("WFIRMA_ENABLED") === "false") return null;
  const accessKey = (Deno.env.get("WFIRMA_ACCESS_KEY") ?? "").trim();
  const secretKey = (Deno.env.get("WFIRMA_SECRET_KEY") ?? "").trim();
  const appKey = (Deno.env.get("WFIRMA_APP_KEY") ?? "").trim();
  if (!accessKey || !secretKey || !appKey) return null;
  const companyId = (Deno.env.get("WFIRMA_COMPANY_ID") ?? "").trim() || undefined;
  return { accessKey, secretKey, appKey, companyId };
}

function xmlEscape(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function todayPlDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatPrice(amount: number): string {
  return amount.toFixed(2);
}

type StripeTaxIdLike = { type?: string | null; value?: string | null };

/** Pierwszy identyfikator podatkowy ze Stripe (np. eu_vat PL…, DE…, FR…). */
export function extractTaxId(
  taxIds: StripeTaxIdLike[] | null | undefined,
): string | null {
  if (!taxIds?.length) return null;
  for (const t of taxIds) {
    const raw = String(t.value ?? "").replace(/\s/g, "");
    if (raw) return raw;
  }
  return null;
}

/** Pełny numer VAT z przedrostkiem kraju (VIES / wFirma). */
export function formatVatIdForWfirma(taxId: string, country: string): string {
  const cleaned = taxId.replace(/\s/g, "");
  if (!cleaned) return "";
  if (/^[A-Z]{2}/i.test(cleaned)) return cleaned.toUpperCase();
  const cc = country.trim().toUpperCase();
  if (cc === "PL") {
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length === 10) return `PL${digits}`;
  }
  return cc ? `${cc}${cleaned}`.toUpperCase() : cleaned.toUpperCase();
}

function splitPersonName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Klient", lastName: "DFCMS" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "-" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function planLabelFromTier(tier: string | undefined, fallback: string): string {
  const t = String(tier ?? "").toLowerCase();
  if (t === "tier0" || t === "starter") return "DFCMS Starter";
  if (t === "tier1" || t === "standard" || t === "pro") return "DFCMS Standard";
  return fallback || "Subskrypcja DFCMS";
}

function buildWfirmaQuery(companyId?: string): string {
  const q = new URLSearchParams({
    inputFormat: "xml",
    outputFormat: "xml",
  });
  if (companyId) q.set("company_id", companyId);
  return q.toString();
}

function wfirmaHeaders(creds: WfirmaCredentials): HeadersInit {
  return {
    Accept: "application/xml",
    "Content-Type": "application/xml; charset=utf-8",
    accessKey: creds.accessKey,
    secretKey: creds.secretKey,
    appKey: creds.appKey,
  };
}

function parseWfirmaStatusCode(xml: string): string {
  const m = xml.match(/<status>[\s\S]*?<code>([^<]+)<\/code>/i);
  return m?.[1]?.trim() ?? "";
}

function parseInvoiceIdFromXml(xml: string): string | null {
  const m = xml.match(/<invoices>[\s\S]*?<invoice>[\s\S]*?<id>(\d+)<\/id>/i);
  return m?.[1] ?? null;
}

export type WfirmaInvoiceLine = {
  name: string;
  unitPriceNet: number;
  vatRate: string;
  quantity?: number;
};

export type WfirmaContractorInput = {
  email: string;
  fullName: string;
  nip: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
};

export type WfirmaInvoiceOpts = {
  isB2B: boolean;
  isForeignB2B?: boolean;
  stripeSessionId: string;
};

export function buildWfirmaInvoiceAddXml(
  contractor: WfirmaContractorInput,
  line: WfirmaInvoiceLine,
  opts: WfirmaInvoiceOpts,
): string {
  const invoiceType = opts.isB2B ? "normal" : "bill";
  const vat = !opts.isB2B
    ? "zw"
    : opts.isForeignB2B
    ? "NP"
    : line.vatRate;
  const qty = line.quantity ?? 1;
  const name = contractor.fullName || contractor.email;
  const contractorName = opts.isB2B ? name : name;
  const nipBlock = opts.isB2B && contractor.nip
    ? `<nip>${xmlEscape(contractor.nip)}</nip>`
    : "";

  const { firstName, lastName } = splitPersonName(contractor.fullName || name);
  const personBlock = opts.isB2B
    ? ""
    : `<firstname>${xmlEscape(firstName)}</firstname><lastname>${xmlEscape(lastName)}</lastname>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <invoices>
    <invoice>
      <type>${invoiceType}</type>
      <paymentmethod>card</paymentmethod>
      <paymentdate>${todayPlDate()}</paymentdate>
      <description>${xmlEscape(`Stripe Checkout ${opts.stripeSessionId}`)}</description>
      <contractor>
        <name>${xmlEscape(contractorName)}</name>
        ${personBlock}
        ${nipBlock}
        <street>${xmlEscape(contractor.street)}</street>
        <zip>${xmlEscape(contractor.zip)}</zip>
        <city>${xmlEscape(contractor.city)}</city>
        <country>${xmlEscape(contractor.country)}</country>
        <email>${xmlEscape(contractor.email)}</email>
      </contractor>
      <invoicecontents>
        <invoicecontent>
          <name>${xmlEscape(line.name)}</name>
          <unit>szt.</unit>
          <count>${formatPrice(qty)}</count>
          <price>${formatPrice(line.unitPriceNet)}</price>
          <price_modified>0</price_modified>
          <vat>${xmlEscape(vat)}</vat>
        </invoicecontent>
      </invoicecontents>
    </invoice>
  </invoices>
</api>`;
}

export function buildWfirmaSendEmailXml(
  email: string,
  subject: string,
  body: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <invoices>
    <parameters>
      <parameter>
        <name>email</name>
        <value>${xmlEscape(email)}</value>
      </parameter>
      <parameter>
        <name>subject</name>
        <value>${xmlEscape(subject)}</value>
      </parameter>
      <parameter>
        <name>body</name>
        <value>${xmlEscape(body)}</value>
      </parameter>
      <parameter>
        <name>page</name>
        <value>invoice</value>
      </parameter>
      <parameter>
        <name>leaflet</name>
        <value>0</value>
      </parameter>
      <parameter>
        <name>duplicate</name>
        <value>0</value>
      </parameter>
    </parameters>
  </invoices>
</api>`;
}

async function wfirmaPost(
  creds: WfirmaCredentials,
  path: string,
  xmlBody: string,
): Promise<{ ok: boolean; status: number; body: string; apiCode: string }> {
  const url = `${WFIRMA_BASE}${path}?${buildWfirmaQuery(creds.companyId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: wfirmaHeaders(creds),
    body: xmlBody,
  });
  const body = await res.text();
  const apiCode = parseWfirmaStatusCode(body);
  const ok = res.ok && (apiCode === "OK" || apiCode === "NO_CONTENT" || apiCode === "");
  return { ok, status: res.status, body, apiCode };
}

export async function wfirmaCreateAndEmailInvoice(
  creds: WfirmaCredentials,
  contractor: WfirmaContractorInput,
  line: WfirmaInvoiceLine,
  opts: WfirmaInvoiceOpts,
): Promise<{ invoiceId: string | null }> {
  const addXml = buildWfirmaInvoiceAddXml(contractor, line, opts);
  const addRes = await wfirmaPost(creds, "/invoices/add", addXml);
  if (!addRes.ok) {
    throw new Error(
      `wfirma invoices/add failed HTTP ${addRes.status} code=${addRes.apiCode} body=${addRes.body.slice(0, 800)}`,
    );
  }

  const invoiceId = parseInvoiceIdFromXml(addRes.body);
  if (!invoiceId) {
    throw new Error(`wfirma invoices/add: brak id w odpowiedzi: ${addRes.body.slice(0, 800)}`);
  }

  const subject = "Faktura za subskrypcję DFCMS";
  const body =
    "Dziękujemy za opłacenie subskrypcji DFCMS. W załączeniu przesyłamy dokument księgowy.";
  const sendXml = buildWfirmaSendEmailXml(contractor.email, subject, body);
  const sendRes = await wfirmaPost(creds, `/invoices/send/${invoiceId}`, sendXml);
  if (!sendRes.ok) {
    throw new Error(
      `wfirma invoices/send/${invoiceId} failed HTTP ${sendRes.status} code=${sendRes.apiCode}`,
    );
  }

  return { invoiceId };
}

/** Netto z kwoty brutto (PL VAT). */
export function netFromGross(gross: number, vatPercent: number): number {
  if (vatPercent <= 0) return gross;
  return gross / (1 + vatPercent / 100);
}

export type CheckoutWfirmaContext = {
  session: Stripe.Checkout.Session;
  tierLabel?: string;
  productName?: string;
  unitPriceNet?: number;
};

/**
 * Nie rzuca — loguje błędy. Wywołuj po udanym zapisie billing w Supabase (fire-and-forget).
 */
export async function tryIssueWfirmaInvoiceForCheckout(
  ctx: CheckoutWfirmaContext,
): Promise<void> {
  const creds = readWfirmaCredentials();
  if (!creds) {
    console.warn(
      "wfirma: pominięto — brak WFIRMA_ACCESS_KEY / WFIRMA_SECRET_KEY / WFIRMA_APP_KEY lub WFIRMA_ENABLED=false",
    );
    return;
  }

  const session = ctx.session;
  const details = session.customer_details;
  const email = (details?.email ?? session.customer_email ?? "").trim();
  if (!email) {
    console.warn("wfirma: pominięto — brak email w checkout.session", session.id);
    return;
  }

  const taxIdRaw = extractTaxId(details?.tax_ids ?? null);
  const isB2B = !!taxIdRaw;

  const addr = details?.address;
  const street = (addr?.line1 ?? "brak adresu").trim();
  const zip = (addr?.postal_code ?? "00-000").trim();
  const city = (addr?.city ?? "—").trim();
  const country = (addr?.country ?? "PL").trim().toUpperCase();
  const isForeignB2B = isB2B && country !== "PL";
  const vatId = taxIdRaw ? formatVatIdForWfirma(taxIdRaw, country) : null;
  const fullName = (details?.name ?? email).trim();

  const vatPercent = Number(Deno.env.get("WFIRMA_VAT_RATE") ?? "23") || 23;
  const grossPln = (session.amount_total ?? 0) / 100;
  const unitPriceNet = ctx.unitPriceNet ?? (
    isB2B && !isForeignB2B
      ? netFromGross(grossPln, vatPercent)
      : grossPln
  );
  const lineVatRate = isForeignB2B ? "NP" : String(vatPercent);

  const lineName = ctx.productName ??
    planLabelFromTier(ctx.tierLabel, "Subskrypcja DFCMS");

  try {
    const result = await wfirmaCreateAndEmailInvoice(
      creds,
      { email, fullName, nip: vatId, street, zip, city, country },
      {
        name: lineName,
        unitPriceNet,
        vatRate: lineVatRate,
      },
      { isB2B, isForeignB2B, stripeSessionId: session.id },
    );
    console.log(
      JSON.stringify({
        tag: "wfirma-invoice",
        ok: true,
        stripe_session_id: session.id,
        wfirma_invoice_id: result.invoiceId,
        b2b: isB2B,
        foreign_b2b: isForeignB2B,
        email,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        tag: "wfirma-invoice",
        ok: false,
        stripe_session_id: session.id,
        error: msg,
      }),
    );
  }
}
