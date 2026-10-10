// Trusted-operator break-glass endpoint. Never import this into the mobile app.
// A verified privileged server credential authenticates the operator;
// a separate random, short-lived authorization is required for each mutation.
import { serviceClient } from "../_shared/platformAdmin.ts";
import { verifyRecoveryOperator } from "./operatorAuth.ts";

type Operation = "GRANT" | "REVOKE";
type RecoveryRequest =
  | { action: "prepare"; operationId: string; targetUserId: string; targetEmail: string; operation: Operation }
  | { action: "apply"; authorizationId: string; operationId: string; targetUserId: string; targetEmail: string; operation: Operation; token: string }
  | { action: "cancel"; authorizationId: string }
  | { action: "status"; operationId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenPattern = /^[0-9a-f]{64}$/;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validUuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error("INVALID_RECOVERY_REQUEST");
  return value.toLowerCase();
}

function validEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!emailPattern.test(email) || email.length > 254) throw new Error("INVALID_RECOVERY_REQUEST");
  return email;
}

function validOperation(value: unknown): Operation {
  if (value !== "GRANT" && value !== "REVOKE") throw new Error("INVALID_RECOVERY_REQUEST");
  return value;
}

async function requireTrustedOperator(request: Request): Promise<void> {
  if (!await verifyRecoveryOperator(request, Deno.env.get("SUPABASE_URL"))) {
    throw new Error("RECOVERY_OPERATOR_REQUIRED");
  }
}

async function tokenSha256(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function operate(body: RecoveryRequest): Promise<Response> {
  const service = serviceClient();
  if (body.action === "cancel") {
    const { data, error } = await service.rpc("trusted_admin_cancel_platform_recovery", {
      p_authorization_id: validUuid(body.authorizationId),
    });
    if (error) throw new Error("RECOVERY_CANCEL_FAILED");
    return response({ ok: true, cancelled: data === true });
  }
  if (body.action === "status") {
    const { data, error } = await service.rpc("trusted_admin_platform_recovery_status", {
      p_operation_id: validUuid(body.operationId),
    });
    if (error) throw new Error("RECOVERY_STATUS_FAILED");
    return response({ ok: true, result: data ?? null });
  }

  const operationId = validUuid(body.operationId);
  const targetUserId = validUuid(body.targetUserId);
  const targetEmail = validEmail(body.targetEmail);
  const operation = validOperation(body.operation);

  if (body.action === "prepare") {
    const token = createToken();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data, error } = await service.rpc("trusted_admin_issue_platform_recovery", {
      p_operation_id: operationId,
      p_target_user_id: targetUserId,
      p_target_email: targetEmail,
      p_operation: operation,
      p_token_sha256: await tokenSha256(token),
      p_expires_at: expiresAt,
    });
    if (error || typeof data !== "string") throw new Error("RECOVERY_PREPARE_FAILED");
    // Returned once to trusted operator tooling, never to the mobile client.
    return response({ ok: true, authorizationId: data, operationId, token, expiresAt }, 201);
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (!tokenPattern.test(token)) throw new Error("INVALID_RECOVERY_REQUEST");
  const { data, error } = await service.rpc("trusted_admin_apply_platform_recovery", {
    p_authorization_id: validUuid(body.authorizationId),
    p_operation_id: operationId,
    p_target_user_id: targetUserId,
    p_target_email: targetEmail,
    p_operation: operation,
    p_token_sha256: await tokenSha256(token),
  });
  if (error) throw new Error("RECOVERY_APPLY_FAILED");
  return response({ ok: true, result: data });
}

Deno.serve(async request => {
  if (request.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    await requireTrustedOperator(request);
    const body = await request.json() as RecoveryRequest;
    if (!body || !["prepare", "apply", "cancel", "status"].includes(body.action)) {
      return response({ ok: false, error: "INVALID_RECOVERY_REQUEST" }, 400);
    }
    return await operate(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["RECOVERY_OPERATOR_REQUIRED", "INVALID_RECOVERY_REQUEST",
      "RECOVERY_PREPARE_FAILED", "RECOVERY_APPLY_FAILED", "RECOVERY_CANCEL_FAILED",
      "RECOVERY_STATUS_FAILED"].includes(message)
      ? message : "RECOVERY_OPERATION_FAILED";
    // No request body, authorization header, token, or raw backend error is logged.
    return response({ ok: false, error: code }, code === "RECOVERY_OPERATOR_REQUIRED" ? 403 : 400);
  }
});
