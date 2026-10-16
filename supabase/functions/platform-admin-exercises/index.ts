import { audit, corsHeaders, errorResponse, json, requirePlatformAdmin, type AdminContext } from "../_shared/platformAdmin.ts";
import { isActiveRuntimeWriterLease } from "../_shared/runtimeLease.ts";

type ExerciseOperation =
  | Readonly<{ operation: "list" }>
  | Readonly<{ operation: "grantBootstrap"; userId: string }>
  | Readonly<{ operation: "revokeBootstrap"; userId: string; bootstrapId: string }>
  | Readonly<{ operation: "grantRole"; userId: string; exerciseId: string; role: "CM" | "EXCON" }>
  | Readonly<{ operation: "revokeRole"; assignmentId: string; exerciseId: string; userId: string; role: "CM" | "EXCON" }>
  | Readonly<{ operation: "cancelReady"; exerciseId: string; expectedRevision: number;
    operationId: string; reason: "UNUSED_READY" | "FAILED_START" | "TEST_CLEANUP" }>;

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
function uuidId(value: unknown, errorCode: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(errorCode);
  }
  return id;
}
const bootstrapId = (value: unknown) => uuidId(value, "INVALID_BOOTSTRAP_ID");

async function listExercises(context: AdminContext): Promise<Response> {
  const [{ data: states, error: stateError }, { data: assignments, error: assignmentError }, { data: leases, error: leaseError },
    { data: activation, error: activationError }] = await Promise.all([
    context.service.from("exercise_states").select([
      "exercise_id", "revision", "updated_at", "updated_by",
      "exercise_session:state->exerciseSession",
      "exercise_package_reference:state->exercisePackageReference",
    ].join(",")).order("updated_at", { ascending: false }).limit(200),
    context.service.from("authorization_role_assignments").select("id,user_id,role,scope_id,status,issued_at,revoked_at").eq("scope_type", "EXERCISE"),
    context.service.from("runtime_writer_leases").select("exercise_id,writer_user_id,expires_at,released_at"),
    context.service.from("ready_exercise_cancellation_activation").select("feature_key,enabled")
      .eq("feature_key", "READY_CANCELLATION").maybeSingle(),
  ]);
  if (stateError || assignmentError || leaseError) throw new Error("EXERCISE_LIST_FAILED");
  // The status is advisory for Admin UI only. Missing/unreadable state is OFF;
  // the cancellation RPC enforces the gate transactionally.
  const readyCancellationEnabled = !activationError && activation?.feature_key === "READY_CANCELLATION"
    && activation.enabled === true;
  return json({ ok: true, readyCancellationEnabled, exercises: (states ?? []).map(row => {
    const session = row.exercise_session && typeof row.exercise_session === "object"
      ? row.exercise_session as Record<string, unknown> : {};
    const packageReference = row.exercise_package_reference && typeof row.exercise_package_reference === "object"
      ? row.exercise_package_reference as Record<string, unknown> : {};
    const scoped = (assignments ?? []).filter(item => item.scope_id === row.exercise_id);
    const active = scoped.filter(item => item.status === "ACTIVE");
    const lease = (leases ?? []).find(item => item.exercise_id === row.exercise_id &&
      isActiveRuntimeWriterLease(item));
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
  const session = state.exerciseSession && typeof state.exerciseSession === "object"
    ? state.exerciseSession as Record<string, unknown> : {};
  if (["COMPLETED", "CANCELLED", "TERMINATED"].includes(String(session.lifecycleState ?? ""))) {
    throw new Error("TERMINAL_EXERCISE_READ_ONLY");
  }
}

async function operate(context: AdminContext, body: ExerciseOperation): Promise<Response> {
  if (body.operation === "list") return listExercises(context);
  if (body.operation === "cancelReady") {
    const id = exerciseId(body.exerciseId);
    const operationId = uuidId(body.operationId, "INVALID_CANCELLATION_REQUEST");
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 ||
      !["UNUSED_READY", "FAILED_START", "TEST_CLEANUP"].includes(body.reason)) {
      throw new Error("INVALID_CANCELLATION_REQUEST");
    }
    const { data, error } = await context.service.rpc("trusted_admin_cancel_ready_exercise", {
      p_exercise_id: id, p_expected_revision: body.expectedRevision,
      p_operation_id: operationId, p_reason: body.reason, p_actor_user_id: context.user.id,
    });
    if (error) {
      const code = ["READY_CANCELLATION_DISABLED", "PLATFORM_ADMIN_REQUIRED", "EXERCISE_NOT_FOUND", "REVISION_CONFLICT",
        "EXERCISE_NOT_READY", "ACTIVE_WRITER_PRESENT", "RUNTIME_ACTIVITY_PRESENT",
        "OPERATION_ID_CONFLICT"].find(candidate => error.message.includes(candidate));
      throw new Error(code ?? "READY_CANCELLATION_FAILED");
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.exercise_id !== id || row.lifecycle_state !== "CANCELLED") {
      throw new Error("READY_CANCELLATION_READBACK_FAILED");
    }
    return json({ ok: true, exerciseId: id, revision: row.revision,
      lifecycleState: "CANCELLED", cancelledAt: row.cancelled_at,
      idempotent: row.idempotent });
  }
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
  if (body.operation === "revokeBootstrap") {
    const id = bootstrapId(body.bootstrapId);
    const { data: authorization, error: readError } = await context.service
      .from("exercise_bootstrap_authorizations")
      .select("id,user_id,status,consumed_exercise_id,consumed_at")
      .eq("id", id).eq("user_id", targetUserId).maybeSingle();
    if (readError || !authorization) throw new Error("BOOTSTRAP_NOT_FOUND");
    if (authorization.consumed_exercise_id || authorization.consumed_at) {
      throw new Error("BOOTSTRAP_ALREADY_CONSUMED");
    }
    if (authorization.status !== "REVOKED") {
      const { error } = await context.service.rpc("trusted_admin_revoke_exercise_bootstrap", {
        p_bootstrap_id: id, p_revoked_by: context.user.id,
      });
      if (error) throw new Error(error.message.includes("BOOTSTRAP_ALREADY_CONSUMED")
        ? "BOOTSTRAP_ALREADY_CONSUMED" : "BOOTSTRAP_REVOKE_FAILED");
    }
    await audit(context, "EXERCISE_BOOTSTRAP_REVOKED", "SUCCESS", targetUserId);
    return json({ ok: true, bootstrapId: id });
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
  const { data: lease, error: leaseError } = await context.service.from("runtime_writer_leases")
    .select("writer_user_id,expires_at,released_at").eq("exercise_id", id).eq("writer_user_id", targetUserId).maybeSingle();
  const { data: owners, error: ownerError } = await context.service.from("shared_workflow_patient_states")
    .select("patient_id").eq("exercise_id", id).eq("owner_user_id", targetUserId).limit(1);
  if (leaseError || ownerError) throw new Error("RUNTIME_OWNERSHIP_CHECK_FAILED");
  if ((lease && isActiveRuntimeWriterLease(lease)) || owners?.length) throw new Error("ACTIVE_RUNTIME_OWNERSHIP_CONFLICT");
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
    // Cancellation success is audited in the same SQL transaction as its state
    // and receipt. Rejects never write a cancellation event, including malformed
    // requests rejected before the authoritative activation check can run.
    if (context && body && body.operation !== "list" && body.operation !== "cancelReady") {
      const action = body.operation === "grantBootstrap" ? "EXERCISE_BOOTSTRAP_GRANTED"
        : body.operation === "revokeBootstrap" ? "EXERCISE_BOOTSTRAP_REVOKED"
        : body.role === "CM" ? (body.operation === "grantRole" ? "CM_GRANTED" : "CM_REVOKED")
          : (body.operation === "grantRole" ? "EXCON_GRANTED" : "EXCON_REVOKED");
      await audit(context, action, "FAILURE", body.userId, "exerciseId" in body ? body.exerciseId : undefined,
        { error: error instanceof Error ? error.message : "ADMIN_OPERATION_FAILED" }).catch(() => undefined);
    }
    return errorResponse(error);
  }
});
