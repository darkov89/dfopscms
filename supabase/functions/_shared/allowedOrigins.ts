/**
 * Shared origin / returnUrl allowlist for Edge Functions (billing, AI).
 * No *.pages.dev — staging uses *.dfcms.pl; local uses localhost.
 */

export function isAllowedOrigin(origin: string): boolean {
  const o = (origin || "").trim();
  if (!o) return false;
  if (o === "https://dfcms.pl") return true;
  if (o === "http://localhost:5500") return true;
  try {
    const u = new URL(o);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h.endsWith(".dfcms.pl")) return true;
    if (h === "localhost" || h === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

/** True when URL host is on the same allowlist as CORS origins. */
export function isAllowedReturnUrl(url: string): boolean {
  const raw = (url || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase();
    if (h === "dfcms.pl" || h.endsWith(".dfcms.pl")) return true;
    if (h === "localhost" || h === "127.0.0.1") return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Normalize and validate client returnUrl for Stripe success/cancel/portal.
 * @throws Error when missing or host not allowlisted
 */
export function assertAllowedReturnUrl(url: string): string {
  const raw = (url || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) {
    throw new Error("Brak lub nieprawidłowy returnUrl");
  }
  const normalized = raw.replace(/\/$/, "");
  if (!isAllowedReturnUrl(normalized)) {
    throw new Error("returnUrl spoza dozwolonych domen");
  }
  return normalized;
}

export function buildCorsHeadersForRequest(
  req: Request,
  base: Record<string, string>,
): Record<string, string> | null {
  const origin = req.headers.get("Origin") ?? "";
  if (!origin || !isAllowedOrigin(origin)) return null;
  return {
    ...base,
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}
