import { audit, corsHeaders, errorResponse, json, requirePlatformAdmin, type AdminContext } from "../_shared/platformAdmin.ts";

type UserOperation =
  | Readonly<{ operation: "list" }>
  | Readonly<{ operation: "invite"; email: string; displayName: string }>
  | Readonly<{ operation: "resetPassword"; email: string }>
  | Readonly<{ operation: "deactivate" | "reactivate"; userId: string }>;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const canonicalRedirect = "russicaptor://auth/callback";

function authRedirect(): string {
  const configured = Deno.env.get("ADMIN_AUTH_REDIRECT_URL")?.trim();
  if (configured !== canonicalRedirect) throw new Error("AUTH_REDIRECT_NOT_CONFIGURED");
  return configured;
}

function validEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!emailPattern.test(email) || email.length > 254) throw new Error("INVALID_EMAIL");
  return email;
}

async function listUsers(context: AdminContext): Promise<Response> {
  const users = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await context.service.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error("USER_LIST_FAILED");
    users.push(...data.users);
    if (data.users.length < 100) break;
  }
  const userIds = users.map(user => user.id);
  const [{ data: profiles, error: profileError }, { data: assignments, error: assignmentError }] = await Promise.all([
    userIds.length ? context.service.from("operator_profiles").select("user_id,display_name,status,created_at,updated_at").in("user_id", userIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? context.service.from("authorization_role_assignments").select("id,user_id,role,scope_id,status,issued_at,revoked_at").in("user_id", userIds).eq("scope_type", "EXERCISE") : Promise.resolve({ data: [], error: null }),
  ]);
  if (profileError || assignmentError) throw new Error("USER_METADATA_LIST_FAILED");
  return json({ ok: true, users: users.map(user => ({
    userId: user.id,
    email: user.email ?? "",
    displayName: profiles?.find(profile => profile.user_id === user.id)?.display_name ?? "",
    status: profiles?.find(profile => profile.user_id === user.id)?.status ?? (user.banned_until ? "DISABLED" : "INVITED"),
    invitedAt: user.invited_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    assignments: (assignments ?? []).filter(assignment => assignment.user_id === user.id),
  })) });
}

async function ensureDeactivationSafe(context: AdminContext, userId: string): Promise<void> {
  const [{ data: assignments }, { data: bootstraps }, { data: leases }, { data: owners }] = await Promise.all([
    context.service.from("authorization_role_assignments").select("id,scope_id,role").eq("user_id", userId).eq("status", "ACTIVE"),
    context.service.from("exercise_bootstrap_authorizations").select("id").eq("user_id", userId).eq("status", "ACTIVE"),
    context.service.from("runtime_writer_leases").select("exercise_id").eq("writer_user_id", userId).is("released_at", null),
    context.service.from("shared_workflow_patient_states").select("exercise_id,patient_id").eq("owner_user_id", userId),
  ]);
  if ((leases?.length ?? 0) || (owners?.length ?? 0)) throw new Error("ACTIVE_RUNTIME_OWNERSHIP_CONFLICT");
  if ((assignments ?? []).some(assignment => !assignment.scope_id)) throw new Error("GLOBAL_ASSIGNMENT_REQUIRES_TRUSTED_RECOVERY");
  for (const assignment of assignments ?? []) {
    const { error } = await context.service.rpc("trusted_admin_revoke_exercise_role", {
      p_assignment_id: assignment.id,
      p_exercise_id: assignment.scope_id,
      p_revoked_by: context.user.id,
    });
    if (error) throw new Error("ROLE_REVOCATION_FAILED");
    await audit(context, assignment.role === "CM" ? "CM_REVOKED" : "EXCON_REVOKED", "SUCCESS", userId, assignment.scope_id);
  }
  for (const bootstrap of bootstraps ?? []) {
    const { error } = await context.service.rpc("trusted_admin_revoke_exercise_bootstrap", {
      p_bootstrap_id: bootstrap.id, p_revoked_by: context.user.id,
    });
    if (error) throw new Error("BOOTSTRAP_REVOCATION_FAILED");
  }
}

async function operate(context: AdminContext, body: UserOperation): Promise<Response> {
  if (body.operation === "list") return listUsers(context);
  if (body.operation === "invite") {
    const email = validEmail(body.email);
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!displayName || displayName.length > 120) throw new Error("INVALID_DISPLAY_NAME");
    const { data, error } = await context.service.auth.admin.inviteUserByEmail(email, {
      data: { display_name: displayName }, redirectTo: authRedirect(),
    });
    if (error || !data.user) throw new Error(error?.code === "email_exists" ? "USER_ALREADY_EXISTS" : "USER_INVITE_FAILED");
    const { error: profileError } = await context.service.rpc("trusted_admin_upsert_operator_profile", {
      p_user_id: data.user.id, p_display_name: displayName, p_status: "ACTIVE", p_updated_by: context.user.id,
    });
    if (profileError) throw new Error("PROFILE_CREATE_FAILED");
    await audit(context, "USER_INVITED", "SUCCESS", data.user.id, undefined, { email });
    return json({ ok: true, userId: data.user.id, status: "INVITATION_SENT" }, 201);
  }
  if (body.operation === "resetPassword") {
    const email = validEmail(body.email);
    const { error } = await context.service.auth.resetPasswordForEmail(email, { redirectTo: authRedirect() });
    if (error) throw new Error("PASSWORD_RESET_FAILED");
    await audit(context, "PASSWORD_RESET_REQUESTED", "SUCCESS", undefined, undefined, { email });
    return json({ ok: true, status: "RESET_SENT" });
  }
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("INVALID_USER_ID");
  const { data: target, error: targetError } = await context.service.auth.admin.getUserById(userId);
  if (targetError || !target.user) throw new Error("USER_NOT_FOUND");
  if (body.operation === "deactivate") {
    if (userId === context.user.id) throw new Error("SELF_DEACTIVATION_DENIED");
    await ensureDeactivationSafe(context, userId);
    const { error } = await context.service.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (error) throw new Error("USER_DEACTIVATION_FAILED");
    const displayName = String(target.user.user_metadata?.display_name || target.user.email || "Deactivated operator").slice(0, 120);
    const { error: profileError } = await context.service.rpc("trusted_admin_upsert_operator_profile", {
      p_user_id: userId, p_display_name: displayName, p_status: "DISABLED", p_updated_by: context.user.id,
    });
    if (profileError) throw new Error("PROFILE_DISABLE_FAILED");
    await audit(context, "USER_DEACTIVATED", "SUCCESS", userId);
    return json({ ok: true, status: "DISABLED" });
  }
  const { error } = await context.service.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (error) throw new Error("USER_REACTIVATION_FAILED");
  const displayName = String(target.user.user_metadata?.display_name || target.user.email || "Operator").slice(0, 120);
  const { error: profileError } = await context.service.rpc("trusted_admin_upsert_operator_profile", {
    p_user_id: userId, p_display_name: displayName, p_status: "ACTIVE", p_updated_by: context.user.id,
  });
  if (profileError) throw new Error("PROFILE_REACTIVATION_FAILED");
  await audit(context, "USER_REACTIVATED", "SUCCESS", userId);
  return json({ ok: true, status: "ACTIVE" });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let context: AdminContext | undefined;
  let body: UserOperation | undefined;
  try {
    context = await requirePlatformAdmin(request);
    if (request.method === "GET") return await listUsers(context);
    if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    body = await request.json() as UserOperation;
    return await operate(context, body);
  } catch (error) {
    if (context && body && body.operation !== "list") {
      const actions = { invite: "USER_INVITED", resetPassword: "PASSWORD_RESET_REQUESTED", deactivate: "USER_DEACTIVATED", reactivate: "USER_REACTIVATED" } as const;
      const target = "userId" in body ? body.userId : undefined;
      await audit(context, actions[body.operation], "FAILURE", target, undefined, { error: error instanceof Error ? error.message : "ADMIN_OPERATION_FAILED" }).catch(() => undefined);
    }
    return errorResponse(error);
  }
});
