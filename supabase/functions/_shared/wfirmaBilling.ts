/**
 * wFirma API2 — wystawianie faktury po Stripe Checkout.
 * Dokumentacja: https://doc.wfirma.pl/ (autoryzacja nagłówkami accessKey / secretKey / appKey, body XML).
 *
 * Uwaga: oficjalne API2 nie przyjmuje JSON na /invoices/add — używamy XML (inputFormat=xml).
 */
import type Stripe from "npm:stripe@^14.0.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";
import {
  claimWfirmaInvoiceLedger,
  markWfirmaInvoiceLedgerFailed,
  markWfirmaInvoiceLedgerIssued,
} from "./wfirmaInvoiceLedger.ts";

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

/** Kraje UE (ISO 3166-1 alpha-2) — bez PL; do stawki NPUE vs NP. */
const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

export function isEuCountry(countryCode: string): boolean {
  const cc = countryCode.trim().toUpperCase();
  return cc !== "PL" && EU_COUNTRY_CODES.has(cc);
}

export function isForeignInvoiceCountry(countryCode: string): boolean {
  return countryCode.trim().toUpperCase() !== "PL";
}

/** Stawka VAT w XML wFirma: NPUE/NP tylko B2B zagraniczne; B2C PL = stawka krajowa. */
export function resolveWfirmaVatCode(
  isB2B: boolean,
  country: string,
  domesticVatPercent: number,
): string {
  const cc = country.trim().toUpperCase() || "PL";
  if (isB2B) {
    if (cc === "PL") return String(domesticVatPercent);
    if (isEuCountry(cc)) return "NPUE";
    return "NP";
  }
  return String(domesticVatPercent);
}

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

let cachedPolAngLanguageId: string | null | undefined;

function parsePolAngTranslationLanguageId(xml: string): string | null {
  const blocks = xml.match(/<translation_language>[\s\S]*?<\/translation_language>/gi) ?? [];
  for (const block of blocks) {
    if (!/pol-ang/i.test(block)) continue;
    const id = block.match(/<id>(\d+)<\/id>/i)?.[1];
    if (id) return id;
  }
  for (const block of blocks) {
    if (!/(?:^|>)\s*ang/i.test(block) && !/pol.?ang/i.test(block)) continue;
    const id = block.match(/<id>(\d+)<\/id>/i)?.[1];
    if (id) return id;
  }
  return null;
}

async function resolveWfirmaPolAngLanguageId(
  creds: WfirmaCredentials,
): Promise<string | null> {
  const fromEnv = (Deno.env.get("WFIRMA_TRANSLATION_LANG_EN_ID") ?? "").trim();
  if (fromEnv) return fromEnv;
  if (cachedPolAngLanguageId !== undefined) return cachedPolAngLanguageId;

  const findXml = `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <translation_languages>
    <parameters>
      <limit>50</limit>
    </parameters>
  </translation_languages>
</api>`;

  const res = await wfirmaPost(creds, "/translation_languages/find", findXml);
  if (!res.ok) {
    console.warn(
      JSON.stringify({
        tag: "wfirma-api",
        step: "translation_languages/find",
        http: res.status,
        api_code: res.apiCode,
      }),
    );
    cachedPolAngLanguageId = null;
    return null;
  }

  cachedPolAngLanguageId = parsePolAngTranslationLanguageId(res.body);
  return cachedPolAngLanguageId;
}

function parseInvoiceIdFromXml(xml: string): string | null {
  const m = xml.match(/<invoices>[\s\S]*?<invoice>[\s\S]*?<id>(\d+)<\/id>/i);
  return m?.[1] ?? null;
}

function parseContractorIdFromXml(xml: string): string | null {
  const m = xml.match(/<contractors>[\s\S]*?<contractor>[\s\S]*?<id>(\d+)<\/id>/i);
  return m?.[1] ?? null;
}

/** B2C — kontrahent bez NIP musi istnieć w CRM przed `/invoices/add`. */
export function buildWfirmaContractorAddXml(contractor: WfirmaContractorInput): string {
  const name = contractor.fullName || contractor.email || "Klient DFCMS";
  const { firstName, lastName } = splitPersonName(name);
  const emailBlock = contractor.email
    ? `<email>${xmlEscape(contractor.email)}</email>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <contractors>
    <contractor>
      <name>${xmlEscape(name)}</name>
      <firstname>${xmlEscape(firstName)}</firstname>
      <lastname>${xmlEscape(lastName)}</lastname>
      <street>${xmlEscape(contractor.street)}</street>
      <zip>${xmlEscape(contractor.zip)}</zip>
      <city>${xmlEscape(contractor.city)}</city>
      <country>${xmlEscape(contractor.country)}</country>
      ${emailBlock}
    </contractor>
  </contractors>
</api>`;
}

async function wfirmaAddB2cContractor(
  creds: WfirmaCredentials,
  contractor: WfirmaContractorInput,
): Promise<string> {
  const addXml = buildWfirmaContractorAddXml(contractor);
  const addRes = await wfirmaPost(creds, "/contractors/add", addXml);
  if (!addRes.ok) {
    console.error(
      JSON.stringify({
        tag: "wfirma-api",
        step: "contractors/add",
        http: addRes.status,
        api_code: addRes.apiCode,
        body_preview: addRes.body.slice(0, 500),
      }),
    );
    throw new Error(
      `wfirma contractors/add failed HTTP ${addRes.status} code=${addRes.apiCode} body=${addRes.body.slice(0, 800)}`,
    );
  }

  const contractorId = parseContractorIdFromXml(addRes.body);
  if (!contractorId) {
    throw new Error(
      `wfirma contractors/add: brak id w odpowiedzi: ${addRes.body.slice(0, 800)}`,
    );
  }

  console.log(
    JSON.stringify({
      tag: "wfirma-api",
      step: "contractors/add",
      ok: true,
      contractor_id: contractorId,
      email: contractor.email,
    }),
  );

  return contractorId;
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
  /** Kontrahent spoza PL (B2B UE lub spoza UE). */
  isForeignB2B?: boolean;
  /** B2B w kraju UE (nie PL) — stawka NPUE + odwrotne obciążenie. */
  isEuB2B?: boolean;
  /** Faktura dla kontrahenta spoza PL — język pol-ang, kwoty w PLN. */
  isForeignInvoice?: boolean;
  translationLanguageId?: string | null;
  /** Kwota brutto zapłacona w Stripe (PLN) — trafia do `<alreadypaid>`. */
  grossPaidPln: number;
  stripeReference: string;
  stripeSource: "checkout" | "invoice";
};

export function buildWfirmaInvoiceAddXml(
  contractor: WfirmaContractorInput,
  line: WfirmaInvoiceLine,
  opts: WfirmaInvoiceOpts,
  contractorId?: string | null,
): string {
  const invoiceType = "normal";
  const vat = resolveWfirmaVatCode(
    opts.isB2B,
    contractor.country,
    Number(line.vatRate) || 23,
  );
  const qty = line.quantity ?? 1;

  const alreadyPaidBlock = opts.grossPaidPln > 0
    ? `<alreadypaid>${formatPrice(opts.grossPaidPln)}</alreadypaid>`
    : "";

  const currencyBlock = opts.isForeignInvoice
    ? `<currency><symbol>PLN</symbol></currency>`
    : "";

  const translationBlock = opts.isForeignInvoice && opts.translationLanguageId
    ? `<translation_language><id>${xmlEscape(opts.translationLanguageId)}</id></translation_language>`
    : "";

  const unitLabel = opts.isForeignInvoice ? "pcs." : "szt.";

  const contractorBlock = contractorId
    ? `<contractor><id>${xmlEscape(contractorId)}</id></contractor>`
    : buildInlineContractorXml(contractor, opts);

  return `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <invoices>
    <invoice>
      <type>${invoiceType}</type>
      <paymentmethod>card</paymentmethod>
      <paymentdate>${todayPlDate()}</paymentdate>
      ${currencyBlock}
      ${translationBlock}
      ${alreadyPaidBlock}
      <description>${xmlEscape(`Stripe ${opts.stripeSource} ${opts.stripeReference}`)}</description>
      ${contractorBlock}
      <invoicecontents>
        <invoicecontent>
          <name>${xmlEscape(line.name)}</name>
          <unit>${xmlEscape(unitLabel)}</unit>
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

/** B2B — pełne dane kontrahenta inline w `/invoices/add`. */
function buildInlineContractorXml(
  contractor: WfirmaContractorInput,
  opts: WfirmaInvoiceOpts,
): string {
  const name = contractor.fullName || contractor.email;
  const isEuB2B = !!opts.isEuB2B;

  const taxIdType: WfirmaTaxIdType | null = !opts.isB2B
    ? null
    : isEuB2B
    ? "eu_vat"
    : opts.isForeignB2B
    ? null
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

  const { firstName, lastName } = splitPersonName(contractor.fullName || name);
  const personBlock = opts.isB2B
    ? ""
    : `<firstname>${xmlEscape(firstName)}</firstname><lastname>${xmlEscape(lastName)}</lastname>`;

  return `<contractor>
        <name>${xmlEscape(name)}</name>
        ${personBlock}
        ${taxIdTypeBlock}
        ${euPrefixBlock}
        ${nipBlock}
        <street>${xmlEscape(contractor.street)}</street>
        <zip>${xmlEscape(contractor.zip)}</zip>
        <city>${xmlEscape(contractor.city)}</city>
        <country>${xmlEscape(contractor.country)}</country>
        <email>${xmlEscape(contractor.email)}</email>
      </contractor>`;
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
  const invoiceOpts = { ...opts };
  if (invoiceOpts.isForeignInvoice && !invoiceOpts.translationLanguageId) {
    invoiceOpts.translationLanguageId = await resolveWfirmaPolAngLanguageId(creds);
  }

  let contractorId: string | null = null;
  if (!invoiceOpts.isB2B) {
    contractorId = await wfirmaAddB2cContractor(creds, contractor);
  }

  const addXml = buildWfirmaInvoiceAddXml(contractor, line, invoiceOpts, contractorId);
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

  const subject = invoiceOpts.isForeignInvoice
    ? "Invoice for your DFCMS subscription"
    : "Faktura za subskrypcję DFCMS";
  const body = invoiceOpts.isForeignInvoice
    ? "Thank you for your DFCMS subscription payment. Please find your invoice attached."
    : "Dziękujemy za opłacenie subskrypcji DFCMS. W załączeniu przesyłamy dokument księgowy.";
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
  /** Netto ze Stripe (`amount_subtotal` / `subtotal`) — dokładniejsze niż dzielenie brutto. */
  netPlnOverride?: number;
  productName: string;
  unitPriceNetOverride?: number;
  stripeReference: string;
  stripeSource: "checkout" | "invoice";
};

function computeWfirmaLineAmounts(
  grossPln: number,
  isB2B: boolean,
  isForeignB2B: boolean,
  country: string,
  vatPercent: number,
  unitPriceNetOverride?: number,
  netPlnOverride?: number,
): { unitPriceNet: number; lineVatRate: string } {
  const cc = country.trim().toUpperCase() || "PL";
  const useDomesticNet = !isForeignB2B && cc === "PL";
  const unitPriceNet = unitPriceNetOverride ?? (
    useDomesticNet
      ? (netPlnOverride != null && netPlnOverride > 0
        ? netPlnOverride
        : netFromGross(grossPln, vatPercent))
      : grossPln
  );
  const lineVatRate = String(vatPercent);
  return { unitPriceNet, lineVatRate };
}

async function issueWfirmaInvoiceFromBillingInput(
  input: WfirmaBillingInput,
  supabase?: SupabaseClient | null,
): Promise<void> {
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

  let ledgerId: string | undefined;
  if (supabase) {
    const claim = await claimWfirmaInvoiceLedger(
      supabase,
      input.stripeSource,
      input.stripeReference,
      input.grossPln,
    );
    if (claim.action === "skip") {
      console.log(
        JSON.stringify({
          tag: "wfirma-invoice",
          ok: true,
          skipped: true,
          reason: claim.reason,
          source: input.stripeSource,
          stripe_ref: input.stripeReference,
          wfirma_invoice_id: claim.wfirmaInvoiceId ?? null,
        }),
      );
      return;
    }
    ledgerId = claim.ledgerId;
  }

  const taxIdRaw = extractTaxId(input.taxIds);
  const isB2B = !!taxIdRaw;
  const country = input.country.trim().toUpperCase() || "PL";
  const taxId = taxIdRaw ? resolveWfirmaTaxIdentifier(taxIdRaw, country) : null;
  const isForeignInvoice = isForeignInvoiceCountry(country);
  const isEuB2B = isB2B && isForeignInvoice && isEuCountry(country);
  const isForeignB2B = isB2B && isForeignInvoice;

  const vatPercent = Number(Deno.env.get("WFIRMA_VAT_RATE") ?? "23") || 23;
  const { unitPriceNet, lineVatRate } = computeWfirmaLineAmounts(
    input.grossPln,
    isB2B,
    isForeignB2B,
    country,
    vatPercent,
    input.unitPriceNetOverride,
    input.netPlnOverride,
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
        isEuB2B,
        isForeignInvoice,
        grossPaidPln: input.grossPln,
        stripeReference: input.stripeReference,
        stripeSource: input.stripeSource,
      },
    );
    if (supabase && ledgerId) {
      await markWfirmaInvoiceLedgerIssued(supabase, ledgerId, result.invoiceId);
    }
    console.log(
      JSON.stringify({
        tag: "wfirma-invoice",
        ok: true,
        source: input.stripeSource,
        stripe_ref: input.stripeReference,
        wfirma_invoice_id: result.invoiceId,
        b2b: isB2B,
        b2c_contractor_flow: !isB2B,
        eu_b2b: isEuB2B,
        foreign_b2b: isForeignB2B,
        foreign_invoice: isForeignInvoice,
        vat_code: resolveWfirmaVatCode(isB2B, country, vatPercent),
        tax_id_type: taxId?.type ?? null,
        gross_paid_pln: input.grossPln,
        net_pln: input.netPlnOverride ?? null,
        unit_price_net: unitPriceNet,
        email: input.email,
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (supabase && ledgerId) {
      await markWfirmaInvoiceLedgerFailed(supabase, ledgerId, msg);
    }
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
  supabase?: SupabaseClient | null,
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
    netPlnOverride: session.amount_subtotal != null
      ? session.amount_subtotal / 100
      : undefined,
    productName: ctx.productName ??
      planLabelFromTier(ctx.tierLabel, "Subskrypcja DFCMS"),
    unitPriceNetOverride: ctx.unitPriceNet,
    stripeReference: session.id,
    stripeSource: "checkout",
  }, supabase);
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
  supabase?: SupabaseClient | null,
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
    netPlnOverride: invoice.subtotal != null ? invoice.subtotal / 100 : undefined,
    productName,
    stripeReference: invoice.id,
    stripeSource: "invoice",
  }, supabase);
}
