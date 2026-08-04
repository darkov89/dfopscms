/**
 * Auth + weryfikacja superadmina dla Edge Functions God Mode.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";

declare const Deno: { env: { get: (k: string) => string | undefined } };

export type GodAuthOk = {
  ok: true;
  userId: string;
  supabaseUser: SupabaseClient;
  supabaseAdmin: SupabaseClient;
};

export type GodAuthFail = {
  ok: false;
  status: number;
  error: string;
  code: string;
};

export async function requireSuperadmin(
  req: Request,
): Promise<GodAuthOk | GodAuthFail> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return { ok: false, status: 401, error: "Brak autoryzacji", code: "UNAUTHORIZED" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey || !serviceRole) {
    return {
      ok: false,
      status: 500,
      error: "Brak konfiguracji Supabase na serwerze",
      code: "INTERNAL",
    };
  }

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await supabaseUser.auth.getUser();
  if (userErr || !user?.id) {
    return { ok: false, status: 401, error: "Wymagane zalogowanie", code: "UNAUTHORIZED" };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: superRow, error: superErr } = await supabaseAdmin
    .from("superadmins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (superErr) {
    console.error("requireSuperadmin", superErr.message);
    return { ok: false, status: 500, error: "Błąd weryfikacji uprawnień", code: "INTERNAL" };
  }
  if (!superRow?.user_id) {
    return { ok: false, status: 403, error: "Brak uprawnień God Mode", code: "FORBIDDEN" };
  }

  return { ok: true, userId: user.id, supabaseUser, supabaseAdmin };
}
