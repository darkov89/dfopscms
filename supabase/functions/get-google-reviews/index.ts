// @ts-ignore - remote Deno std module isn't resolvable by local TS linter.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// @ts-ignore - Deno global exists at runtime in Edge Functions.
declare const Deno: any;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}

function safeToInt(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(1, Math.min(20, Math.floor(n))) : fallback;
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

function pickFirstPlaceIdFromSearchText(searchTextJson: any): string | null {
  const places = searchTextJson?.places;
  if (!Array.isArray(places) || places.length === 0) return null;
  // Places API (New) returns "id" field with format like "ChIJ..."
  return places[0]?.id ?? null;
}

function normalizeReview(r: any) {
  // Place Details (New) review shapes can differ slightly. Be defensive.
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
  // CORS preflight
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 200);
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

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Nieprawidłowe JSON w body." }, 400);
  }

  const query = typeof payload?.query === "string" ? payload.query.trim() : "";
  const maxReviews = safeToInt(payload?.maxReviews, 6);

  if (!query) {
    return jsonResponse({ ok: false, error: "Brak parametru query." }, 400);
  }

  // 1) Find place id from query (Places API - New)
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

  const searchJson = searchReq.json ?? {};
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
    });
  }

  // 2) Fetch reviews using Place Details (New)
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

  const detailsJson = detailsReq.json ?? {};
  const detailsError =
    detailsJson?.error?.message ?? detailsJson?.error_message ?? detailsJson?.error ?? null;
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
  });
});

