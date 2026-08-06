// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildGeminiResponseSchema,
  mergeAiCopyPatch,
  applyAiGeneratedSectionFlags,
  THEME_TONE_HINTS,
} from "../_shared/aiCopySchemas.ts";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

const DEFAULT_MODEL = "gemini-3.6-flash";
const PROMPT_MAX = 1500;
const RATE_LIMIT_MS = 30_000;
const RATE_LIMIT_FIELD_MS = 6_000;
const GEMINI_TIMEOUT_MS = 45_000;
const ALLOWED_LOCALES = new Set(["pl", "en", "de"]);

/** Ścieżki pól dotrybu field (kreator / pojedyncze inputy). */
const FIELD_PATH_RE =
  /^(hero\.(headline|description|button|name)|manifesto\.(label|title|text)|nav\.logo|services\.\d+\.(title|desc|price|duration|details)|menu_items\.\d+\.(name|ingredients|price|category))$/;

const FIELD_LABELS: Record<string, string> = {
  "hero.headline": "główne hasło (nagłówek banera)",
  "hero.description": "krótki opis pod nagłówkiem",
  "hero.button": "tekst przycisku banera",
  "hero.name": "nazwa w banerze",
  "manifesto.label": "etykieta sekcji O nas",
  "manifesto.title": "tytuł sekcji O nas",
  "manifesto.text": "treść sekcji O nas",
  "nav.logo": "nazwa firmy w menu",
};

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

function buildCorsHeaders(req: Request) {
  return buildCorsHeadersForRequest(req, corsHeadersBase);
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

function buildSystemPrompt(theme: string, locale: string, mode: string): string {
  const tone = THEME_TONE_HINTS[theme] || "naturalny, lokalny, przekonujący";
  const langName =
    locale === "en" ? "angielski" : locale === "de" ? "niemiecki" : "polski";
  if (mode === "adapt") {
    return `Jesteś profesjonalnym lokalizatorem treści stron lokalnych firm (DFCMS).
Zaadaptuj podany JSON copy z języka źródłowego na język: ${langName} (kod: ${locale}), dla szablonu: ${theme}.

Zasady:
- Nie tłumacz słowo w słowo — lokalizuj pod rynek docelowy (CTA, SEO, naturalne frazy).
- Ton: ${tone}.
- Przetłumacz WSZYSTKIE pola tekstowe ze schematu: nagłówki sekcji, etykiety menu, FAQ, CTA rezerwacji, cytat stopki, SEO — nie pomijaj „małych” napisów.
- Zachowaj strukturę JSON (te same klucze); nie dodawaj pól spoza schematu.
- Nie zmyślaj telefonów/e-maili/adresów — zostaw puste "" jeśli źródło też ma puste; numery/emaile zostaw bez zmian gdy są wypełnione.
- Zwykły tekst — BEZ HTML, BEZ tagów, BEZ markdown.
- Zwróć wyłącznie JSON zgodny ze schematem.`;
  }
  if (mode === "field") {
    return `Jesteś copywriterem stron lokalnych firm (DFCMS).
Napisz JEDNO krótkie pole tekstowe w języku: ${langName} (kod: ${locale}), dla szablonu: ${theme}.

Zasady:
- Ton: ${tone}.
- Naturalny, konkretny tekst — bez korpo-mowy.
- Zwykły tekst — BEZ HTML, BEZ tagów, BEZ markdown.
- Nie zmyślaj telefonów, e-maili ani adresów.
- Zwróć wyłącznie JSON: { "value": "..." }.`;
  }
  return `Jesteś profesjonalnym copywriterem stron lokalnych firm (DFCMS).
Wygeneruj kompletny obiekt JSON z treściami marketingowymi w języku: ${langName} (kod: ${locale}), dla szablonu: ${theme}.

Zasady:
- Treść naturalna i perswazyjna — unikaj korpo-mowy i pustych fraz.
- Ton: ${tone}.
- Dostosuj copy do rynku lokalnego (miasto jeśli podane w opisie).
- Nie zmyślaj numerów telefonów, e-maili ani adresów — tylko gdy podane wprost; inaczej "".
- Nie generuj URL-i, obrazów ani ustawień technicznych.
- nav.logo = krótka nazwa firmy widoczna w górnym menu (np. „Studio Fit”). NIGDY nie wpisuj słów technicznych: meta, seo, html, json, shared, settings.
- seo.title / seo.description = wyłącznie pod Google (zakładka SEO w panelu) — nie myl z logo / nagłówkiem strony.
- Zwykły tekst we wszystkich polach — BEZ HTML, BEZ tagów, BEZ markdown.
- Zwróć wyłącznie JSON zgodny ze schematem odpowiedzi — bez dodatkowych kluczy.`;
}

function fieldPathLabel(path: string): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const svc = path.match(/^services\.(\d+)\.(title|desc|price|duration|details)$/);
  if (svc) {
    const map: Record<string, string> = {
      title: "nazwa usługi",
      desc: "opis usługi",
      price: "cena usługi",
      duration: "czas / zakres usługi",
      details: "szczegóły usługi",
    };
    return `${map[svc[2]] || svc[2]} (pozycja ${Number(svc[1]) + 1})`;
  }
  const menu = path.match(/^menu_items\.(\d+)\.(name|ingredients|price|category)$/);
  if (menu) {
    const map: Record<string, string> = {
      name: "nazwa dania",
      ingredients: "składniki / opis dania",
      price: "cena dania",
      category: "kategoria menu",
    };
    return `${map[menu[2]] || menu[2]} (pozycja ${Number(menu[1]) + 1})`;
  }
  return path;
}

function setByPath(root: Record<string, unknown>, path: string, value: string): boolean {
  const parts = path.split(".");
  let cur: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const nextIsIndex = /^\d+$/.test(nextKey);
    if (Array.isArray(cur)) {
      const idx = Number(key);
      if (!Number.isFinite(idx) || idx < 0) return false;
      if (!cur[idx] || typeof cur[idx] !== "object") {
        cur[idx] = nextIsIndex ? [] : {};
      }
      cur = cur[idx];
    } else if (cur && typeof cur === "object") {
      const obj = cur as Record<string, unknown>;
      if (!(key in obj) || obj[key] == null) {
        obj[key] = nextIsIndex ? [] : {};
      }
      cur = obj[key];
    } else {
      return false;
    }
  }
  const last = parts[parts.length - 1];
  if (Array.isArray(cur) && /^\d+$/.test(last)) {
    cur[Number(last)] = value;
    return true;
  }
  if (cur && typeof cur === "object" && !Array.isArray(cur)) {
    (cur as Record<string, unknown>)[last] = value;
    return true;
  }
  return false;
}

function businessContextFromLocale(block: Record<string, unknown>): string {
  const nav = block.nav as Record<string, unknown> | undefined;
  const hero = block.hero as Record<string, unknown> | undefined;
  const settings = block.settings as Record<string, unknown> | undefined;
  const bits = [
    nav?.logo,
    settings?.business_name,
    hero?.name,
    hero?.headline,
    hero?.description,
  ]
    .map((x) => String(x || "").replace(/<[^>]*>/g, "").trim())
    .filter(Boolean);
  return [...new Set(bits)].slice(0, 4).join(" · ");
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
    const themeRaw = typeof body?.theme === "string"
      ? body.theme.trim().toLowerCase()
      : "";
    let theme = themeRaw;
    const modeRaw = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : "generate";
    const mode = modeRaw === "adapt" || modeRaw === "field" ? modeRaw : "generate";
    const targetPath = typeof body?.targetPath === "string" ? body.targetPath.trim() : "";
    const localeRaw = typeof body?.locale === "string"
      ? body.locale.trim().toLowerCase()
      : "pl";
    const locale = ALLOWED_LOCALES.has(localeRaw) ? localeRaw : "pl";
    const sourceLocaleRaw = typeof body?.sourceLocale === "string"
      ? body.sourceLocale.trim().toLowerCase()
      : "pl";
    const sourceLocale = ALLOWED_LOCALES.has(sourceLocaleRaw)
      ? sourceLocaleRaw
      : "pl";
    pageIdLog = pageId;
    themeLog = theme;

    if (!Number.isFinite(pageId) || pageId < 1) {
      return errorResponse(cors, "INVALID_INPUT", 400, "Brak poprawnego pageId.");
    }
    if (mode === "field") {
      if (!FIELD_PATH_RE.test(targetPath)) {
        return errorResponse(
          cors,
          "INVALID_INPUT",
          400,
          "Nieprawidłowe pole do generacji AI.",
        );
      }
    } else if (mode === "generate") {
      if (!prompt || prompt.length < 10) {
        return errorResponse(
          cors,
          "INVALID_INPUT",
          400,
          "Opisz swój biznes w co najmniej kilku zdaniach (min. 10 znaków).",
        );
      }
    }
    if (prompt.length > PROMPT_MAX) {
      return errorResponse(
        cors,
        "INVALID_INPUT",
        400,
        `Opis jest za długi (max ${PROMPT_MAX} znaków).`,
      );
    }

    const responseSchema = mode === "field"
      ? {
        type: "OBJECT",
        properties: { value: { type: "STRING" } },
        required: ["value"],
        propertyOrdering: ["value"],
      }
      : buildGeminiResponseSchema(theme);
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
    const rateMs = mode === "field" ? RATE_LIMIT_FIELD_MS : RATE_LIMIT_MS;
    if (now - last < rateMs) {
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

    if (!theme) {
      theme = String(page.theme || "").trim().toLowerCase();
      themeLog = theme;
    }

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

    const existingDraft =
      page.draft_content && typeof page.draft_content === "object"
        ? page.draft_content as Record<string, unknown>
        : {};

    // Zapewnij meta.locales zawiera target (tylko pl/en/de — nigdy „meta” itd.)
    if (!existingDraft.meta || typeof existingDraft.meta !== "object") {
      existingDraft.meta = { defaultLocale: "pl", locales: ["pl"] };
    }
    const meta = existingDraft.meta as Record<string, unknown>;
    let localesList = Array.isArray(meta.locales)
      ? (meta.locales as unknown[])
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x) => ALLOWED_LOCALES.has(x))
      : ["pl"];
    if (!localesList.includes(locale)) localesList.push(locale);
    if (!localesList.includes("pl")) localesList.unshift("pl");
    // dedup
    localesList = [...new Set(localesList)];
    meta.locales = localesList;
    const defLoc = String(meta.defaultLocale || "pl").trim().toLowerCase();
    meta.defaultLocale = ALLOWED_LOCALES.has(defLoc) ? defLoc : "pl";
    // Usuń przypadkowe pola SEO-like na obiekcie meta (model / stare drafty).
    for (const junk of ["title", "description", "ogImage", "keywords"]) {
      if (junk in meta) delete meta[junk];
    }

    const existingPl =
      existingDraft.pl && typeof existingDraft.pl === "object"
        ? existingDraft.pl as Record<string, unknown>
        : {};
    const existingLocaleBlock =
      existingDraft[locale] && typeof existingDraft[locale] === "object"
        ? existingDraft[locale] as Record<string, unknown>
        : existingPl;

    const systemPrompt = buildSystemPrompt(theme, locale, mode);
    let userPrompt = "";
    if (mode === "adapt") {
      const srcBlock = existingDraft[sourceLocale];
      if (!srcBlock || typeof srcBlock !== "object") {
        return errorResponse(
          cors,
          "INVALID_INPUT",
          400,
          "Brak treści źródłowej do lokalizacji. Najpierw uzupełnij język podstawowy.",
        );
      }
      userPrompt =
        `Motyw: ${theme}\nZlocale: ${sourceLocale} → ${locale}\n` +
        (prompt ? `Dodatkowy kontekst od właściciela:\n${prompt}\n\n` : "") +
        `JSON źródłowy (zaadaptuj copy):\n${JSON.stringify(srcBlock).slice(0, 28000)}`;
    } else if (mode === "field") {
      const ctx = businessContextFromLocale(existingLocaleBlock) ||
        businessContextFromLocale(existingPl);
      userPrompt =
        `Motyw: ${theme}\nPole: ${fieldPathLabel(targetPath)} (${targetPath})\n` +
        (ctx ? `Kontekst firmy: ${ctx}\n` : "") +
        (prompt ? `Dodatkowa wskazówka: ${prompt}\n` : "") +
        `Napisz treść pola „value” (krótko, gotową do wklejenia w formularz).`;
    } else {
      userPrompt =
        `Motyw szablonu: ${theme}\nJęzyk docelowy: ${locale}\nOpis biznesu od właściciela:\n${prompt}`;
    }

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
          mode,
          targetPath: mode === "field" ? targetPath : undefined,
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
          mode,
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

    let nextDraft: Record<string, unknown>;
    let fieldValue: string | undefined;

    if (mode === "field") {
      const rawVal = typeof parsed.value === "string" ? parsed.value.trim() : "";
      if (!rawVal) return errorResponse(cors, "AI_BAD_RESPONSE", 502);
      // Twardy strip HTML — copy w polach formularza ma być plain text.
      fieldValue = rawVal.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      if (!fieldValue) return errorResponse(cors, "AI_BAD_RESPONSE", 502);
      const mergedLocale = JSON.parse(JSON.stringify(existingLocaleBlock)) as Record<
        string,
        unknown
      >;
      if (!setByPath(mergedLocale, targetPath, fieldValue)) {
        return errorResponse(cors, "INVALID_INPUT", 400, "Nie udało się zapisać wygenerowanego pola.");
      }
      nextDraft = {
        ...existingDraft,
        meta,
        [locale]: mergedLocale,
      };
      if (locale === "pl") nextDraft.pl = mergedLocale;
      else if (!nextDraft.pl) nextDraft.pl = existingPl;
    } else {
      const mergedLocale = mergeAiCopyPatch(existingLocaleBlock, parsed, theme);
      for (const junk of ["meta", "shared"]) {
        if (junk in mergedLocale) delete mergedLocale[junk];
      }
      applyAiGeneratedSectionFlags(mergedLocale, theme);
      nextDraft = {
        ...existingDraft,
        meta,
        [locale]: mergedLocale,
      };
      if (locale === "pl") {
        nextDraft.pl = mergedLocale;
      } else if (!nextDraft.pl) {
        nextDraft.pl = existingPl;
      }
    }

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
      value: fieldValue,
      targetPath: mode === "field" ? targetPath : undefined,
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
