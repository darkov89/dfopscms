// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildGeminiResponseSchema,
  mergeAiCopyPatch,
  THEME_TONE_HINTS,
} from "../_shared/aiCopySchemas.ts";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

const DEFAULT_MODEL = "gemini-3.6-flash";
const PROMPT_MAX = 1500;
const RATE_LIMIT_MS = 30_000;
const GEMINI_TIMEOUT_MS = 45_000;

const corsHeadersBase: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Soft rate limit per isolate (userId → last call ms). */
const lastCallByUser = new Map<string, number>();

type ErrorCode =
  | "UNAUTHORIZED"
  | "PLAN_REQUIRED"
  | "FORBIDDEN"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "AI_UNAVAILABLE"
  | "AI_BAD_RESPONSE"
  | "INTERNAL";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: "Musisz być zalogowany, żeby wygenerować treść.",
  PLAN_REQUIRED:
    "Generator AI jest dostępny na planach Starter i Standard. Wybierz pakiet w Subskrypcji.",
  FORBIDDEN: "Nie masz uprawnień do tej strony.",
  QUOTA_EXCEEDED:
    "Wykorzystałeś limit generacji AI w tym miesiącu. Spróbuj ponownie w kolejnym miesiącu.",
  RATE_LIMITED: "Odczekaj chwilę przed kolejną generacją (ok. 30 sekund).",
  INVALID_INPUT: "Nieprawidłowe dane wejściowe. Sprawdź opis biznesu i motyw.",
  AI_UNAVAILABLE:
    "Usługa AI jest chwilowo niedostępna. Spróbuj ponownie za kilka minut.",
  AI_BAD_RESPONSE:
    "AI zwróciło niepoprawną odpowiedź. Spróbuj krótszego lub jaśniejszego opisu.",
  INTERNAL: "Wystąpił błąd serwera. Spróbuj ponownie.",
};

function isAllowedOrigin(origin: string) {
  const o = origin.trim();
  if (o === "https://dfcms.pl") return true;
  if (o === "http://localhost:5500") return true;
  try {
    const u = new URL(o);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h.endsWith(".dfcms.pl")) return true;
    if (h.endsWith(".pages.dev")) return true;
    if (h === "localhost" || h === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  if (!origin || !isAllowedOrigin(origin)) return null;
  return {
    ...corsHeadersBase,
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  } as Record<string, string>;
}

function jsonResponse(
  cors: Record<string, string>,
  body: unknown,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(
  cors: Record<string, string>,
  code: ErrorCode,
  status: number,
  messageOverride?: string,
) {
  return jsonResponse(
    cors,
    {
      success: false,
      code,
      message: messageOverride || ERROR_MESSAGES[code],
    },
    status,
  );
}

function normalizePlan(plan: unknown): string {
  const raw =
    plan && String(plan).trim() !== "" ? String(plan).trim() : "trial";
  if (raw === "tier2" || raw === "premium") return "tier1";
  return raw;
}

function planAllowsAi(plan: string): boolean {
  const p = normalizePlan(plan);
  return p === "tier0" || p === "tier1" || p === "tier_custom" || p === "custom";
}

function aiMonthlyLimit(plan: string): number {
  const p = normalizePlan(plan);
  if (p === "tier0") return 10;
  if (p === "tier1" || p === "tier_custom" || p === "custom") return 20;
  return 0;
}

function currentYearMonth(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function isStagingLogging(): boolean {
  const env = (Deno.env.get("DFCMS_ENV") || "").trim().toLowerCase();
  if (env === "production" || env === "prod") {
    return Deno.env.get("AI_LOG_PROMPTS") === "1";
  }
  if (Deno.env.get("AI_LOG_PROMPTS") === "1") return true;
  // Brak markera prod → traktuj jak staging (bezpieczniejsze logi jakości).
  return env !== "production" && env !== "prod";
}

function buildSystemPrompt(theme: string): string {
  const tone = THEME_TONE_HINTS[theme] || "naturalny, lokalny, przekonujący";
  return `Jesteś profesjonalnym copywriterem stron lokalnych firm w Polsce (DFCMS).
Twoim zadaniem jest wygenerowanie kompletnego obiektu JSON z treściami marketingowymi dla szablonu: ${theme}.

Zasady:
- Treść wyłącznie po polsku, naturalna i perswazyjna — unikaj korpo-mowy i pustych fraz („kompleksowe rozwiązania”, „pasja do…”, „innowacyjne podejście”).
- Ton: ${tone}.
- Dostosuj copy do polskiego rynku lokalnego (miasto/dzielnica jeśli podane w opisie).
- Nie zmyślaj numerów telefonów, e-maili ani adresów — wypełnij je tylko gdy użytkownik podał je wprost w opisie; w przeciwnym razie zostaw puste stringi "".
- Nie generuj URL-i, obrazów ani ustawień technicznych — tylko pola tekstowe ze schematu JSON.
- W headline możesz użyć prostych tagów HTML tylko gdy pasują do motywu: <span>, <br />, <i>, <em> — bez atrybutów class/style i bez skryptów.
- FAQ: 4–6 praktycznych pytań; usługi/menu: konkretne, z sensownymi cenami tylko gdy pasują do branży.
- seo.title i seo.description: pod SEO lokalne, bez keyword-stuffingu.

Zwróć wyłącznie JSON zgodny ze schematem odpowiedzi.`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  responseSchema: Record<string, unknown>,
): Promise<{ ok: true; text: string; raw: unknown; finishReason: string } | {
  ok: false;
  retryable: boolean;
  status: number;
  detail: string;
}> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${
      encodeURIComponent(model)
    }:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.85,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });
    const rawText = await resp.text();
    let rawJson: unknown = null;
    try {
      rawJson = JSON.parse(rawText);
    } catch {
      rawJson = { rawText };
    }
    if (!resp.ok) {
      const retryable = resp.status >= 500 || resp.status === 429;
      return {
        ok: false,
        retryable,
        status: resp.status,
        detail: rawText.slice(0, 800),
      };
    }
    const candidates = (rawJson as {
      candidates?: Array<{
        finishReason?: string;
        content?: { parts?: Array<{ text?: string }> };
      }>;
    })?.candidates;
    const text = candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ||
      "";
    const finishReason = candidates?.[0]?.finishReason || "";
    if (!text.trim()) {
      return {
        ok: false,
        retryable: false,
        status: 502,
        detail: "empty candidates",
      };
    }
    return { ok: true, text, raw: rawJson, finishReason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = /abort/i.test(msg);
    return {
      ok: false,
      retryable: true,
      status: aborted ? 504 : 502,
      detail: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiWithRetry(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  responseSchema: Record<string, unknown>,
) {
  const first = await callGeminiOnce(
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    responseSchema,
  );
  if (first.ok) return first;
  if (!first.retryable) return first;
  await sleep(800);
  return await callGeminiOnce(
    apiKey,
    model,
    systemPrompt,
    userPrompt,
    responseSchema,
  );
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
    return errorResponse(cors, "INVALID_INPUT", 405, "Dozwolona tylko metoda POST.");
  }

  const started = Date.now();
  let pageIdLog: unknown = null;
  let themeLog = "";
  let modelLog = DEFAULT_MODEL;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse(cors, "UNAUTHORIZED", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    modelLog = (Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL).trim() ||
      DEFAULT_MODEL;

    if (!serviceRole) {
      console.error("[generate-ai-content] missing SERVICE_ROLE");
      return errorResponse(cors, "INTERNAL", 500);
    }
    if (!geminiKey) {
      console.error("[generate-ai-content] missing GEMINI_API_KEY");
      return errorResponse(cors, "AI_UNAVAILABLE", 502, "Brak konfiguracji AI na serwerze.");
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseAuth.auth.getUser();
    if (userErr || !user?.id) return errorResponse(cors, "UNAUTHORIZED", 401);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));
    const pageIdRaw = body?.pageId;
    const pageId = typeof pageIdRaw === "number"
      ? pageIdRaw
      : Number(pageIdRaw);
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const theme = typeof body?.theme === "string"
      ? body.theme.trim().toLowerCase()
      : "";
    pageIdLog = pageId;
    themeLog = theme;

    if (!Number.isFinite(pageId) || pageId < 1) {
      return errorResponse(cors, "INVALID_INPUT", 400, "Brak poprawnego pageId.");
    }
    if (!prompt || prompt.length < 10) {
      return errorResponse(
        cors,
        "INVALID_INPUT",
        400,
        "Opisz swój biznes w co najmniej kilku zdaniach (min. 10 znaków).",
      );
    }
    if (prompt.length > PROMPT_MAX) {
      return errorResponse(
        cors,
        "INVALID_INPUT",
        400,
        `Opis jest za długi (max ${PROMPT_MAX} znaków).`,
      );
    }

    const responseSchema = buildGeminiResponseSchema(theme);
    if (!responseSchema) {
      return errorResponse(
        cors,
        "INVALID_INPUT",
        400,
        "Nieobsługiwany motyw szablonu.",
      );
    }

    const now = Date.now();
    const last = lastCallByUser.get(userId) || 0;
    if (now - last < RATE_LIMIT_MS) {
      return errorResponse(cors, "RATE_LIMITED", 429);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: superRow } = await supabaseAdmin
      .from("superadmins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    const isGod = !!superRow?.user_id;

    const { data: page, error: pageErr } = await supabaseAdmin
      .from("pages")
      .select("id, user_id, theme, draft_content, billing_plan")
      .eq("id", pageId)
      .maybeSingle();

    if (pageErr) {
      console.error("[generate-ai-content] page lookup", pageErr.message);
      return errorResponse(cors, "INTERNAL", 500);
    }
    if (!page) return errorResponse(cors, "FORBIDDEN", 403);

    const ownerId = page.user_id as string;
    if (!isGod && ownerId !== userId) {
      return errorResponse(cors, "FORBIDDEN", 403);
    }

    const { data: profile } = await supabaseAdmin
      .from("billing_profiles")
      .select("id, user_id, plan, ai_gen_month, ai_gen_count")
      .eq("user_id", ownerId)
      .maybeSingle();

    const planFromProfile = normalizePlan(profile?.plan);
    const planFromPage = normalizePlan(page.billing_plan);
    const effectivePlan =
      planFromProfile && planFromProfile !== "trial"
        ? planFromProfile
        : planFromPage;

    if (!isGod && !planAllowsAi(effectivePlan)) {
      return errorResponse(cors, "PLAN_REQUIRED", 403);
    }

    const limit = isGod ? 9999 : aiMonthlyLimit(effectivePlan);
    const ym = currentYearMonth();
    let count = typeof profile?.ai_gen_count === "number" ? profile.ai_gen_count : 0;
    const month = typeof profile?.ai_gen_month === "string" ? profile.ai_gen_month : "";
    if (month !== ym) count = 0;

    if (!isGod && count >= limit) {
      return errorResponse(cors, "QUOTA_EXCEEDED", 429);
    }

    lastCallByUser.set(userId, now);

    const systemPrompt = buildSystemPrompt(theme);
    const userPrompt =
      `Motyw szablonu: ${theme}\nOpis biznesu od właściciela:\n${prompt}`;

    const gemini = await callGeminiWithRetry(
      geminiKey,
      modelLog,
      systemPrompt,
      userPrompt,
      responseSchema,
    );

    if (isStagingLogging()) {
      console.log(
        JSON.stringify({
          scope: "generate-ai-content",
          pageId,
          theme,
          model: modelLog,
          prompt,
          geminiOk: gemini.ok,
          finishReason: gemini.ok ? gemini.finishReason : undefined,
          raw: gemini.ok
            ? String(gemini.text).slice(0, 12000)
            : gemini.detail?.slice(0, 2000),
          latencyMs: Date.now() - started,
        }),
      );
    } else {
      console.log(
        JSON.stringify({
          scope: "generate-ai-content",
          pageId,
          theme,
          model: modelLog,
          ok: gemini.ok,
          code: gemini.ok ? "OK" : "AI_FAIL",
          latencyMs: Date.now() - started,
        }),
      );
    }

    if (!gemini.ok) {
      return errorResponse(cors, "AI_UNAVAILABLE", gemini.status >= 500 ? gemini.status : 502);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(gemini.text) as Record<string, unknown>;
    } catch {
      return errorResponse(cors, "AI_BAD_RESPONSE", 502);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return errorResponse(cors, "AI_BAD_RESPONSE", 502);
    }

    const existingDraft =
      page.draft_content && typeof page.draft_content === "object"
        ? page.draft_content as Record<string, unknown>
        : {};
    const existingPl =
      existingDraft.pl && typeof existingDraft.pl === "object"
        ? existingDraft.pl as Record<string, unknown>
        : {};

    const mergedPl = mergeAiCopyPatch(existingPl, parsed, theme);
    const nextDraft = { ...existingDraft, pl: mergedPl };

    const { error: updErr } = await supabaseAdmin
      .from("pages")
      .update({ draft_content: nextDraft })
      .eq("id", pageId);

    if (updErr) {
      console.error("[generate-ai-content] draft update", updErr.message);
      return errorResponse(cors, "INTERNAL", 500);
    }

    let remaining = limit;
    if (!isGod) {
      const nextCount = count + 1;
      remaining = Math.max(0, limit - nextCount);
      if (profile?.user_id) {
        const { error: qErr } = await supabaseAdmin
          .from("billing_profiles")
          .update({ ai_gen_month: ym, ai_gen_count: nextCount })
          .eq("user_id", ownerId);
        if (qErr) {
          console.warn("[generate-ai-content] quota update", qErr.message);
        }
      } else {
        // Brak wiersza billing_profiles (np. custom) — utwórz minimalny profil z licznikiem.
        const { error: insErr } = await supabaseAdmin.from("billing_profiles").upsert(
          {
            user_id: ownerId,
            plan: effectivePlan === "trial" ? null : effectivePlan,
            ai_gen_month: ym,
            ai_gen_count: nextCount,
          },
          { onConflict: "user_id" },
        );
        if (insErr) {
          console.warn("[generate-ai-content] quota upsert", insErr.message);
        }
      }
    }

    return jsonResponse(cors, {
      success: true,
      draft_content: nextDraft,
      remaining,
      limit: isGod ? null : limit,
    });
  } catch (e) {
    console.error("[generate-ai-content] unhandled", e, {
      pageId: pageIdLog,
      theme: themeLog,
      model: modelLog,
    });
    return errorResponse(cors, "INTERNAL", 500);
  }
});
