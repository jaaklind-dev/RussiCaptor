import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedIdentity } from "@/models/authorization/Authorization";
import { classifyOperatorAuthFailure, recordOperatorAuthDiagnostic } from "./OperatorAuthDiagnostics";

export type AuthenticationResult =
  | Readonly<{ state: "AUTHENTICATED"; identity: AuthenticatedIdentity }>
  | Readonly<{ state: "UNAUTHENTICATED" }>
  | Readonly<{ state: "UNAVAILABLE" }>;

export class SupabaseAuthenticationAdapter {
  constructor(private readonly client: SupabaseClient) {}
  async currentIdentity(): Promise<AuthenticationResult> {
    let stage: "SESSION_RESTORE" | "USER_LOOKUP" = "SESSION_RESTORE";
    try {
      const { data: sessionData, error: sessionError } = await this.client.auth.getSession();
      if (sessionError) {
        if ([401, 403].includes(Number(sessionError.status))) return Object.freeze({ state: "UNAUTHENTICATED" });
        recordOperatorAuthDiagnostic("SESSION_RESTORE", classifyOperatorAuthFailure(sessionError));
        return Object.freeze({ state: "UNAVAILABLE" });
      }
      if (!sessionData.session) return Object.freeze({ state: "UNAUTHENTICATED" });
      stage = "USER_LOOKUP";
      const { data, error } = await this.client.auth.getUser();
      if (error) {
        if ([401, 403].includes(Number(error.status))) return Object.freeze({ state: "UNAUTHENTICATED" });
        recordOperatorAuthDiagnostic("USER_LOOKUP", classifyOperatorAuthFailure(error));
        return Object.freeze({ state: "UNAVAILABLE" });
      }
      if (!data.user) {
        recordOperatorAuthDiagnostic("USER_LOOKUP", "INVALID_RESPONSE");
        return Object.freeze({ state: "UNAUTHENTICATED" });
      }
      if (data.user.is_anonymous) return Object.freeze({ state: "UNAUTHENTICATED" });
      return Object.freeze({ state: "AUTHENTICATED", identity: Object.freeze({ userId: data.user.id, email: data.user.email, isAnonymous: false, sessionExpiresAt: sessionData.session.expires_at ? new Date(sessionData.session.expires_at * 1000).toISOString() : undefined }) });
    } catch (cause) {
      recordOperatorAuthDiagnostic(stage, classifyOperatorAuthFailure(cause));
      return Object.freeze({ state: "UNAVAILABLE" });
    }
  }
}
