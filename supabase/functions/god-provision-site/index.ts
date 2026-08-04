// @ts-ignore - remote Deno std module
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { buildCorsHeadersForRequest, isAllowedReturnUrl } from "../_shared/allowedOrigins.ts";
import { requireSuperadmin } from "../_shared/godAuth.ts";
import {
  applyManualGrantToUser,
  normalizeStripePaidTier,
  type StripePaidTier,
} from "../_shared/stripeBilling.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const PUBLISHED_THEMES = new Set([
  "beauty",
  "consultant",
  "fitness",
  "services",
  "gastro",
  "care",
]);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const corsHeadersBase: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function buildCorsHeaders(req: Request) {
  return buildCorsHeadersForRequest(req, corsHeadersBase);
}

function json(
  cors: Record<string, string>,
  body: unknown,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

function trialContentJson() {
  return {
    pl: {
      settings: {
        subscription: {
          plan: "trial",
          trial_started_at: new Date().toISOString(),
          selected_plan: null,
        },
      },
    },
  };
}

function adminRedirectUrl(req: Request): string {
  const origin = (req.headers.get("Origin") || "").trim();
  if (origin && isAllowedReturnUrl(origin)) {
    return `${origin.replace(/\/$/, "")}/admin.html`;
  }
  return "https://dfcms.pl/admin.html";
}

async function findAuthUserByEmail(
  supabaseUrl: string,
  serviceKey: string,
  email: string,
): Promise<{ id: string; email?: string } | null> {
  const url = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    console.warn("findAuthUserByEmail", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== "object") return null;
  // GoTrue may return { users: [...] } or a single user
  if (Array.isArray((data as { users?: unknown }).users)) {
    const users = (data as { users: Array<{ id?: string; email?: string }> }).users;
    const hit = users.find(
      (u) => String(u.email || "").trim().toLowerCase() === email.toLowerCase(),
    );
    return hit?.id ? { id: hit.id, email: hit.email } : null;
  }
  if (typeof (data as { id?: string }).id === "string") {
    return { id: (data as { id: string }).id, email: (data as { email?: string }).email };
  }
  return null;
}

async function waitForPageBySlug(
  // deno-lint-ignore no-explicit-any
  supabaseAdmin: any,
  slug: string,
  attempts = 8,
): Promise<{ id: number; user_id: string; slug: string; theme: string | null } | null> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await supabaseAdmin
      .from("pages")
      .select("id, user_id, slug, theme")
      .eq("slug", slug)
      .maybeSingle();
    if (data?.id) return data;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (!cors) {
    return new Response(JSON.stringify({ error: "CORS: origin not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return json(cors, { success: false, error: "Method not allowed" }, 405);
  }

  const auth = await requireSuperadmin(req);
  if (!auth.ok) {
    return json(
      cors,
      { success: false, error: auth.error, code: auth.code },
      auth.status,
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const slug =
    typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const theme =
    typeof body.theme === "string" ? body.theme.trim().toLowerCase() : "";
  const planModeRaw =
    typeof body.planMode === "string"
      ? body.planMode.trim().toLowerCase()
      : typeof body.plan_mode === "string"
      ? body.plan_mode.trim().toLowerCase()
      : "trial";
  const planMode =
    planModeRaw === "manual_grant" || planModeRaw === "manual"
      ? "manual_grant"
      : planModeRaw === "client_checkout" || planModeRaw === "checkout"
      ? "client_checkout"
      : "trial";

  if (!email || !email.includes("@")) {
    return json(cors, { success: false, error: "Podaj poprawny email", code: "INVALID_INPUT" }, 400);
  }
  if (!slug || !SLUG_RE.test(slug)) {
    return json(
      cors,
      { success: false, error: "Nieprawidłowy slug (a-z, cyfry, myślniki)", code: "INVALID_INPUT" },
      400,
    );
  }
  if (!theme || !PUBLISHED_THEMES.has(theme)) {
    return json(
      cors,
      { success: false, error: "Wybierz opublikowany motyw szablonu", code: "INVALID_INPUT" },
      400,
    );
  }

  let grantPlan: StripePaidTier | null = null;
  let expiresAt = "";
  if (planMode === "manual_grant") {
    const planRaw = typeof body.plan === "string" ? body.plan.trim().toLowerCase() : "";
    if (planRaw === "tier0" || planRaw === "starter") grantPlan = "tier0";
    else if (planRaw === "tier1" || planRaw === "standard" || planRaw === "pro") {
      grantPlan = "tier1";
    } else {
      return json(
        cors,
        { success: false, error: "Przy grancie ręcznym wybierz plan Starter lub Standard", code: "INVALID_INPUT" },
        400,
      );
    }
    grantPlan = normalizeStripePaidTier(grantPlan);
    expiresAt =
      typeof body.expiresAt === "string"
        ? body.expiresAt.trim()
        : typeof body.expires_at === "string"
        ? body.expires_at.trim()
        : "";
    if (!expiresAt) {
      return json(
        cors,
        { success: false, error: "Przy grancie ręcznym wymagana data ważności", code: "INVALID_INPUT" },
        400,
      );
    }
  }

  const { data: slugRow } = await auth.supabaseAdmin
    .from("pages")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (slugRow?.id) {
    return json(
      cors,
      { success: false, error: "Slug jest już zajęty", code: "SLUG_TAKEN" },
      409,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  let userId = "";
  let invited = false;
  let existingUser = await findAuthUserByEmail(supabaseUrl, serviceKey, email);

  if (existingUser?.id) {
    userId = existingUser.id;
  } else {
    const redirectTo = adminRedirectUrl(req);
    const { data: inviteData, error: inviteErr } =
      await auth.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { slug },
        redirectTo,
      });
    if (inviteErr) {
      const msg = inviteErr.message || "Nie udało się wysłać zaproszenia";
      // Race: user created between lookup and invite
      if (/already|registered|exists/i.test(msg)) {
        existingUser = await findAuthUserByEmail(supabaseUrl, serviceKey, email);
        if (!existingUser?.id) {
          return json(cors, { success: false, error: msg, code: "INVITE_FAILED" }, 400);
        }
        userId = existingUser.id;
      } else {
        console.error("inviteUserByEmail", inviteErr);
        return json(cors, { success: false, error: msg, code: "INVITE_FAILED" }, 400);
      }
    } else {
      userId = inviteData?.user?.id || "";
      invited = true;
      if (!userId) {
        existingUser = await findAuthUserByEmail(supabaseUrl, serviceKey, email);
        userId = existingUser?.id || "";
      }
    }
  }

  if (!userId) {
    return json(
      cors,
      { success: false, error: "Nie udało się ustalić user_id klienta", code: "INTERNAL" },
      500,
    );
  }

  let page = invited
    ? await waitForPageBySlug(auth.supabaseAdmin, slug)
    : null;

  if (!page) {
    const { data: bySlug } = await auth.supabaseAdmin
      .from("pages")
      .select("id, user_id, slug, theme")
      .eq("slug", slug)
      .maybeSingle();
    page = bySlug || null;
  }

  if (!page) {
    const content = trialContentJson();
    const { data: inserted, error: insErr } = await auth.supabaseAdmin
      .from("pages")
      .insert({
        user_id: userId,
        slug,
        theme,
        color_preset: "gold",
        content,
        draft_content: content,
        billing_plan: "trial",
      })
      .select("id, user_id, slug, theme")
      .maybeSingle();
    if (insErr || !inserted) {
      console.error("god-provision-site insert page", insErr?.message);
      return json(
        cors,
        {
          success: false,
          error: insErr?.message || "Nie udało się utworzyć strony",
          code: "PAGE_CREATE_FAILED",
        },
        500,
      );
    }
    page = inserted;
  } else if (page.user_id !== userId) {
    return json(
      cors,
      {
        success: false,
        error: "Slug należy do innego użytkownika",
        code: "SLUG_CONFLICT",
      },
      409,
    );
  } else if (String(page.theme || "") !== theme) {
    await auth.supabaseAdmin.from("pages").update({ theme }).eq("id", page.id);
    page = { ...page, theme };
  }

  let grantApplied = false;
  if (planMode === "manual_grant" && grantPlan && expiresAt) {
    const grant = await applyManualGrantToUser(auth.supabaseAdmin, {
      userId,
      plan: grantPlan,
      expiresAtIso: expiresAt,
    });
    if (!grant.ok) {
      return json(
        cors,
        {
          success: true,
          warning: grant.error,
          code: grant.code,
          userId,
          pageId: page.id,
          slug: page.slug,
          invited,
          planMode,
          grantApplied: false,
        },
        200,
      );
    }
    grantApplied = true;
  }

  return json(cors, {
    success: true,
    userId,
    pageId: page.id,
    slug: page.slug,
    theme: page.theme || theme,
    invited,
    planMode,
    grantApplied,
    message: invited
      ? `Wysłano zaproszenie na ${email}`
      : `Konto już istniało — dodano / użyto stronę ${slug}`,
  });
});
