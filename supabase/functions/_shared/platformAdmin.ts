import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.8";

export const corsHeaders = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
});

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

export function serviceClient(): SupabaseClient {
  const secret = Deno.env.get("SUPABASE_SECRET_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!secret) throw new Error("MISSING_SERVER_ADMIN_CREDENTIAL");
  return createClient(requiredEnvironment("SUPABASE_URL"), secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type AdminContext = Readonly<{ user: User; service: SupabaseClient }>;

export async function requirePlatformAdmin(request: Request): Promise<AdminContext> {
  const authorization = request.headers.get("Authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) throw new Response("AUTHENTICATION_REQUIRED", { status: 401 });
  const service = serviceClient();
  const token = authorization.slice("Bearer ".length);
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) throw new Response("AUTHENTICATION_REQUIRED", { status: 401 });
  const { data: administrator, error: authorityError } = await service
    .from("platform_admins").select("user_id,status").eq("user_id", data.user.id).eq("status", "ACTIVE").maybeSingle();
  if (authorityError) throw new Response("ADMIN_AUTHORITY_UNAVAILABLE", { status: 503 });
  if (!administrator) throw new Response("PLATFORM_ADMIN_REQUIRED", { status: 403 });
  return Object.freeze({ user: data.user, service });
}

export async function audit(
  context: AdminContext,
  action: string,
  outcome: "SUCCESS" | "FAILURE" | "DENIED",
  targetUserId?: string,
  exerciseId?: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await context.service.rpc("trusted_admin_record_action", {
    p_actor_user_id: context.user.id,
    p_action: action,
    p_target_user_id: targetUserId ?? null,
    p_exercise_id: exerciseId ?? null,
    p_outcome: outcome,
    p_details: details,
  });
  if (error) throw new Error("ADMIN_AUDIT_WRITE_FAILED");
}

export function errorResponse(error: unknown): Response {
  if (error instanceof Response) return new Response(JSON.stringify({ ok: false, error: error.statusText || "REQUEST_DENIED" }), {
    status: error.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  const code = error instanceof Error ? error.message : "ADMIN_OPERATION_FAILED";
  return json({ ok: false, error: code }, code.includes("NOT_FOUND") ? 404 : code.includes("CONFLICT") ? 409 : 400);
}

