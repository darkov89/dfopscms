// @ts-ignore - remote Deno std module
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";
import { requireSuperadmin } from "../_shared/godAuth.ts";
import {
  applyManualGrantToUser,
  normalizeStripePaidTier,
  revokeManualGrant,
  type StripePaidTier,
} from "../_shared/stripeBilling.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

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

async function resolveUserId(
  supabaseAdmin: ReturnType<typeof requireSuperadmin> extends Promise<infer R>
    ? R extends { ok: true; supabaseAdmin: infer S } ? S : never
    : never,
  body: Record<string, unknown>,
): Promise<{ userId: string } | { error: string }> {
  const userIdRaw = typeof body.userId === "string" ? body.userId.trim() : "";
  if (userIdRaw) return { userId: userIdRaw };

  const slug =
    typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  if (!slug) return { error: "Podaj userId lub slug strony" };

  const { data, error } = await supabaseAdmin
    .from("pages")
    .select("user_id")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("god-grant-subscription page lookup", error.message);
    return { error: "Nie udało się odczytać strony" };
  }
  if (!data?.user_id) return { error: "Nie znaleziono strony o podanym slugu" };
  return { userId: String(data.user_id) };
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
  const action =
    typeof body.action === "string" ? body.action.trim().toLowerCase() : "grant";

  const resolved = await resolveUserId(auth.supabaseAdmin, body);
  if ("error" in resolved) {
    return json(cors, { success: false, error: resolved.error, code: "INVALID_INPUT" }, 400);
  }

  if (action === "revoke") {
    const result = await revokeManualGrant(auth.supabaseAdmin, resolved.userId);
    if (!result.ok) {
      const status = result.code === "HAS_STRIPE_SUBSCRIPTION" ? 409 : 400;
      return json(
        cors,
        { success: false, error: result.error, code: result.code },
        status,
      );
    }
    return json(cors, { success: true, action: "revoke", userId: resolved.userId });
  }

  const planRaw = typeof body.plan === "string" ? body.plan.trim().toLowerCase() : "";
  let plan: StripePaidTier;
  try {
    if (planRaw === "tier0" || planRaw === "starter") plan = "tier0";
    else if (
      planRaw === "tier1" ||
      planRaw === "standard" ||
      planRaw === "pro"
    ) {
      plan = "tier1";
    } else {
      return json(
        cors,
        { success: false, error: "Plan: starter/tier0 lub standard/tier1", code: "INVALID_INPUT" },
        400,
      );
    }
    plan = normalizeStripePaidTier(plan);
  } catch {
    return json(cors, { success: false, error: "Nieprawidłowy plan", code: "INVALID_INPUT" }, 400);
  }

  const expiresAt =
    typeof body.expiresAt === "string"
      ? body.expiresAt.trim()
      : typeof body.expires_at === "string"
      ? body.expires_at.trim()
      : "";
  if (!expiresAt) {
    return json(
      cors,
      { success: false, error: "Wymagana data ważności (expiresAt)", code: "INVALID_INPUT" },
      400,
    );
  }

  const result = await applyManualGrantToUser(auth.supabaseAdmin, {
    userId: resolved.userId,
    plan,
    expiresAtIso: expiresAt,
  });
  if (!result.ok) {
    const status = result.code === "HAS_STRIPE_SUBSCRIPTION" ? 409 : 400;
    return json(
      cors,
      { success: false, error: result.error, code: result.code },
      status,
    );
  }

  return json(cors, {
    success: true,
    action: "grant",
    userId: resolved.userId,
    plan,
    expiresAt,
  });
});
