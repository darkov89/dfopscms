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

/** Pełny numer VAT UE z prefiksem kraju (VIES). */
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

export type WfirmaTaxIdType = "nip" | "eu_vat";

/** Identyfikator podatkowy w formacie wymaganym przez wFirma (`nip` + `tax_id_type`). */
export function resolveWfirmaTaxIdentifier(
  taxIdRaw: string,
  country: string,
): { value: string; type: WfirmaTaxIdType; euPrefix?: string } {
  const cleaned = taxIdRaw.replace(/\s/g, "");
  const cc = country.trim().toUpperCase() || "PL";
  const prefixMatch = cleaned.match(/^([A-Z]{2})(.+)$/i);
  const vatPrefix = prefixMatch?.[1]?.toUpperCase();
  const vatBody = prefixMatch?.[2] ?? cleaned;

  const looksLikePolishNip =
    cc === "PL" &&
    (!vatPrefix || vatPrefix === "PL") &&
    vatBody.replace(/\D/g, "").length === 10;

  if (looksLikePolishNip) {
    return { type: "nip", value: vatBody.replace(/\D/g, "") };
  }

  const euPrefix = vatPrefix && vatPrefix !== "PL" ? vatPrefix : cc;
  return {
    type: "eu_vat",
    value: formatVatIdForWfirma(taxIdRaw, euPrefix),
    euPrefix,
  };
}

/** Rozdziela numer VAT UE na prefiks kraju i resztę (opcjonalne pole `<prefix>` w wFirma). */
export function splitEuVatForWfirma(vatId: string): { prefix: string; number: string } {
  const upper = vatId.replace(/\s/g, "").toUpperCase();
  const m = upper.match(/^([A-Z]{2})(.+)$/);
  if (!m) return { prefix: "", number: upper };
  return { prefix: m[1], number: m[2] };
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
  taxIdType?: WfirmaTaxIdType | null;
  /** Prefiks kraju UE (np. DE) — opcjonalnie obok pełnego VAT w `<nip>`. */
  euVatPrefix?: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
};

export type WfirmaInvoiceOpts = {
  isB2B: boolean;
  isForeignB2B?: boolean;
  /** Kwota brutto zapłacona w Stripe (PLN) — trafia do `<alreadypaid>`. */
  grossPaidPln: number;
  stripeReference: string;
  stripeSource: "checkout" | "invoice";
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
    ? "np"
    : line.vatRate;
  const qty = line.quantity ?? 1;
  const name = contractor.fullName || contractor.email;
  const contractorName = opts.isB2B ? name : name;

  const taxIdType: WfirmaTaxIdType | null = !opts.isB2B
    ? null
    : opts.isForeignB2B
    ? "eu_vat"
    : (contractor.taxIdType ?? "nip");

  const taxIdTypeBlock = taxIdType
    ? `<tax_id_type>${taxIdType}</tax_id_type>`
    : "";

  const euPrefixBlock = taxIdType === "eu_vat" && contractor.euVatPrefix
    ? `<prefix>${xmlEscape(contractor.euVatPrefix)}</prefix>`
    : "";

  const nipBlock = opts.isB2B && contractor.nip
    ? `<nip>${xmlEscape(contractor.nip)}</nip>`
    : "";

  const alreadyPaidBlock = opts.grossPaidPln > 0
    ? `<alreadypaid>${formatPrice(opts.grossPaidPln)}</alreadypaid>`
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
      ${alreadyPaidBlock}
      <description>${xmlEscape(`Stripe ${opts.stripeSource} ${opts.stripeReference}`)}</description>
      <contractor>
        <name>${xmlEscape(contractorName)}</name>
        ${personBlock}
        ${taxIdTypeBlock}
        ${euPrefixBlock}
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
    console.error(
      JSON.stringify({
        tag: "wfirma-api",
        step: "invoices/add",
        http: addRes.status,
        api_code: addRes.apiCode,
        body_preview: addRes.body.slice(0, 500),
      }),
    );
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
    console.error(
      JSON.stringify({
        tag: "wfirma-api",
        step: "invoices/send",
        invoice_id: invoiceId,
        http: sendRes.status,
        api_code: sendRes.apiCode,
        body_preview: sendRes.body.slice(0, 500),
      }),
    );
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

type WfirmaBillingInput = {
  email: string;
  fullName: string;
  taxIds: StripeTaxIdLike[] | null | undefined;
  street: string;
  zip: string;
  city: string;
  country: string;
  grossPln: number;
  productName: string;
  unitPriceNetOverride?: number;
  stripeReference: string;
  stripeSource: "checkout" | "invoice";
};

function computeWfirmaLineAmounts(
  grossPln: number,
  isB2B: boolean,
  isForeignB2B: boolean,
  vatPercent: number,
  unitPriceNetOverride?: number,
): { unitPriceNet: number; lineVatRate: string } {
  const unitPriceNet = unitPriceNetOverride ?? (
    isB2B && !isForeignB2B
      ? netFromGross(grossPln, vatPercent)
      : grossPln
  );
  const lineVatRate = isForeignB2B ? "np" : String(vatPercent);
  return { unitPriceNet, lineVatRate };
}

async function issueWfirmaInvoiceFromBillingInput(input: WfirmaBillingInput): Promise<void> {
  const creds = readWfirmaCredentials();
  if (!creds) {
    console.warn(
      "wfirma: pominięto — brak WFIRMA_ACCESS_KEY / WFIRMA_SECRET_KEY / WFIRMA_APP_KEY lub WFIRMA_ENABLED=false",
    );
    return;
  }

  if (!input.email) {
    console.warn("wfirma: pominięto — brak email", input.stripeReference);
    return;
  }

  if (input.grossPln <= 0) {
    console.warn("wfirma: pominięto — kwota 0", input.stripeReference);
    return;
  }

  const taxIdRaw = extractTaxId(input.taxIds);
  const isB2B = !!taxIdRaw;
  const country = input.country.trim().toUpperCase() || "PL";
  const taxId = taxIdRaw ? resolveWfirmaTaxIdentifier(taxIdRaw, country) : null;
  const isForeignB2B = isB2B && taxId?.type === "eu_vat";

  const vatPercent = Number(Deno.env.get("WFIRMA_VAT_RATE") ?? "23") || 23;
  const { unitPriceNet, lineVatRate } = computeWfirmaLineAmounts(
    input.grossPln,
    isB2B,
    isForeignB2B,
    vatPercent,
    input.unitPriceNetOverride,
  );

  const euVat = taxId?.type === "eu_vat" && taxId.value
    ? splitEuVatForWfirma(taxId.value)
    : null;

  try {
    const result = await wfirmaCreateAndEmailInvoice(
      creds,
      {
        email: input.email,
        fullName: input.fullName,
        nip: taxId?.value ?? null,
        taxIdType: taxId?.type ?? null,
        euVatPrefix: euVat?.prefix ?? taxId?.euPrefix ?? null,
        street: input.street,
        zip: input.zip,
        city: input.city,
        country,
      },
      {
        name: input.productName,
        unitPriceNet,
        vatRate: lineVatRate,
      },
      {
        isB2B,
        isForeignB2B,
        grossPaidPln: input.grossPln,
        stripeReference: input.stripeReference,
        stripeSource: input.stripeSource,
      },
    );
    console.log(
      JSON.stringify({
        tag: "wfirma-invoice",
        ok: true,
        source: input.stripeSource,
        stripe_ref: input.stripeReference,
        wfirma_invoice_id: result.invoiceId,
        b2b: isB2B,
        foreign_b2b: isForeignB2B,
        tax_id_type: taxId?.type ?? null,
        gross_paid_pln: input.grossPln,
        email: input.email,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        tag: "wfirma-invoice",
        ok: false,
        source: input.stripeSource,
        stripe_ref: input.stripeReference,
        error: msg,
      }),
    );
  }
}

/**
 * Nie rzuca — loguje błędy. Wywołuj po udanym zapisie billing w Supabase (fire-and-forget).
 */
export async function tryIssueWfirmaInvoiceForCheckout(
  ctx: CheckoutWfirmaContext,
): Promise<void> {
  const session = ctx.session;
  const details = session.customer_details;
  const email = (details?.email ?? session.customer_email ?? "").trim();
  const addr = details?.address;

  await issueWfirmaInvoiceFromBillingInput({
    email,
    fullName: (details?.name ?? email).trim(),
    taxIds: details?.tax_ids ?? null,
    street: (addr?.line1 ?? "brak adresu").trim(),
    zip: (addr?.postal_code ?? "00-000").trim(),
    city: (addr?.city ?? "—").trim(),
    country: (addr?.country ?? "PL").trim().toUpperCase(),
    grossPln: (session.amount_total ?? 0) / 100,
    productName: ctx.productName ??
      planLabelFromTier(ctx.tierLabel, "Subskrypcja DFCMS"),
    unitPriceNetOverride: ctx.unitPriceNet,
    stripeReference: session.id,
    stripeSource: "checkout",
  });
}

export type StripeInvoiceWfirmaContext = {
  invoice: Stripe.Invoice;
  tierLabel?: string;
  productName?: string;
};

async function loadTaxIdsForStripeInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<StripeTaxIdLike[] | null> {
  if (invoice.customer_tax_ids?.length) {
    return invoice.customer_tax_ids.map((t) => ({
      type: t.type,
      value: t.value,
    }));
  }

  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id;
  if (!customerId) return null;

  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ["tax_ids"],
    });
    if (customer.deleted) return null;
    const list = (customer as Stripe.Customer).tax_ids?.data ?? [];
    return list.map((t) => ({ type: t.type, value: t.value }));
  } catch (e) {
    console.warn("wfirma: customers.retrieve tax_ids", customerId, e);
    return null;
  }
}

/**
 * Faktura wFirma po opłaceniu faktury Stripe (upgrade/downgrade, odnowienie).
 * Nie rzuca — loguje błędy.
 */
export async function tryIssueWfirmaInvoiceForStripeInvoice(
  stripe: Stripe,
  ctx: StripeInvoiceWfirmaContext,
): Promise<void> {
  const invoice = ctx.invoice;
  const addr = invoice.customer_address;
  const taxIds = await loadTaxIdsForStripeInvoice(stripe, invoice);

  let productName = ctx.productName ?? "Subskrypcja DFCMS";
  const line = invoice.lines?.data?.[0];
  if (line?.description) {
    productName = line.description;
  } else if (typeof line?.price?.product === "object" && line.price.product && "name" in line.price.product) {
    const n = (line.price.product as Stripe.Product).name;
    if (n) productName = n;
  } else if (!ctx.productName && ctx.tierLabel) {
    productName = planLabelFromTier(ctx.tierLabel, productName);
  }

  await issueWfirmaInvoiceFromBillingInput({
    email: (invoice.customer_email ?? "").trim(),
    fullName: (invoice.customer_name ?? invoice.customer_email ?? "Klient").trim(),
    taxIds,
    street: (addr?.line1 ?? "brak adresu").trim(),
    zip: (addr?.postal_code ?? "00-000").trim(),
    city: (addr?.city ?? "—").trim(),
    country: (addr?.country ?? "PL").trim().toUpperCase(),
    grossPln: (invoice.amount_paid ?? 0) / 100,
    productName,
    stripeReference: invoice.id,
    stripeSource: "invoice",
  });
}
