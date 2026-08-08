/** Deno global - available at runtime in Supabase Edge Functions. */
declare const Deno: { env: { get: (k: string) => string | undefined } };

/** Staging project ref (docs/CONTEXT.md §3.1). */
const STAGING_REF = "asxrsdsprrbvjvgcsckh";
/** Production project ref. */
const PROD_REF = "tawywecinkubmouyprab";

/**
 * Short label for ops alerts (Telegram, logs).
 * Prefers `DFCMS_ENV`; falls back to SUPABASE_URL project ref.
 */
export function dfcmsEnvLabel(): "STAGING" | "PROD" | "UNKNOWN" {
  const raw = (Deno.env.get("DFCMS_ENV") || "").trim().toLowerCase();
  if (raw === "production" || raw === "prod") return "PROD";
  if (raw === "staging" || raw === "stage") return "STAGING";

  const url = (Deno.env.get("SUPABASE_URL") || "").toLowerCase();
  if (url.includes(PROD_REF)) return "PROD";
  if (url.includes(STAGING_REF)) return "STAGING";

  return "UNKNOWN";
}

/** Prefix for HTML Telegram messages (`parse_mode: HTML`). */
export function telegramEnvPrefixHtml(): string {
  const label = dfcmsEnvLabel();
  if (label === "PROD") return "🟢 <b>[PROD]</b>\n";
  if (label === "STAGING") return "🟡 <b>[STAGING]</b>\n";
  return "⚪ <b>[UNKNOWN]</b>\n";
}

/** Prefix for Markdown Telegram messages (`parse_mode: Markdown`). */
export function telegramEnvPrefixMarkdown(): string {
  const label = dfcmsEnvLabel();
  if (label === "PROD") return "🟢 *[PROD]*\n";
  if (label === "STAGING") return "🟡 *[STAGING]*\n";
  return "⚪ *[UNKNOWN]*\n";
}
