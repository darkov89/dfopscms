// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeadersForRequest } from "../_shared/allowedOrigins.ts";

declare const Deno: { env: { get: (k: string) => string | undefined } };

const DEFAULT_MODEL = "gemini-2.5-flash";
const GEMINI_TIMEOUT_MS = 25_000;
const RATE_LIMIT_MS = 30_000;

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

const PALETTE_COLORS: Record<string, string> = {
  dark_gold: "#D4AF37",
  gold: "#D4AF37",
  dark_silver: "#94a3b8",
  silver: "#94a3b8",
  emerald: "#10b981",
  green: "#10b981",
  cobalt: "#3b82f6",
  blue: "#3b82f6",
  crimson: "#ef4444",
  red: "#ef4444",
  purple: "#a855f7",
  amber: "#f59e0b",
  clean_light: "#2563eb",
};

// Import wspólnych domyślnych danych bloków (jedne źródło prawdy dla Edge Functions)
import { BLOCK_DEFAULTS } from "../_shared/customBlockDefaults.ts";

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
            path: { type: "STRING", description: "Ścieżka do pola w danych bloku (np. phone, title, subtitle, video_url, showreel_url, tagline, email, city, place_query)" },
            value: { description: "Nowa wartość tekstowa, URL lub tablica/obiekt" },
          },
          required: ["blockId", "path", "value"],
        },
      },
      {
        name: "replace_block_items",
        description: "Aktualizuje całą listę pozycji w bloku (np. listę pakietów w cenniku, pozycje w liście usług, pytania w FAQ, wskaźniki w statystykach, realizacje w projektach). Zastępuje tablicę items nową listą obiektów dopasowanych do danego bloku.",
        parameters: {
          type: "OBJECT",
          properties: {
            blockId: { type: "STRING", description: "ID bloku, którego listę pozycji aktualizujesz" },
            items: {
              type: "ARRAY",
              description: "Nowa tablica elementów zgodna ze schematem pozycji danego bloku",
              items: { type: "OBJECT" },
            },
          },
          required: ["blockId", "items"],
        },
      },
      {
        name: "add_block",
        description: "Wstawia nowy blok na stronę. Dostępne typy bloków: cinematic_hero, projects_grid, awards_strip, director_statement, minimal_contact, quick_hero, key_features, quick_contact_card, faq_simple, testimonials_grid, faq_accordion, pricing_tiers, trust_stats, services_list, booking_cta, location_map, gallery_grid, google_reviews.",
        parameters: {
          type: "OBJECT",
          properties: {
            blockType: {
              type: "STRING",
              description: "Typ bloku do wstawienia (np. google_reviews, trust_stats, services_list, booking_cta, location_map, gallery_grid, pricing_tiers, testimonials_grid, faq_accordion)",
            },
            afterBlockId: {
              type: "STRING",
              description: "Opcjonalne ID bloku, po którym nowy blok ma zostać wstawiony. Jeśli puste, blok trafi na koniec.",
            },
            heading: { type: "STRING", description: "Tytuł/nagłówek nowo dodawanej sekcji" },
            initialData: {
              type: "OBJECT",
              description: "Opcjonalne początkowe dane bloku nadpisujące wartości domyślne (np. items, phone, address itp.)",
            },
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
      {
        name: "reorder_blocks",
        description: "Zmienia kolejność sekcji (bloków) na stronie.",
        parameters: {
          type: "OBJECT",
          properties: {
            orderedIds: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "Tablica ID bloków w nowej kolejności",
            },
          },
          required: ["orderedIds"],
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

function isGoogleMapsEmbedHttpsUrl(val: string): boolean {
  if (typeof val !== "string") return false;
  const clean = val.trim();
  if (!clean.startsWith("https://")) return false;
  try {
    const u = new URL(clean);
    const host = u.hostname.toLowerCase();
    if (host !== "www.google.com" && host !== "google.com" && host !== "maps.google.com") return false;
    return u.pathname.startsWith("/maps/embed") || u.pathname === "/maps" || u.pathname.startsWith("/maps/");
  } catch {
    return false;
  }
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
  if (last === "map_embed_url") {
    cur[last] = (typeof value === "string" && isGoogleMapsEmbedHttpsUrl(value)) ? value.trim() : "";
  } else if (
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

    const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Soft Rate Limiting na poziomie bazy danych (30s cooldown)
    const { data: rlProfile } = await supabaseAdmin
      .from("billing_profiles")
      .select("last_agent_call_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (rlProfile?.last_agent_call_at) {
      const lastCallMs = new Date(rlProfile.last_agent_call_at).getTime();
      if (Date.now() - lastCallMs < RATE_LIMIT_MS) {
        return jsonResponse(cors, { error: "Odczekaj chwilę przed kolejną wiadomością (ok. 30 sekund)." }, 429);
      }
    }

    const body = await req.json().catch(() => ({}));
    const pageId = Number(body.pageId);
    const userMessage = String(body.message || "").trim();
    const chatHistory = Array.isArray(body.history) ? body.history : [];

    if (!pageId || !userMessage) {
      return jsonResponse(cors, { error: "Wymagane pageId oraz wiadomość" }, 400);
    }

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
    const currentDesign = draft.design || { palette: "dark_gold", accent_color: "#D4AF37" };

    const systemPrompt = `Jesteś profesjonalnym, autonomicznym Agentem DFCMS pełniącym rolę CMS-a strony użytkownika.
Zarządzasz stroną w formacie blokowym (Zero-CMS Architecture).

ZASADY PRACY I INTERAKCJI:
1. Zmieniaj TYLKO to, o co użytkownik prosi. NIGDY nie usuwaj ani nie zmieniaj innych sekcji ani stylów samowolnie.
2. Gdy użytkownik prosi o zmianę treści, telefonu, wideo, kolejności lub kolorów, ZAWSZE wywołaj odpowiednie narzędzie (update_block_data, add_block, remove_block, update_design, reorder_blocks).
3. Gdy użytkownik pyta ogólnie o zmianę stylu lub kolorystyki (np. "Zmień styl", "Zmień kolorystykę strony", "Jakie opcje polecasz?") i nie podał konkretnego koloru ani nazwy:
   NIE zmieniaj stylu w ciemno. Zamiast tego przedstaw użytkownikowi w uprzejmej wiadomości 5 dopracowanych wariantów do wyboru:
   1) 👑 Złoty luksus (czerń + złoto #D4AF37) — styl klasyczny
   2) ⚪ Srebrny minimalizm (grafit + chłodne srebro #94a3b8)
   3) 🟢 Szmaragdowa elegancja (głęboka czerń + butelkowa zieleń #10b981)
   4) 🔵 Nowoczesny kobalt (czerń + neonowy błękit #3b82f6)
   5) 🔴 Karmin filmowy (czerń + czerwień #ef4444)
   Zapytaj krótko, który wariant wybiera lub jaki własny kolor preferuje.
4. Gdy użytkownik wybierze wariant (np. "2", "srebrny", "chcę szmaragd", "niebieski", "czerwony", "zmień na złoty"):
   ZAWSZE wywołaj narzędzie update_design z odpowiednim palette i accentColor (np. palette: "emerald", accentColor: "#10b981"), a w odpowiedzi potwierdź zmianę i zapytaj, jak podoba mu się ten klimat.
5. Gdy użytkownik prosi o dodanie sekcji (np. opinie google, cennik, usługi, formularz, mapa, statystyki, galeria):
   - Wybierz odpowiedni typ bloku z listy (google_reviews, trust_stats, services_list, booking_cta, location_map, gallery_grid, pricing_tiers, faq_accordion, testimonials_grid itp.).
   - Jeśli użytkownik podał już szczegóły (np. nazwę firmy, adres, telefon, pozycje), przekaż je w initialData lub zaktualizuj po dodaniu.
   - W odpowiedzi zachowaj się jak sprawny, życzliwy frontend developer: potwierdź dodanie sekcji i od razu zapytaj o brakujące kluczowe dane potrzebne do jej pełnego spersonalizowania (np. dla google_reviews: zapytaj o dokładną nazwę wizytówki Google lub link do recenzji; dla location_map: zapytaj o adres lub godziny otwarcia; dla booking_cta: zapytaj o telefon lub link do rezerwacji Booksy/Calendly; dla services_list: zapytaj o listę głównych zabiegów/usług z cenami; dla trust_stats: zapytaj o kluczowe liczby, np. lata na rynku czy liczbę klientów).
6. Gdy użytkownik podaje listę elementów (np. 3 pakiety cennika, listę usług z cenami, nowe pytania FAQ, liczby do statystyk):
   Użyj narzędzia replace_block_items, przekazując kompletną tablicę obiektów z polami wymaganymi dla danej sekcji.
7. Zawsze odpowiadaj po polsku, profesjonalnie, po ludzku jak frontendowiec (1-3 zdania), bez żargonu i bez korpomowy.
8. NIGDY nie wymyślaj nieistniejących bloków — korzystaj ściśle ze zdefiniowanych narzędzi i katalogu bloków.

AKTUALNY STYL I DESIGN STRONY:
${JSON.stringify(currentDesign, null, 2)}

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
            let parsedVal = value;
            if (path === "items" && typeof value === "string") {
              try {
                parsedVal = JSON.parse(value);
              } catch (_) {}
            }
            const ok = setDeepValue(targetBlock.data, path, parsedVal);
            if (ok) {
              if (path === "video_url" || path === "showreel_url") {
                const meta = extractVideoMeta(typeof parsedVal === "string" ? parsedVal : "");
                targetBlock.data.video_provider = meta.provider;
                targetBlock.data.video_id = meta.id;
              }

              // Synchronizacja z oficjalną Edge Function get-google-reviews (jedyne źródło prawdy dla Places)
              if (targetBlock.type === "google_reviews" && (path === "place_query" || path === "query")) {
                if (typeof parsedVal === "string" && parsedVal.trim()) {
                  try {
                    const { data: gData, error: gErr } = await supabaseAuth.functions.invoke("get-google-reviews", {
                      headers: { Authorization: authHeader, Origin: "https://dfcms.pl" },
                      body: { query: parsedVal.trim(), maxReviews: 6 },
                    });
                    if (!gErr && gData && gData.ok) {
                      if (gData.placeId) targetBlock.data.place_id = gData.placeId;
                      if (typeof gData.placeRating === "number") targetBlock.data.rating = gData.placeRating;
                      if (typeof gData.userRatingCount === "number") {
                        targetBlock.data.reviews_count = gData.userRatingCount;
                        targetBlock.data.user_ratings_total = gData.userRatingCount;
                      }
                      if (gData.placeId) {
                        targetBlock.data.write_review_url = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(gData.placeId)}`;
                      }
                      if (Array.isArray(gData.reviews) && gData.reviews.length > 0) {
                        targetBlock.data.items = gData.reviews.map((r: any) => ({
                          author_name: r.author_name || "Klient",
                          rating: r.rating ?? 5,
                          time_description: r.time_description || r.publishTime || "w Google",
                          text: r.text || "",
                          author_url: r.author_url ? sanitizeUrl(r.author_url) : "",
                        }));
                      }
                    }
                  } catch (err) {
                    console.warn("[chat-site-agent] get-google-reviews invoke error:", err);
                  }
                }
              }

              if (targetBlock.type === "location_map" && (path === "address" || path === "city")) {
                const addr = `${targetBlock.data.address || ""} ${targetBlock.data.city || ""}`.trim();
                if (addr) {
                  targetBlock.data.directions_url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
                }
              }
              draftChanged = true;
            }
          }
        } else if (name === "replace_block_items") {
          const { blockId, items } = args || {};
          const targetBlock = draft.blocks.find((b: any) => b.id === blockId);
          let parsedItems = items;
          if (typeof items === "string") {
            try {
              parsedItems = JSON.parse(items);
            } catch (_) {}
          }
          if (targetBlock && Array.isArray(parsedItems)) {
            if (!targetBlock.data) targetBlock.data = {};
            // Sanityzacja każdego elementu: ochrona przed Prototype Pollution i niebezpiecznymi URL-ami
            const sanitizedItems: any[] = [];
            for (const item of parsedItems) {
              if (item && typeof item === "object" && !Array.isArray(item)) {
                const cleanItem: Record<string, any> = {};
                for (const [k, v] of Object.entries(item)) {
                  if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
                  if (
                    typeof v === "string" &&
                    (k.endsWith("_url") || k === "url" || k === "booking_url" || k === "thumbnail" || k === "author_url")
                  ) {
                    cleanItem[k] = sanitizeUrl(v);
                  } else {
                    cleanItem[k] = v;
                  }
                }
                sanitizedItems.push(cleanItem);
              }
            }
            targetBlock.data.items = sanitizedItems;
            draftChanged = true;
          }
        } else if (name === "add_block") {
          const { blockType, afterBlockId, heading, initialData } = args || {};
          if (blockType && BLOCK_DEFAULTS[blockType]) {
            const defaults = JSON.parse(JSON.stringify(BLOCK_DEFAULTS[blockType]));
            if (heading) defaults.heading = heading;
            if (initialData && typeof initialData === "object" && !Array.isArray(initialData)) {
              for (const [k, v] of Object.entries(initialData)) {
                if (k !== "__proto__" && k !== "constructor" && k !== "prototype") {
                  defaults[k] = v;
                }
              }
            }
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
          const paletteName = typeof args?.palette === "string" ? args.palette.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") : "";
          if (paletteName) {
            draft.design.palette = paletteName;
          }
          let accent = typeof args?.accentColor === "string" ? args.accentColor.trim() : "";
          if (!accent && paletteName && PALETTE_COLORS[paletteName]) {
            accent = PALETTE_COLORS[paletteName];
          } else if (accent && PALETTE_COLORS[accent.toLowerCase()]) {
            accent = PALETTE_COLORS[accent.toLowerCase()];
          }
          if (accent && /^#[0-9a-fA-F]{3,8}$/.test(accent)) {
            draft.design.accent_color = accent;
          }
          draftChanged = true;
        } else if (name === "reorder_blocks") {
          const { orderedIds } = args || {};
          if (Array.isArray(orderedIds) && orderedIds.length > 0) {
            const map = new Map(draft.blocks.map((b: any) => [b.id, b]));
            const reordered: any[] = [];
            for (const id of orderedIds) {
              if (map.has(id)) {
                reordered.push(map.get(id));
                map.delete(id);
              }
            }
            for (const remaining of map.values()) {
              reordered.push(remaining);
            }
            const orderChanged = reordered.some((b, i) => b.id !== draft.blocks[i]?.id) || reordered.length !== draft.blocks.length;
            if (orderChanged) {
              draft.blocks = reordered;
              draftChanged = true;
            }
          }
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

    // 4. Zapisanie zużycia limitu Agenta AI (billing_profiles) za pomocą atomowej operacji
    if (!isGod) {
      if (profile?.user_id) {
        if (month === ym && hasAgentCount) {
          // Zwykła inkrementacja i aktualizacja last_agent_call_at (atomowo)
          await supabaseAdmin.rpc("increment_agent_chat", { uid: page.user_id });
        } else {
          // Zmiana miesiąca lub brak kolumny agent_chat (reset)
          const updateData: Record<string, any> = {
            agent_chat_month: ym,
            agent_chat_count: 1,
            last_agent_call_at: new Date().toISOString(),
          };
          if (!hasAgentCount) {
            // Fallback zgodności wstecznej jeśli kolumny agent_chat nie zostały jeszcze utworzone
            updateData.ai_gen_month = ym;
            updateData.ai_gen_count = 1;
          }
          await supabaseAdmin
            .from("billing_profiles")
            .update(updateData)
            .eq("user_id", page.user_id);
        }
      } else {
        await supabaseAdmin.from("billing_profiles").upsert({
          user_id: page.user_id,
          plan: effectivePlan === "trial" ? null : effectivePlan,
          agent_chat_month: ym,
          agent_chat_count: 1,
          last_agent_call_at: new Date().toISOString(),
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
