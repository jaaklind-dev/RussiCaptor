import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedIdentity } from "@/models/authorization/Authorization";

export type AuthenticationResult =
  | Readonly<{ state: "AUTHENTICATED"; identity: AuthenticatedIdentity }>
  | Readonly<{ state: "UNAUTHENTICATED" }>
  | Readonly<{ state: "UNAVAILABLE" }>;

export class SupabaseAuthenticationAdapter {
  constructor(private readonly client: SupabaseClient) {}
  async currentIdentity(): Promise<AuthenticationResult> {
    try {
      const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
      if (sessionError) return Object.freeze({ state: "UNAVAILABLE" });
      if (!sessionData.session) return Object.freeze({ state: "UNAUTHENTICATED" });
      const { data, error } = await this.client.auth.getUser();
      if (error || !data.user) return Object.freeze({ state: error ? "UNAVAILABLE" : "UNAUTHENTICATED" });
      if (data.user.is_anonymous) return Object.freeze({ state: "UNAUTHENTICATED" });
      return Object.freeze({ state: "AUTHENTICATED", identity: Object.freeze({ userId: data.user.id, email: data.user.email, isAnonymous: false, sessionExpiresAt: sessionData.session.expires_at ? new Date(sessionData.session.expires_at * 1000).toISOString() : undefined }) });
    } catch { return Object.freeze({ state: "UNAVAILABLE" }); }
  }
}
