// @ts-ignore - remote Deno std module
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";
import { requireSuperadmin } from "../_shared/godAuth.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const PUBLISHED_THEMES = new Set([
  "beauty",
  "consultant",
  "fitness",
  "services",
  "gastro",
  "care",
]);

/** Katalog landingowy — nie kasować z God Mode. */
const PROTECTED_DEMO_SLUGS = new Set([
  "demo-beauty",
  "demo-fitness",
  "demo-services",
  "demo-gastro",
  "demo-care",
  "demo-consultant",
]);

const DEMO_SLUG_RE = /^demo-[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function normalizeDemoSlug(raw: string): string {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  if (!s.startsWith("demo-")) s = `demo-${s}`;
  return s;
}

function markDemoCatalog(content: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(content || {})) as Record<string, unknown>;
  if (!out.pl || typeof out.pl !== "object") out.pl = {};
  const pl = out.pl as Record<string, unknown>;
  if (!pl.settings || typeof pl.settings !== "object") pl.settings = {};
  const settings = pl.settings as Record<string, unknown>;
  settings.is_demo_catalog = true;
  // Brak trialu — demo nie jest subskrypcją klienta.
  if (!settings.subscription || typeof settings.subscription !== "object") {
    settings.subscription = {};
  }
  const sub = settings.subscription as Record<string, unknown>;
  sub.plan = "demo";
  sub.selected_plan = null;
  delete sub.trial_started_at;
  delete sub.payment_completed;
  return out;
}

function minimalDemoContent(theme: string): Record<string, unknown> {
  return markDemoCatalog({
    pl: {
      settings: {
        theme,
        template_version: 3,
        color_preset: "gold",
        is_demo_catalog: true,
        welcome_onboarding_completed: true,
        onboarding_completed: true,
        showServices: true,
        showContact: true,
        subscription: { plan: "demo", selected_plan: null },
      },
      nav: { logo: "Demo DFCMS" },
      hero: {
        name: "Demo",
        title: "Strona demonstracyjna",
        subtitle: "Podgląd szablonu dla klienta — bez subskrypcji.",
        cta: "Umów wizytę",
      },
      contact: { phone: "", email: "", address: "" },
    },
  });
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
    typeof body.action === "string" ? body.action.trim().toLowerCase() : "create";

  if (action === "delete") {
    const slug = normalizeDemoSlug(
      typeof body.slug === "string" ? body.slug : "",
    );
    const confirmSlug = normalizeDemoSlug(
      typeof body.confirmSlug === "string"
        ? body.confirmSlug
        : typeof body.confirm_slug === "string"
        ? body.confirm_slug
        : "",
    );

    if (!slug || !DEMO_SLUG_RE.test(slug)) {
      return json(
        cors,
        { success: false, error: "Nieprawidłowy slug demo (oczekiwano demo-…)", code: "INVALID_INPUT" },
        400,
      );
    }
    if (PROTECTED_DEMO_SLUGS.has(slug)) {
      return json(
        cors,
        {
          success: false,
          error:
            "Tego dema katalogowego (landing) nie można usunąć z God Mode. Usuwaj tylko własne dema klientów.",
          code: "PROTECTED_DEMO",
        },
        403,
      );
    }
    if (!confirmSlug || confirmSlug !== slug) {
      return json(
        cors,
        {
          success: false,
          error: `Aby usunąć, wpisz dokładnie slug: ${slug}`,
          code: "CONFIRM_REQUIRED",
        },
        400,
      );
    }

    const { data: row, error: selErr } = await auth.supabaseAdmin
      .from("pages")
      .select("id, slug, user_id, content")
      .eq("slug", slug)
      .maybeSingle();
    if (selErr) {
      console.error("god-manage-demo select", selErr.message);
      return json(cors, { success: false, error: "Błąd odczytu strony", code: "INTERNAL" }, 500);
    }
    if (!row?.id) {
      return json(cors, { success: false, error: "Nie znaleziono strony", code: "NOT_FOUND" }, 404);
    }
    if (row.user_id) {
      return json(
        cors,
        {
          success: false,
          error:
            "To nie jest demo katalogowe (ma właściciela Auth). Usuwanie kont klientów nie jest tu dostępne.",
          code: "NOT_DEMO",
        },
        403,
      );
    }
    const isDemoFlag =
      (row.content as { pl?: { settings?: { is_demo_catalog?: boolean } } } | null)
        ?.pl?.settings?.is_demo_catalog === true;
    if (!isDemoFlag && !slug.startsWith("demo-")) {
      return json(
        cors,
        { success: false, error: "Strona nie jest oznaczona jako demo.", code: "NOT_DEMO" },
        403,
      );
    }

    const { error: delErr } = await auth.supabaseAdmin
      .from("pages")
      .delete()
      .eq("id", row.id);
    if (delErr) {
      console.error("god-manage-demo delete", delErr.message);
      return json(
        cors,
        { success: false, error: delErr.message || "Nie udało się usunąć", code: "DELETE_FAILED" },
        500,
      );
    }

    return json(cors, {
      success: true,
      action: "delete",
      slug,
      message: `Usunięto demo ${slug}`,
    });
  }

  // —— create ——
  const theme =
    typeof body.theme === "string" ? body.theme.trim().toLowerCase() : "";
  const slug = normalizeDemoSlug(
    typeof body.slug === "string" ? body.slug : "",
  );

  if (!theme || !PUBLISHED_THEMES.has(theme)) {
    return json(
      cors,
      { success: false, error: "Wybierz opublikowany motyw", code: "INVALID_INPUT" },
      400,
    );
  }
  if (!slug || !DEMO_SLUG_RE.test(slug)) {
    return json(
      cors,
      {
        success: false,
        error: "Slug: małe litery/cyfry/myślniki; automatyczny prefix demo-",
        code: "INVALID_INPUT",
      },
      400,
    );
  }
  if (PROTECTED_DEMO_SLUGS.has(slug)) {
    return json(
      cors,
      {
        success: false,
        error: "Ten slug jest zarezerwowany dla dema katalogowego na landingu.",
        code: "SLUG_RESERVED",
      },
      409,
    );
  }

  const { data: existing } = await auth.supabaseAdmin
    .from("pages")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing?.id) {
    return json(
      cors,
      { success: false, error: "Slug jest już zajęty", code: "SLUG_TAKEN" },
      409,
    );
  }

  // Skopiuj treść z katalogowego demo-{theme}, jeśli jest.
  const catalogSlug = `demo-${theme}`;
  const { data: catalog } = await auth.supabaseAdmin
    .from("pages")
    .select("content, draft_content, color_preset, theme")
    .eq("slug", catalogSlug)
    .maybeSingle();

  let content: Record<string, unknown>;
  let draft: Record<string, unknown>;
  let colorPreset = "gold";

  if (catalog?.content && typeof catalog.content === "object") {
    content = markDemoCatalog(catalog.content as Record<string, unknown>);
    draft =
      catalog.draft_content && typeof catalog.draft_content === "object"
        ? markDemoCatalog(catalog.draft_content as Record<string, unknown>)
        : JSON.parse(JSON.stringify(content));
    if (typeof catalog.color_preset === "string" && catalog.color_preset.trim()) {
      colorPreset = catalog.color_preset.trim();
    }
  } else {
    content = minimalDemoContent(theme);
    draft = JSON.parse(JSON.stringify(content));
  }

  // Ustaw theme w settings
  const pl = content.pl as Record<string, unknown>;
  const settings = pl.settings as Record<string, unknown>;
  settings.theme = theme;

  const { data: inserted, error: insErr } = await auth.supabaseAdmin
    .from("pages")
    .insert({
      user_id: null,
      slug,
      theme,
      color_preset: colorPreset,
      content,
      draft_content: draft,
      billing_plan: "tier1",
      trial_blocked_at: null,
      billing_failed_at: null,
    })
    .select("id, slug, theme, billing_plan")
    .maybeSingle();

  if (insErr || !inserted) {
    console.error("god-manage-demo insert", insErr?.message);
    return json(
      cors,
      {
        success: false,
        error: insErr?.message || "Nie udało się utworzyć demo",
        code: "CREATE_FAILED",
      },
      500,
    );
  }

  return json(cors, {
    success: true,
    action: "create",
    pageId: inserted.id,
    slug: inserted.slug,
    theme: inserted.theme,
    billing_plan: inserted.billing_plan,
    message: `Utworzono demo ${inserted.slug} (bez konta / bez subskrypcji). Podgląd: /router.html?site=${inserted.slug}`,
  });
});
