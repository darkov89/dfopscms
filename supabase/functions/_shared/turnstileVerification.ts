declare const Deno: { env: { get: (k: string) => string | undefined } };

export type TurnstileVerificationResult = {
  success: boolean;
  error?: string;
};

export async function verifyTurnstileToken(
  token: string | null | undefined,
  remoteIp?: string | null,
): Promise<TurnstileVerificationResult> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY")?.trim() ?? "";
  const response = String(token || "").trim();

  if (!secret) return { success: false, error: "TURNSTILE_SECRET_KEY is not configured" };
  if (!response) return { success: false, error: "Missing Turnstile token" };

  const form = new FormData();
  form.set("secret", secret);
  form.set("response", response);
  if (remoteIp) form.set("remoteip", remoteIp);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    if (!res.ok) return { success: false, error: `Turnstile HTTP ${res.status}` };

    const body = await res.json().catch(() => null);
    if (body?.success === true) return { success: true };

    const codes = Array.isArray(body?.["error-codes"]) ? body["error-codes"].join(",") : "unknown";
    return { success: false, error: `Turnstile rejected: ${codes}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg || "Turnstile verification failed" };
  }
}
