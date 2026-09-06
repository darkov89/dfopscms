// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 40_000;
const RATE_LIMIT_MS = 30_000;

/** Soft rate limit per isolate (userId -> last call timestamp ms) */
const lastCallByUser = new Map<string, number>();

const corsHeadersBase: Record<string, string> = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function buildCorsHeaders(req: Request) {
  return buildCorsHeadersForRequest(req, corsHeadersBase);
}

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

function normalizePlan(plan: unknown): string {
  const raw = plan && String(plan).trim() !== "" ? String(plan).trim() : "trial";
  if (raw === "tier2" || raw === "premium") return "tier1";
  return raw;
}

function getAiMonthlyLimit(plan: string): number {
  const p = normalizePlan(plan);
  if (p === "tier0") return 30;
  if (p === "tier1" || p === "tier_custom" || p === "custom") return 100;
  return 15; // 15 requests per month for 14-day trial
}

function currentYearMonth(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// Domyślne dane dla wszystkich obsługiwanych typów bloków (zgodne z customBlocksRegistry.js)
const BLOCK_DEFAULTS: Record<string, Record<string, any>> = {
  cinematic_hero: {
    title: "Twórca Filmowy",
    subtitle: "Director & Cinematographer",
    tagline: "Historie opowiadane światłem i ruchem.",
    video_url: "https://vimeo.com/76979871",
    video_provider: "vimeo",
    video_id: "76979871",
    showreel_url: "https://vimeo.com/76979871",
    cta_text: "Odtwórz Showreel",
    cta_secondary_text: "Zobacz Projekty",
    cta_secondary_target: "#projekty",
  },
  projects_grid: {
    heading: "Wybrane Realizacje",
    subheading: "Reklama · Teledyski · Formy Fabularne",
    items: [
      {
        id: "p1",
        title: "Spot Komercyjny — Nowa Fala",
        category: "Commercial",
        role: "Reżyseria / Zdjęcia",
        video_url: "https://vimeo.com/76979871",
        thumbnail: "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=800&q=80",
      },
      {
        id: "p2",
        title: "Teledysk — Nocny Kurs",
        category: "Music Video",
        role: "Director of Photography",
        video_url: "https://vimeo.com/76979871",
        thumbnail: "https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&w=800&q=80",
      },
    ],
  },
  awards_strip: {
    heading: "Wyróżnienia & Festiwale",
    items: [
      { name: "Camerimage 2025", desc: "Oficjalna selekcja" },
      { name: "Fryderyk 2024", desc: "Nominacja — Teledysk Roku" },
      { name: "Grand Video Awards", desc: "Nagroda Główna w kategorii Branded Content" },
    ],
  },
  director_statement: {
    heading: "Podejście i Wizja",
    quote: "Kino to dla mnie przede wszystkim rytm, kontrast i autentyczność.",
    text: "Od ponad 8 lat realizuję projekty wideo dla czołowych marek i artystów w Polsce i za granicą. Łączę rzemiosło operatorskie z narracją fabularną.",
    signature: "Jan Kowalski",
  },
  minimal_contact: {
    heading: "Porozmawiajmy o projekcie",
    subheading: "Dostępność: realizacje komercyjne, teledyski, etiudy i filmy dokumentalne.",
    phone: "+48 600 700 800",
    email: "kontakt@tworcafilmowy.pl",
    instagram: "https://instagram.com/",
    vimeo: "https://vimeo.com/",
    location: "Warszawa · Dostępny na całym świecie",
  },
  quick_hero: {
    badge: "Dostępny od zaraz",
    title: "Usługi Elektryczne — Szybko i Solidnie",
    subtitle: "Kompleksowe instalacje, pomiary i usuwanie awarii.",
    city: "Poznań i okolice",
    phone: "+48 600 700 800",
    whatsapp: "+48600700800",
    cta_primary_text: "Zadzwoń teraz",
    cta_secondary_text: "Napisz na WhatsApp",
  },
  key_features: {
    heading: "Dlaczego warto?",
    items: [
      {
        title: "Ekspresowy dojazd",
        desc: "W nagłych awariach jesteśmy na miejscu w 60 minut.",
        icon: "bolt",
      },
      {
        title: "Uprawnienia SEP",
        desc: "Pełne uprawnienia dozoru i eksploatacji, protokoły do ubezpieczenia.",
        icon: "check",
      },
      {
        title: "Gwarancja i faktura",
        desc: "Darmowa wycena przed rozpoczęciem prac, faktury VAT 23%.",
        icon: "shield",
      },
    ],
  },
  quick_contact_card: {
    heading: "Skontaktuj się bezpośrednio",
    company_name: "Elektro-Fach Poznań",
    address: "ul. Dąbrowskiego 45",
    city: "60-842 Poznań",
    phone: "+48 600 700 800",
    email: "kontakt@elektrofach.pl",
    hours: "Poniedziałek – Sobota: 7:00 – 21:00\nPogotowie awaryjne: 24/7",
    booking_url: "",
  },
  faq_simple: {
    heading: "Często zadawane pytania",
    items: [
      { question: "Jak szybko możecie przyjechać?", answer: "W przypadku awarii zazwyczaj dojeżdżamy w ciągu 45-60 minut." },
      { question: "Czy wycena jest płatna?", answer: "Wstępna wycena telefoniczna jest całkowicie bezpłatna." },
    ],
  },
};

// Definicje narzędzi Gemini (Function Calling)
const AGENT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "update_block_data",
        description: "Aktualizuje jedno lub więcej konkretnych pól w istniejącym bloku (np. telefon, nagłówek, link wideo, treść bio, email). Używaj zawsze, gdy użytkownik chce zmienić tekst lub wartość bez usuwania sekcji.",
        parameters: {
          type: "OBJECT",
          properties: {
            blockId: { type: "STRING", description: "Identyfikator bloku (np. hero_cinematic, projects_grid, contact_1)" },
            path: { type: "STRING", description: "Ścieżka do pola w danych bloku (np. phone, title, subtitle, video_url, showreel_url, tagline, email, city)" },
            value: { type: "STRING", description: "Nowa wartość tekstowa lub URL" },
          },
          required: ["blockId", "path", "value"],
        },
      },
      {
        name: "add_block",
        description: "Wstawia nowy blok na stronę. Dostępne typy bloków: cinematic_hero, projects_grid, awards_strip, director_statement, minimal_contact, quick_hero, key_features, quick_contact_card, faq_simple.",
        parameters: {
          type: "OBJECT",
          properties: {
            blockType: {
              type: "STRING",
              description: "Typ bloku do wstawienia (np. awards_strip, projects_grid, faq_simple)",
            },
            afterBlockId: {
              type: "STRING",
              description: "Opcjonalne ID bloku, po którym nowy blok ma zostać wstawiony. Jeśli puste, blok trafi na koniec.",
            },
            heading: { type: "STRING", description: "Tytuł/nagłówek nowo dodawanej sekcji" },
          },
          required: ["blockType"],
        },
      },
      {
        name: "remove_block",
        description: "Usuwa wskazany blok ze strony. Używaj wyłącznie, gdy użytkownik wyraźnie poprosi o usunięcie lub schowanie sekcji.",
        parameters: {
          type: "OBJECT",
          properties: {
            blockId: { type: "STRING", description: "ID bloku do usunięcia" },
          },
          required: ["blockId"],
        },
      },
      {
        name: "update_design",
        description: "Aktualizuje kolorystykę i styl wizualny strony.",
        parameters: {
          type: "OBJECT",
          properties: {
            palette: { type: "STRING", description: "Nazwa palety (np. dark_gold, dark_silver, clean_light)" },
            accentColor: { type: "STRING", description: "Kod koloru akcentu (np. #D4AF37, #ef4444, #10b981)" },
          },
        },
      },
    ],
  },
];

function isSafeUrl(val: string): boolean {
  if (!val || typeof val !== "string") return true;
  const s = val.trim().toLowerCase();
  if (s.startsWith("javascript:") || s.startsWith("data:") || s.startsWith("vbscript:")) {
    return false;
  }
  return true;
}

function sanitizeUrl(val: string): string {
  if (!isSafeUrl(val)) return "#";
  return val.trim();
}

function setDeepValue(obj: Record<string, unknown>, path: string, value: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const cleanPath = String(path || "").trim();
  if (!/^[a-zA-Z0-9_.]+$/.test(cleanPath)) return false;

  const parts = cleanPath.split(".");
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (p === "__proto__" || p === "constructor" || p === "prototype") return false;
    if (!(p in cur) || cur[p] == null || typeof cur[p] !== "object") {
      cur[p] = {};
    }
    cur = cur[p];
  }

  const last = parts[parts.length - 1];
  if (last === "__proto__" || last === "constructor" || last === "prototype") return false;

  // Sanityzacja pól URL
  if (
    typeof value === "string" &&
    (last.endsWith("_url") || last === "instagram" || last === "vimeo" || last === "thumbnail" || last === "booking_url")
  ) {
    cur[last] = sanitizeUrl(value);
  } else {
    cur[last] = value;
  }
  return true;
}

function extractVideoMeta(url: string) {
  const clean = String(url || "").trim();
  const vimeo = clean.match(/(?:vimeo\.com\/|player\.vimeo\.com\/video\/)(\d+)/);
  if (vimeo) {
    return {
      provider: "vimeo",
      id: vimeo[1],
      embedUrl: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1&dnt=1&title=0&byline=0&portrait=0`,
      loopUrl: `https://player.vimeo.com/video/${vimeo[1]}?background=1&autoplay=1&loop=1&byline=0&title=0&muted=1&dnt=1`,
    };
  }
  const yt = clean.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) {
    return {
      provider: "youtube",
      id: yt[1],
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0`,
      loopUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&mute=1&loop=1&playlist=${yt[1]}&controls=0&showinfo=0`,
    };
  }
  return { provider: "direct", id: clean, embedUrl: clean, loopUrl: clean };
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (!cors) return new Response("CORS blocked", { status: 403 });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse(cors, { error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(cors, { error: "Brak autoryzacji" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const geminiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
    const model = (Deno.env.get("GEMINI_MODEL") || DEFAULT_MODEL).trim();

    if (!geminiKey || !serviceRole) {
      return jsonResponse(cors, { error: "Brak konfiguracji AI na serwerze" }, 500);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !user?.id) return jsonResponse(cors, { error: "Sesja wygasła" }, 401);

    // 1. Soft Rate Limiting na poziomie instancji (30s cooldown)
    const now = Date.now();
    const lastCall = lastCallByUser.get(user.id) || 0;
    if (now - lastCall < RATE_LIMIT_MS) {
      return jsonResponse(cors, { error: "Odczekaj chwilę przed kolejną wiadomością (ok. 30 sekund)." }, 429);
    }
    // Rezerwacja slotu cooldown z góry zapobiega race condition przy równoległych żądaniach
    lastCallByUser.set(user.id, now);

    const body = await req.json().catch(() => ({}));
    const pageId = Number(body.pageId);
    const userMessage = String(body.message || "").trim();
    const chatHistory = Array.isArray(body.history) ? body.history : [];

    if (!pageId || !userMessage) {
      return jsonResponse(cors, { error: "Wymagane pageId oraz wiadomość" }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: superRow } = await supabaseAdmin
      .from("superadmins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const isGod = !!superRow?.user_id;

    const { data: page, error: pageErr } = await supabaseAdmin
      .from("pages")
      .select("id, user_id, slug, theme, draft_content, billing_plan")
      .eq("id", pageId)
      .maybeSingle();

    if (pageErr || !page) return jsonResponse(cors, { error: "Nie znaleziono strony" }, 404);
    if (!isGod && page.user_id !== user.id) {
      return jsonResponse(cors, { error: "Brak uprawnień do edycji tej strony" }, 403);
    }

    // 2. Weryfikacja miesięcznego limitu zapytań AI (billing_profiles)
    const { data: profile } = await supabaseAdmin
      .from("billing_profiles")
      .select("id, user_id, plan, agent_chat_month, agent_chat_count, ai_gen_month, ai_gen_count")
      .eq("user_id", page.user_id)
      .maybeSingle();

    const planFromProfile = normalizePlan(profile?.plan);
    const planFromPage = normalizePlan(page.billing_plan);
    const effectivePlan = (planFromProfile && planFromProfile !== "trial") ? planFromProfile : planFromPage;

    const limit = isGod ? 9999 : getAiMonthlyLimit(effectivePlan);
    const ym = currentYearMonth();

    // Preferuj kolumnę agent_chat_count; fallback do ai_gen_count dla zachowania kompatybilności
    const hasAgentCount = profile && typeof (profile as any).agent_chat_count === "number";
    let count = hasAgentCount
      ? Number((profile as any).agent_chat_count)
      : (typeof profile?.ai_gen_count === "number" ? profile.ai_gen_count : 0);
    const month = hasAgentCount
      ? String((profile as any).agent_chat_month || "")
      : (typeof profile?.ai_gen_month === "string" ? profile.ai_gen_month : "");
    if (month !== ym) count = 0;

    if (!isGod && count >= limit) {
      return jsonResponse(cors, {
        error: "Wykorzystałeś limit zapytań do Agenta AI w tym miesiącu. Przejdź do zakładki Subskrypcja w panelu, aby zwiększyć limit.",
      }, 429);
    }

    const draft = (page.draft_content && typeof page.draft_content === "object")
      ? (JSON.parse(JSON.stringify(page.draft_content)) as Record<string, any>)
      : { blocks: [] };

    if (!Array.isArray(draft.blocks)) draft.blocks = [];

    // Przygotowanie promptu kontekstowego
    const systemPrompt = `Jesteś profesjonalnym, autonomicznym Agentem DFCMS pełniącym rolę CMS-a strony użytkownika.
Zarządzasz stroną w formacie blokowym (Zero-CMS Architecture).

ZASADY ABSOLUTNE:
1. Zmieniaj TYLKO to, o co użytkownik wyraźnie prosi. NIGDY nie refaktoruj, nie usuwaj i nie zmieniaj innych sekcji ani stylów samowolnie.
2. Gdy użytkownik prosi o zmianę (np. tekstu, numeru telefonu, linku wideo, nagłówka), ZAWSZE wywołaj odpowiednie narzędzie (np. update_block_data).
3. Gdy użytkownik podaje link do filmu (Vimeo, YouTube), wstaw go jako video_url lub showreel_url do właściwego bloku.
4. Po wywołaniu narzędzi, zawsze odpowiedz krótko, naturalnie i uprzejmie po polsku (1-2 zdania), informując co zostało zmienione.
5. Jeśli użytkownik zadaje pytanie o radę marketingową lub treść, doradź mu zwięźle.

AKTUALNY STAN STRONY (BLOKI):
${JSON.stringify(draft.blocks, null, 2)}`;

    // 3. Konstrukcja zapytania do Gemini API z deduplikacją historii
    const contents: any[] = [];
    const historySlice = chatHistory.slice(-8);

    // Jeśli historia już kończy się obecną wiadomością użytkownika, usuń ją z historii aby nie dublować roli "user"
    if (
      historySlice.length > 0 &&
      historySlice[historySlice.length - 1].role === "user" &&
      String(historySlice[historySlice.length - 1].text || "").trim() === userMessage
    ) {
      historySlice.pop();
    }

    for (const h of historySlice) {
      const text = String(h.text || "").trim();
      if ((h.role === "user" || h.role === "model") && text) {
        if (contents.length > 0 && contents[contents.length - 1].role === h.role) {
          contents[contents.length - 1].parts[0].text += `\n${text}`;
        } else {
          contents.push({ role: h.role, parts: [{ text }] });
        }
      }
    }

    // Ostatnia tura musi być użytkownikiem z bieżącą wiadomością
    if (contents.length > 0 && contents[contents.length - 1].role === "user") {
      contents[contents.length - 1].parts[0].text = userMessage;
    } else {
      contents.push({ role: "user", parts: [{ text: userMessage }] });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: AGENT_TOOLS,
        generationConfig: {
          temperature: 0.2, // Niska temperatura dla precyzji narzędzi
        },
      }),
    });
    clearTimeout(timer);

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("[chat-site-agent] Gemini error:", geminiRes.status, errText);
      return jsonResponse(cors, { error: "Błąd komunikacji z AI" }, 502);
    }

    const geminiData = await geminiRes.json();
    const candidate = geminiData?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let executedTools: string[] = [];
    let assistantReply = "";
    let draftChanged = false;

    for (const part of parts) {
      if (part.text) {
        assistantReply += part.text;
      }
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        executedTools.push(name);

        if (name === "update_block_data") {
          const { blockId, path, value } = args;
          const targetBlock = draft.blocks.find((b: any) => b.id === blockId);
          if (targetBlock) {
            if (!targetBlock.data) targetBlock.data = {};
            const ok = setDeepValue(targetBlock.data, path, value);
            if (ok) {
              if (path === "video_url" || path === "showreel_url") {
                const meta = extractVideoMeta(value);
                targetBlock.data.video_provider = meta.provider;
                targetBlock.data.video_id = meta.id;
              }
              draftChanged = true;
            }
          }
        } else if (name === "add_block") {
          const { blockType, afterBlockId, heading } = args;
          if (blockType && BLOCK_DEFAULTS[blockType]) {
            const defaults = JSON.parse(JSON.stringify(BLOCK_DEFAULTS[blockType]));
            if (heading) defaults.heading = heading;
            const newBlock = {
              id: `${blockType}_${Date.now().toString(36)}`,
              type: blockType,
              data: defaults,
            };
            if (!afterBlockId) {
              draft.blocks.push(newBlock);
            } else {
              const idx = draft.blocks.findIndex((b: any) => b.id === afterBlockId);
              if (idx === -1) draft.blocks.push(newBlock);
              else draft.blocks.splice(idx + 1, 0, newBlock);
            }
            draftChanged = true;
          }
        } else if (name === "remove_block") {
          const { blockId } = args;
          const lenBefore = draft.blocks.length;
          draft.blocks = draft.blocks.filter((b: any) => b.id !== blockId);
          if (draft.blocks.length !== lenBefore) draftChanged = true;
        } else if (name === "update_design") {
          if (!draft.design) draft.design = {};
          if (args.palette && typeof args.palette === "string") {
            draft.design.palette = args.palette.replace(/[^a-zA-Z0-9_-]/g, "");
          }
          if (args.accentColor && typeof args.accentColor === "string") {
            const color = args.accentColor.trim();
            if (/^#[0-9a-fA-F]{3,8}$/.test(color)) {
              draft.design.accent_color = color;
            }
          }
          draftChanged = true;
        }
      }
    }

    if (draftChanged) {
      const { error: updErr } = await supabaseAdmin
        .from("pages")
        .update({ draft_content: draft })
        .eq("id", pageId);

      if (updErr) {
        console.error("[chat-site-agent] DB draft update failed:", updErr.message);
        return jsonResponse(cors, { error: "Nie udało się zapisać zmian w bazie" }, 500);
      }
    }

    // 4. Zapisanie zużycia limitu Agenta AI (billing_profiles)
    if (!isGod) {
      const nextCount = count + 1;
      const updateData: Record<string, any> = {
        agent_chat_month: ym,
        agent_chat_count: nextCount,
      };
      if (!hasAgentCount) {
        // Fallback zgodności wstecznej jeśli kolumny agent_chat nie zostały jeszcze utworzone
        updateData.ai_gen_month = ym;
        updateData.ai_gen_count = nextCount;
      }

      if (profile?.user_id) {
        await supabaseAdmin
          .from("billing_profiles")
          .update(updateData)
          .eq("user_id", page.user_id);
      } else {
        await supabaseAdmin.from("billing_profiles").upsert({
          user_id: page.user_id,
          plan: effectivePlan === "trial" ? null : effectivePlan,
          ...updateData,
        }, { onConflict: "user_id" });
      }
    }

    return jsonResponse(cors, {
      success: true,
      reply: assistantReply.trim() || (executedTools.length ? "Wprowadziłem oczekiwane zmiany na stronie." : "W czym mogę Ci jeszcze pomóc?"),
      draft_content: draft,
      executedTools,
    });
  } catch (err) {
    console.error("[chat-site-agent] Exception:", err);
    return jsonResponse(cors, { error: "Wystąpił nieoczekiwany błąd serwera." }, 500);
  }
});
