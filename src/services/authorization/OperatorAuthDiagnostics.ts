export type OperatorAuthDiagnosticStage =
  | "SIGN_IN"
  | "SESSION_RESTORE"
  | "USER_LOOKUP"
  | "ROLE_LOOKUP"
  | "BOOTSTRAP_LOOKUP"
  | "ADMIN_LOOKUP"
  | "PROFILE_LOOKUP"
  | "AUTHORITY_REFRESH";

export type OperatorAuthDiagnosticReason =
  | "CONFIGURATION"
  | "NETWORK"
  | "SERVICE_ERROR"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "TIMEOUT"
  | "UNEXPECTED";

/** Deliberately bounded: never pass an error, URL, identity, session, or request body to the logger. */
export function recordOperatorAuthDiagnostic(
  stage: OperatorAuthDiagnosticStage,
  reason: OperatorAuthDiagnosticReason,
): void {
  try { console.warn("OPERATOR_AUTH_DIAGNOSTIC", { stage, reason }); }
  catch { /* Diagnostics must never affect authorization. */ }
}

export function classifyOperatorAuthFailure(error: unknown, status?: number): OperatorAuthDiagnosticReason {
  const code = Number(status ?? (typeof error === "object" && error !== null && "status" in error
    ? error.status : undefined));
  if (code >= 500 && code <= 599) return "SERVICE_ERROR";
  if (code >= 400 && code <= 499) return "HTTP_ERROR";
  if (typeof error === "object" && error !== null) {
    const name = "name" in error ? error.name : undefined;
    const message = "message" in error ? error.message : undefined;
    if (name === "AuthRetryableFetchError" || name === "TypeError" &&
      (message === "Network request failed" || message === "Failed to fetch")) return "NETWORK";
  }
  return "UNEXPECTED";
}
