import { audit, corsHeaders, errorResponse, json, requirePlatformAdmin, type AdminContext } from "../_shared/platformAdmin.ts";

type ExerciseOperation =
  | Readonly<{ operation: "list" }>
  | Readonly<{ operation: "grantBootstrap"; userId: string }>
  | Readonly<{ operation: "grantRole"; userId: string; exerciseId: string; role: "CM" | "EXCON" }>
  | Readonly<{ operation: "revokeRole"; assignmentId: string; exerciseId: string; userId: string; role: "CM" | "EXCON" }>;

const exercisePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
function exerciseId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!exercisePattern.test(id)) throw new Error("INVALID_EXERCISE_ID");
  return id;
}
function userId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("INVALID_USER_ID");
  return id;
}

async function listExercises(context: AdminContext): Promise<Response> {
  const [{ data: states, error: stateError }, { data: assignments, error: assignmentError }, { data: leases, error: leaseError }] = await Promise.all([
    context.service.from("exercise_states").select([
      "exercise_id", "revision", "updated_at", "updated_by",
      "exercise_session:state->exerciseSession",
      "exercise_package_reference:state->exercisePackageReference",
    ].join(",")).order("updated_at", { ascending: false }).limit(200),
    context.service.from("authorization_role_assignments").select("id,user_id,role,scope_id,status,issued_at,revoked_at").eq("scope_type", "EXERCISE"),
    context.service.from("runtime_writer_leases").select("exercise_id,writer_user_id,expires_at,released_at"),
  ]);
  if (stateError || assignmentError || leaseError) throw new Error("EXERCISE_LIST_FAILED");
  return json({ ok: true, exercises: (states ?? []).map(row => {
    const session = row.exercise_session && typeof row.exercise_session === "object"
      ? row.exercise_session as Record<string, unknown> : {};
    const packageReference = row.exercise_package_reference && typeof row.exercise_package_reference === "object"
      ? row.exercise_package_reference as Record<string, unknown> : {};
    const scoped = (assignments ?? []).filter(item => item.scope_id === row.exercise_id);
    const active = scoped.filter(item => item.status === "ACTIVE");
    const lease = (leases ?? []).find(item => item.exercise_id === row.exercise_id && !item.released_at);
    return {
      exerciseId: row.exercise_id,
      revision: row.revision,
      packageId: packageReference.packageId ?? null,
      packageVersion: packageReference.packageVersion ?? null,
      lifecycleState: session.lifecycleState ?? session.state ?? "UNKNOWN",
      updatedAt: row.updated_at,
      participantCount: new Set(active.map(item => item.user_id)).size,
      cmCount: active.filter(item => item.role === "CM").length,
      exconCount: active.filter(item => item.role === "EXCON").length,
      activeWriterUserId: lease?.writer_user_id ?? null,
      assignments: scoped,
    };
  }) });
}

async function assertExerciseMutable(context: AdminContext, id: string): Promise<void> {
  const { data, error } = await context.service.from("exercise_states").select("state").eq("exercise_id", id).maybeSingle();
  if (error || !data) throw new Error("EXERCISE_NOT_FOUND");
  const state = data.state && typeof data.state === "object" ? data.state as Record<string, unknown> : {};
  if (state.lifecycleState === "COMPLETED" || state.lifecycleState === "TERMINATED") throw new Error("TERMINAL_EXERCISE_READ_ONLY");
}

async function operate(context: AdminContext, body: ExerciseOperation): Promise<Response> {
  if (body.operation === "list") return listExercises(context);
  if (!("userId" in body)) throw new Error("INVALID_OPERATION");
  const targetUserId = userId(body.userId);
  if (body.operation === "grantBootstrap") {
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data, error } = await context.service.rpc("trusted_admin_grant_exercise_bootstrap", {
      p_user_id: targetUserId, p_issued_by: context.user.id, p_expires_at: expiresAt,
      p_purpose: "PLATFORM_ADMIN_EXERCISE_CREATE",
    });
    if (error) throw new Error("BOOTSTRAP_GRANT_FAILED");
    await audit(context, "EXERCISE_BOOTSTRAP_GRANTED", "SUCCESS", targetUserId);
    return json({ ok: true, authorization: data });
  }
  const id = exerciseId(body.exerciseId);
  if (body.operation === "grantRole") {
    await assertExerciseMutable(context, id);
    if (body.role !== "CM" && body.role !== "EXCON") throw new Error("INVALID_ROLE");
    const { data, error } = await context.service.rpc("trusted_admin_grant_exercise_role", {
      p_user_id: targetUserId, p_exercise_id: id, p_role: body.role,
      p_issued_by: context.user.id, p_expires_at: null,
    });
    if (error) throw new Error(error.message.includes("CONFLICT") ? "ACTIVE_ASSIGNMENT_CONFLICT" : "ROLE_GRANT_FAILED");
    await audit(context, body.role === "CM" ? "CM_GRANTED" : "EXCON_GRANTED", "SUCCESS", targetUserId, id);
    return json({ ok: true, assignment: data }, 201);
  }
  if (body.role !== "CM" && body.role !== "EXCON") throw new Error("INVALID_ROLE");
  const { data: lease } = await context.service.from("runtime_writer_leases").select("writer_user_id,released_at").eq("exercise_id", id).eq("writer_user_id", targetUserId).is("released_at", null).maybeSingle();
  const { data: owners } = await context.service.from("shared_workflow_patient_states").select("patient_id").eq("exercise_id", id).eq("owner_user_id", targetUserId).limit(1);
  if (lease || owners?.length) throw new Error("ACTIVE_RUNTIME_OWNERSHIP_CONFLICT");
  const { data, error } = await context.service.rpc("trusted_admin_revoke_exercise_role", {
    p_assignment_id: body.assignmentId, p_exercise_id: id, p_revoked_by: context.user.id,
  });
  if (error) throw new Error("ROLE_REVOCATION_FAILED");
  await audit(context, body.role === "CM" ? "CM_REVOKED" : "EXCON_REVOKED", "SUCCESS", targetUserId, id);
  return json({ ok: true, assignment: data });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  let context: AdminContext | undefined;
  let body: ExerciseOperation | undefined;
  try {
    context = await requirePlatformAdmin(request);
    if (request.method === "GET") return await listExercises(context);
    if (request.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    body = await request.json() as ExerciseOperation;
    return await operate(context, body);
  } catch (error) {
    if (context && body && body.operation !== "list") {
      const action = body.operation === "grantBootstrap" ? "EXERCISE_BOOTSTRAP_GRANTED"
        : body.role === "CM" ? (body.operation === "grantRole" ? "CM_GRANTED" : "CM_REVOKED")
          : (body.operation === "grantRole" ? "EXCON_GRANTED" : "EXCON_REVOKED");
      await audit(context, action, "FAILURE", body.userId, "exerciseId" in body ? body.exerciseId : undefined,
        { error: error instanceof Error ? error.message : "ADMIN_OPERATION_FAILED" }).catch(() => undefined);
    }
    return errorResponse(error);
  }
});
