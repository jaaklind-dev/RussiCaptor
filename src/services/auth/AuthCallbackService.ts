import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/services/SupabaseService";

export const AUTH_CALLBACK_URI = "russicaptor://auth/callback";
export type AuthSetupFlow = "invite" | "recovery";
export type AuthCallbackFailure = "EXPIRED_OR_INVALID" | "MALFORMED" | "MISSING_SESSION" | "NETWORK";
export type AuthCallbackResult =
  | Readonly<{ ok: true; flow: AuthSetupFlow }>
  | Readonly<{ ok: false; reason: AuthCallbackFailure }>;

type AuthClient = Pick<SupabaseClient, "auth">;

function callbackParameters(url: URL): URLSearchParams {
  const parameters = new URLSearchParams(url.search);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  fragment.forEach((value, key) => parameters.set(key, value));
  return parameters;
}

export function isAuthCallbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "russicaptor:" && url.hostname === "auth" && url.pathname === "/callback";
  } catch {
    return false;
  }
}

export async function consumeAuthCallbackUrl(
  value: string,
  client: AuthClient | undefined = supabase,
): Promise<AuthCallbackResult> {
  if (!client || !isAuthCallbackUrl(value)) return { ok: false, reason: "MALFORMED" };

  const url = new URL(value);
  const parameters = callbackParameters(url);
  if (parameters.has("error") || parameters.has("error_code")) {
    return { ok: false, reason: "EXPIRED_OR_INVALID" };
  }

  const flow = parameters.get("type");
  if (flow !== "invite" && flow !== "recovery") return { ok: false, reason: "MALFORMED" };

  const accessToken = parameters.get("access_token");
  const refreshToken = parameters.get("refresh_token");
  if (!accessToken || !refreshToken) return { ok: false, reason: "MISSING_SESSION" };

  try {
    const { data, error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error || !data.session) return { ok: false, reason: "EXPIRED_OR_INVALID" };
    return { ok: true, flow };
  } catch {
    return { ok: false, reason: "NETWORK" };
  }
}

export function validateNewPassword(password: string, confirmation: string): string | undefined {
  if (password.length < 8) return "Parool peab olema vähemalt 8 märki pikk.";
  if (password !== confirmation) return "Paroolid ei ühti.";
  return undefined;
}

export async function updateAuthenticatedPassword(
  password: string,
  client: AuthClient | undefined = supabase,
): Promise<void> {
  if (!client) throw new Error("Autentimisteenus pole saadaval.");
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error("Paroolilingi seanss puudub või on aegunud.");
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error("Parooli ei saanud uuendada. Kontrolli paroolinõudeid ja proovi uuesti.");
}
