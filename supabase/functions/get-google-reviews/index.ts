// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function safeToInt(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.floor(n))) : fallback;
}

function safePlacesListCount(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(15, Math.floor(n)));
}

function normalizePlaceIdForList(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return s.startsWith("places/") ? s.slice("places/".length) : s;
}

/** place_id pod Maps Embed API */
function sanitizePlaceIdForEmbed(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("places/")) s = s.slice("places/".length);
  if (s.length > 512 || s.length < 4) return null;
  if (/[<>'"&\s]/.test(s)) return null;
  return s;
}

async function readResponseAsJsonOrText(resp: Response) {
  const text = await resp.text();
  try {
    return { ok: resp.ok, json: JSON.parse(text), text };
  } catch {
    return { ok: resp.ok, json: null, text };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const parsed = await readResponseAsJsonOrText(resp);
    return { resp, ...parsed };
  } finally {
    clearTimeout(t);
  }
}

interface PlaceSearchPlace {
  id?: string;
}

interface PlaceSearchResponse {
  places?: PlaceSearchPlace[];
  error?: { message?: string };
  message?: string;
}

function pickFirstPlaceIdFromSearchText(searchTextJson: PlaceSearchResponse | null): string | null {
  const places = searchTextJson?.places;
  if (!Array.isArray(places) || places.length === 0) return null;
  return places[0]?.id ?? null;
}

interface ReviewRaw {
  rating?: number | string;
  text?: string | { text?: string; value?: string };
  authorAttribution?: {
    displayName?: string | { text?: string };
    display_name?: string;
    uri?: string;
    photoURI?: string;
    photoUrl?: string;
  };
  publishTime?: string;
  publish_time?: string;
}

interface PlaceDetailsResponse {
  displayName?: string | { text?: string };
  reviews?: ReviewRaw[];
  rating?: number;
  userRatingCount?: number;
  error?: { message?: string } | string;
  error_message?: string;
}

function normalizeReview(r: ReviewRaw | null) {
  const rating = typeof r?.rating === "number" ? r.rating : Number(r?.rating ?? NaN);
  const text =
    r?.text?.text ??
    r?.text?.value ??
    r?.text ??
    "";

  const author_name =
    r?.authorAttribution?.displayName?.text ??
    r?.authorAttribution?.displayName ??
    r?.authorAttribution?.display_name ??
    "";

  const author_url = r?.authorAttribution?.uri ?? "";
  const profile_photo_url =
    r?.authorAttribution?.photoURI ??
    r?.authorAttribution?.photoUrl ??
    "";

  const publishTimeRaw = r?.publishTime ?? r?.publish_time ?? "";
  const publishTime = typeof publishTimeRaw === "string" ? publishTimeRaw : "";

  return {
    rating: Number.isFinite(rating) ? rating : null,
    text: String(text),
    author_name: String(author_name),
    author_url: String(author_url),
    profile_photo_url: String(profile_photo_url),
    publishTime,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Metoda nieobsługiwana." }, 405);
  }

  const googleApiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!googleApiKey) {
    return jsonResponse({
      ok: false,
      error: "Brak GOOGLE_MAPS_API_KEY w środowisku Edge Function.",
    }, 500);
  }

  let payload: {
    query?: string;
    maxReviews?: unknown;
    maxResults?: unknown;
    listPlaces?: boolean;
    embed_for_place_id?: string;
  } = {};
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return jsonResponse({ ok: false, error: "Nieprawidłowe JSON w body." }, 400);
  }

  /** Mapa: URL iframe (Maps Embed API). */
  if (typeof payload.embed_for_place_id === "string" && payload.embed_for_place_id.trim() !== "") {
    const placeId = sanitizePlaceIdForEmbed(payload.embed_for_place_id);
    if (!placeId) {
      return jsonResponse({ ok: false, error: "Nieprawidłowe embed_for_place_id." }, 400);
    }
    const q = `place_id:${placeId}`;
    const embedUrl =
      `https://www.google.com/maps/embed/v1/place?` +
      new URLSearchParams({
        key: googleApiKey,
        q,
        zoom: "15",
      }).toString();
    return jsonResponse({ ok: true, embedUrl }, 200);
  }

  /** Panel: lista miejsc do wyboru (Places searchText). */
  if (payload.listPlaces === true) {
    const listQuery = typeof payload.query === "string" ? payload.query.trim() : "";
    const maxResults = safePlacesListCount(payload?.maxResults, 8);
    if (!listQuery || listQuery.length < 2) {
      return jsonResponse({ ok: false, error: "Podaj frazę (min. 2 znaki)." }, 400);
    }

    const searchTextUrl = "https://places.googleapis.com/v1/places:searchText";
    const listSearchReq = await fetchWithTimeout(
      searchTextUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": googleApiKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
        },
        body: JSON.stringify({
          textQuery: listQuery,
          maxResultCount: maxResults,
        }),
      },
      12000,
    );

    const listText = listSearchReq.text;
    let listJson: {
      places?: Array<{
        id?: string;
        displayName?: { text?: string } | string;
        formattedAddress?: string;
      }>;
      error?: { message?: string };
      message?: string;
    };
    try {
      listJson = listSearchReq.json
        ? (listSearchReq.json as typeof listJson)
        : (JSON.parse(listText) as typeof listJson);
    } catch {
      return jsonResponse({
        ok: false,
        stage: "places_list_parse",
        errorText: listText.slice(0, 500),
      }, 502);
    }

    if (!listSearchReq.ok) {
      return jsonResponse({
        ok: false,
        stage: "places_list_searchText",
        httpStatus: listSearchReq.resp.status,
        errorText: listText.slice(0, 800),
      }, 502);
    }

    const rawPlaces = Array.isArray(listJson?.places) ? listJson.places : [];
    const places: { id: string; name: string; address: string }[] = [];
    for (const p of rawPlaces) {
      const rawId = typeof p?.id === "string" ? p.id : "";
      const id = normalizePlaceIdForList(rawId);
      if (!id) continue;
      const name =
        typeof p?.displayName === "object" && p.displayName?.text
          ? String(p.displayName.text)
          : typeof p?.displayName === "string"
          ? p.displayName
          : "";
      const address = typeof p?.formattedAddress === "string" ? p.formattedAddress : "";
      places.push({
        id,
        name: name || address || id,
        address,
      });
    }

    return jsonResponse({ ok: true, places }, 200);
  }

  const query = typeof payload?.query === "string" ? payload.query.trim() : "";
  const maxReviews = safeToInt(payload?.maxReviews, 6);

  if (!query) {
    return jsonResponse({ ok: false, error: "Brak parametru query." }, 400);
  }

  const searchTextUrl = "https://places.googleapis.com/v1/places:searchText";

  const searchReq = await fetchWithTimeout(
    searchTextUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": googleApiKey,
        "X-Goog-FieldMask": "places.id",
      },
      body: JSON.stringify({ textQuery: query }),
    },
    9000,
  );

  if (!searchReq.ok) {
    return jsonResponse({
      ok: false,
      stage: "places_searchText",
      httpStatus: searchReq.resp.status,
      errorText: searchReq.text,
    }, 502);
  }

  const searchJson = (searchReq.json ?? {}) as PlaceSearchResponse;
  const placesCount = Array.isArray(searchJson?.places) ? searchJson.places.length : 0;
  const placeId = pickFirstPlaceIdFromSearchText(searchJson);

  if (!placeId) {
    return jsonResponse({
      ok: true,
      placeId: null,
      reviews: [],
      debug: {
        searchStatus: searchJson?.error?.message ? "ERROR" : null,
        searchErrorMessage: searchJson?.error?.message ?? searchJson?.message ?? null,
        searchPlacesCount: placesCount,
        query,
        httpStatus: searchReq.resp.status,
      },
    }, 200);
  }

  const detailsUrl = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;

  const detailsReq = await fetchWithTimeout(
    detailsUrl,
    {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": googleApiKey,
        "X-Goog-FieldMask": "displayName,reviews,rating,userRatingCount",
      },
    },
    9000,
  );

  if (!detailsReq.ok) {
    return jsonResponse({
      ok: false,
      stage: "place_details",
      placeId,
      httpStatus: detailsReq.resp.status,
      errorText: detailsReq.text,
    }, 502);
  }

  const detailsJson = (detailsReq.json ?? {}) as PlaceDetailsResponse;
  const detailsError =
    typeof detailsJson?.error === "object"
      ? (detailsJson.error as { message?: string })?.message
      : typeof detailsJson?.error === "string"
      ? detailsJson.error
      : detailsJson?.error_message ?? null;
  const reviews = Array.isArray(detailsJson?.reviews) ? detailsJson.reviews : [];

  const normalized = reviews
    .slice(0, maxReviews)
    .map(normalizeReview);

  const placeRating =
    typeof detailsJson?.rating === "number"
      ? detailsJson.rating
      : detailsJson?.rating != null
      ? Number(detailsJson.rating)
      : null;
  const userRatingCount =
    typeof detailsJson?.userRatingCount === "number"
      ? detailsJson.userRatingCount
      : detailsJson?.userRatingCount != null
      ? Number(detailsJson.userRatingCount)
      : null;

  return jsonResponse({
    ok: true,
    placeId,
    placeName: detailsJson?.displayName?.text ?? detailsJson?.displayName ?? "",
    placeRating: Number.isFinite(placeRating) ? placeRating : null,
    userRatingCount: Number.isFinite(userRatingCount) ? userRatingCount : null,
    reviews: normalized,
    debug: detailsError ? { detailsError } : undefined,
  }, 200);
});
