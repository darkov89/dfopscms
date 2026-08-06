// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@^2.39.0";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Hostname FQDN (bez protokołu, ścieżki, portu). */
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Domeny platformy / lokalne — nie wolno ich claimować jako custom_domain klienta. */
const RESERVED_DOMAIN_SUFFIXES = [
  "dfcms.pl",
  "dfopscms.pl",
  "dfopscms.pages.dev",
  "pages.dev",
  "localhost",
];

function normalizeHostname(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/[?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function isValidCustomerHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false;
  if (/[^a-z0-9.-]/.test(hostname)) return false;
  if (hostname.startsWith(".") || hostname.endsWith(".") || hostname.includes("..")) {
    return false;
  }
  if (!DOMAIN_RE.test(hostname)) return false;
  // Wymagaj co najmniej jednej kropki (nie „localhost”, nie single-label).
  if (!hostname.includes(".")) return false;
  return true;
}

function isReservedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  for (const suffix of RESERVED_DOMAIN_SUFFIXES) {
    if (h === suffix || h.endsWith("." + suffix)) return true;
  }
  return false;
}

function normalizePlan(plan: unknown): string {
  const raw = plan && String(plan).trim() !== "" ? String(plan).trim() : "trial";
  if (raw === "tier2" || raw === "premium") return "tier1";
  return raw;
}

function planAllowsCustomDomain(plan: unknown): boolean {
  const p = normalizePlan(plan);
  return p !== "trial" && p !== "tier0";
}

type CfHostname = {
  id?: string;
  hostname?: string;
  status?: string;
  verification_errors?: string[];
  ssl?: { status?: string; method?: string };
  ownership_verification?: {
    type?: string;
    name?: string;
    value?: string;
  };
};

type CfApiBody = {
  success?: boolean;
  result?: CfHostname | CfHostname[] | null;
  result_info?: { count?: number };
  errors?: Array<{ code?: number; message?: string }>;
};

/** Cloudflare for SaaS: 1406 = Duplicate custom hostname found. */
function isDuplicateCustomHostname(cfData: CfApiBody): boolean {
  const errors = Array.isArray(cfData?.errors) ? cfData.errors : [];
  return errors.some((e) => {
    if (Number(e?.code) === 1406) return true;
    const msg = String(e?.message || "").toLowerCase();
    return msg.includes("duplicate custom hostname");
  });
}

function cfAuthHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function summarizeHostname(row: CfHostname | null | undefined) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id || null,
    hostname: row.hostname || null,
    status: row.status || null,
    ssl_status: row.ssl?.status || null,
    verification_errors: Array.isArray(row.verification_errors)
      ? row.verification_errors
      : [],
    ownership_verification: row.ownership_verification || null,
  };
}

async function fetchCustomHostname(
  zoneId: string,
  token: string,
  hostname: string,
): Promise<CfHostname | null> {
  const url =
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames` +
    `?hostname=${encodeURIComponent(hostname)}`;
  const res = await fetch(url, { headers: cfAuthHeaders(token) });
  const data = (await res.json().catch(() => ({}))) as CfApiBody;
  if (!res.ok || !data.success) {
    console.error("CF GET custom_hostname failed:", hostname, data);
    return null;
  }
  const list = Array.isArray(data.result) ? data.result : [];
  return list.find((r) => String(r?.hostname || "").toLowerCase() === hostname) ||
    list[0] ||
    null;
}

async function refreshCustomHostnameSsl(
  zoneId: string,
  token: string,
  id: string,
): Promise<CfHostname | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames/${id}`,
    {
      method: "PATCH",
      headers: cfAuthHeaders(token),
      body: JSON.stringify({
        ssl: {
          method: "http",
          type: "dv",
        },
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as CfApiBody;
  if (!res.ok || !data.success) {
    console.error("CF PATCH custom_hostname failed:", id, data);
    return null;
  }
  return (data.result && !Array.isArray(data.result) ? data.result : null) as
    | CfHostname
    | null;
}

/**
 * Tworzy Custom Hostname albo zwraca istniejący (1406) + odświeża SSL gdy utknął.
 */
async function ensureCustomHostname(
  zoneId: string,
  token: string,
  hostname: string,
): Promise<{
  hostname: string;
  alreadyExists: boolean;
  record: CfHostname | null;
  error?: string;
}> {
  const createRes = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`,
    {
      method: "POST",
      headers: cfAuthHeaders(token),
      body: JSON.stringify({
        hostname,
        ssl: {
          method: "http",
          type: "dv",
        },
      }),
    },
  );

  const createData = (await createRes.json().catch(() => ({}))) as CfApiBody;
  const alreadyExists = isDuplicateCustomHostname(createData);

  if ((!createRes.ok || !createData.success) && !alreadyExists) {
    console.error("Błąd Cloudflare create:", hostname, createData);
    return {
      hostname,
      alreadyExists: false,
      record: null,
      error:
        createData.errors?.[0]?.message || "Błąd integracji z Cloudflare",
    };
  }

  let record: CfHostname | null = alreadyExists
    ? null
    : (createData.result && !Array.isArray(createData.result)
      ? createData.result
      : null);

  if (alreadyExists || !record) {
    record = await fetchCustomHostname(zoneId, token, hostname);
  }

  const sslStatus = String(record?.ssl?.status || "").toLowerCase();
  const hostStatus = String(record?.status || "").toLowerCase();
  const needsRefresh =
    !!record?.id &&
    (hostStatus === "pending" ||
      sslStatus === "pending_validation" ||
      sslStatus === "pending_issuance" ||
      sslStatus === "pending_deployment" ||
      sslStatus === "expired" ||
      sslStatus === "deleted" ||
      sslStatus === "initialization_error" ||
      sslStatus === "validation_timed_out");

  if (needsRefresh && record?.id) {
    const refreshed = await refreshCustomHostnameSsl(zoneId, token, record.id);
    if (refreshed) record = refreshed;
    else {
      // PATCH bywa pusty — pobierz świeży stan.
      record = (await fetchCustomHostname(zoneId, token, hostname)) || record;
    }
  }

  return { hostname, alreadyExists, record };
}

serve(async (req) => {
  const cors = buildCorsHeadersForRequest(req, corsHeaders);
  if (!cors) {
    return new Response(JSON.stringify({ success: false, error: "CORS: origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Brak autoryzacji");
    }

    const body = await req.json().catch(() => ({}));
    const clear = body?.clear === true || body?.action === "clear";
    const dnsVerified = body?.dnsVerified === true;
    const pageId = body?.pageId;
    const hostname = normalizeHostname(
      typeof body?.domain === "string" ? body.domain : "",
    );

    if (!pageId) {
      throw new Error("Brak wymaganego parametru: pageId");
    }
    if (!clear && !hostname) {
      throw new Error("Brak wymaganych parametrów: domain lub pageId");
    }
    if (!clear) {
      if (!isValidCustomerHostname(hostname)) {
        throw new Error("Nieprawidłowy adres domeny");
      }
      if (isReservedHostname(hostname)) {
        throw new Error("Tej domeny nie można podłączyć (domena platformy)");
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser();
    if (userErr || !user) {
      throw new Error("Nieautoryzowany");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: pageRow, error: pageErr } = await supabaseAdmin
      .from("pages")
      .select("id, user_id, billing_plan, custom_domain")
      .eq("id", pageId)
      .limit(1)
      .maybeSingle();

    if (pageErr) throw pageErr;
    if (!pageRow) {
      throw new Error("Brak uprawnień do tej strony");
    }

    let isGod = false;
    const isOwner = pageRow.user_id === user.id;
    if (!isOwner) {
      const { data: superRow, error: superErr } = await supabaseAdmin
        .from("superadmins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (superErr) throw superErr;
      if (!superRow?.user_id) {
        throw new Error("Brak uprawnień do tej strony");
      }
      isGod = true;
    } else {
      const { data: superRow } = await supabaseAdmin
        .from("superadmins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      isGod = !!superRow?.user_id;
    }

    if (clear) {
      const { error: clearErr } = await supabaseAdmin
        .from("pages")
        .update({
          custom_domain: null,
          custom_domain_status: "none",
        })
        .eq("id", pageId);
      if (clearErr) throw clearErr;
      return new Response(
        JSON.stringify({
          success: true,
          cleared: true,
          hostname: null,
          custom_domain_status: "none",
        }),
        {
          headers: { ...cors, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    if (!isGod) {
      const ownerId = String(pageRow.user_id || "");
      const { data: profile } = await supabaseAdmin
        .from("billing_profiles")
        .select("plan")
        .eq("user_id", ownerId)
        .maybeSingle();
      const planFromProfile = normalizePlan(profile?.plan);
      const planFromPage = normalizePlan(pageRow.billing_plan);
      const effectivePlan =
        planFromProfile && planFromProfile !== "trial"
          ? planFromProfile
          : planFromPage;
      if (!planAllowsCustomDomain(effectivePlan)) {
        throw new Error(
          "Własna domena jest dostępna od planu Standard. Ulepsz subskrypcję w panelu.",
        );
      }
    }

    // Unikalność: inna strona nie może trzymać tej samej domeny.
    const { data: taken, error: takenErr } = await supabaseAdmin
      .from("pages")
      .select("id")
      .eq("custom_domain", hostname)
      .neq("id", pageId)
      .limit(1)
      .maybeSingle();
    if (takenErr) throw takenErr;
    if (taken?.id) {
      throw new Error("Ta domena jest już przypisana do innej strony");
    }

    const CF_ZONE_ID = Deno.env.get("CF_ZONE_ID");
    const CF_API_TOKEN = Deno.env.get("CF_API_TOKEN");

    if (!CF_ZONE_ID || !CF_API_TOKEN) {
      throw new Error("Brak konfiguracji Cloudflare na serwerze");
    }

    // Apex + www: CNAME na www to wspierana ścieżka CF for SaaS; sam apex na A
    // bez Apex Proxying często zostaje w pending → Error 1001 / SSL mismatch.
    const wwwHostname = `www.${hostname}`;
    const [apexResult, wwwResult] = await Promise.all([
      ensureCustomHostname(CF_ZONE_ID, CF_API_TOKEN, hostname),
      ensureCustomHostname(CF_ZONE_ID, CF_API_TOKEN, wwwHostname),
    ]);

    if (apexResult.error && wwwResult.error) {
      throw new Error(apexResult.error || wwwResult.error);
    }
    // Wystarczy jeden hostname (zwykle www) — apex może czekać na Apex Proxying.
    if (apexResult.error && !wwwResult.record) {
      throw new Error(apexResult.error);
    }
    if (wwwResult.error && !apexResult.record) {
      throw new Error(wwwResult.error);
    }

    const apexSummary = summarizeHostname(apexResult.record);
    const wwwSummary = summarizeHostname(wwwResult.record);
    const alreadyExists = !!(apexResult.alreadyExists || wwwResult.alreadyExists);
    const cfActive = [apexSummary, wwwSummary].some(
      (r) =>
        String(r?.status || "").toLowerCase() === "active" &&
        String(r?.ssl_status || "").toLowerCase() === "active",
    );
    const dbStatus = cfActive || dnsVerified ? "active" : "pending";

    const { error: dbError } = await supabaseAdmin
      .from("pages")
      .update({
        custom_domain: hostname,
        custom_domain_status: dbStatus,
      })
      .eq("id", pageId);

    if (dbError) {
      // UNIQUE pages_custom_domain_key — race z innym claimem
      if (String(dbError.code || "") === "23505") {
        throw new Error("Ta domena jest już przypisana do innej strony");
      }
      throw dbError;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: alreadyExists
          ? "Domena już była w Cloudflare — odświeżono hostname (apex + www)"
          : "Domena dodana do Cloudflare (apex + www)",
        hostname,
        alreadyExists,
        cfActive,
        dnsVerified,
        custom_domain_status: dbStatus,
        apex: apexSummary,
        www: wwwSummary,
        data: apexResult.record,
      }),
      {
        headers: { ...cors, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...cors, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
