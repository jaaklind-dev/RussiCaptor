import fs from "node:fs";
import path from "node:path";

import type { RoleAssignment } from "@/models/authorization/Authorization";
import type { RuntimeCheckpointEnvelope, RuntimeWriterLease } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";
import { replaceCanonicalExerciseSnapshot, getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import {
  runtimeWriterAcquisitionAllowed,
  shouldRetryFreshRuntimeBootstrap,
} from "@/services/RuntimeCheckpointSyncService";
import type { OperatorSessionState } from "@/services/authorization/OperatorSessionService";
import { permissionsForRole } from "@/services/authorization/PermissionResolver";
import {
  setRuntimePatientCommandGateway,
  submitPatientRuntimeCommand,
  RuntimePatientCommandConsumer,
  type RuntimePatientCommandGateway,
} from "@/services/runtime/commands/RuntimePatientCommandService";
import {
  acceptRuntimeReaderCheckpoint,
  beginRuntimeReaderConvergence,
  resetRuntimeReaderConvergence,
  runtimeReaderCommandReadiness,
} from "@/services/runtime/persistence/RuntimeReaderConvergenceService";
import {
  observeSharedWorkflowHead,
  resetSharedWorkflowConflictMetrics,
} from "@/services/sharedWorkflow/SharedWorkflowMutationService";

const exerciseId = "EX-CM-HEAD";
const patientId = "PT-PELVIC-001";

function assignment(role: RoleAssignment["role"], scopeId = exerciseId): RoleAssignment {
  return Object.freeze({ assignmentId:`ASSIGN-${role}-${scopeId}`, userId:`USER-${role}`, role,
    scope:Object.freeze({scopeType:"EXERCISE" as const,scopeId}), status:"ACTIVE" as const,
    issuedAt:"2026-09-30T08:00:00.000Z", issuedBy:"EXCON" });
}

function session(...assignments: readonly RoleAssignment[]): OperatorSessionState {
  const roles = assignments.length ? assignments : [assignment("CM")];
  return Object.freeze({ state:"AUTHENTICATED" as const, principal:Object.freeze({
    userId:roles[0].userId, authenticationState:"AUTHENTICATED" as const,
    roleAssignments:Object.freeze(roles), permissions:Object.freeze([...new Set(roles.flatMap(item=>permissionsForRole(item.role)))]),
    authorizationFreshness:"VERIFIED_ONLINE" as const,
    authorizationProvenance:Object.freeze({authority:"SUPABASE_ROLE_ASSIGNMENTS" as const,
      verifiedAt:"2026-09-30T08:00:00.000Z",expiresAt:"2099-01-01T00:00:00.000Z"}),
  }), profile:Object.freeze({userId:roles[0].userId,displayName:"Test operator"}) });
}

function checkpoint(revision = 8): RuntimeCheckpointEnvelope<SharedExerciseState> {
  return Object.freeze({ exerciseId, checkpointRevision:revision, payloadHash:`HASH-${revision}`,
    provenanceHash:`PROVENANCE-${revision}`, persistedRuntimeVersion:1,
    payload:{exerciseSession:{exerciseId,lifecycleState:"RUNNING",simulationTimeSec:240,speed:1,
      version:revision,clockVersion:2,clockInitializedAtSimulationTimeSec:0}} }) as RuntimeCheckpointEnvelope<SharedExerciseState>;
}

describe("CM-HEAD scoped reader authority", () => {
  const exerciseBefore = getCanonicalExerciseSnapshot();

  afterEach(() => {
    resetRuntimeReaderConvergence();
    resetSharedWorkflowConflictMetrics();
    setRuntimePatientCommandGateway(undefined);
    replaceCanonicalExerciseSnapshot(exerciseBefore);
  });

  test("CM-HEAD-G01/G04/G06/G07/G12: only scoped EXCON may acquire writer authority", () => {
    expect(runtimeWriterAcquisitionAllowed(session(assignment("CM")), exerciseId)).toBe(false);
    expect(runtimeWriterAcquisitionAllowed(session(assignment("CM", "EX-OTHER")), exerciseId)).toBe(false);
    expect(runtimeWriterAcquisitionAllowed(session(assignment("EXCON", "EX-OTHER")), exerciseId)).toBe(false);
    expect(runtimeWriterAcquisitionAllowed(session(assignment("EXCON")), exerciseId)).toBe(true);
    expect(runtimeWriterAcquisitionAllowed({state:"LOADING"}, exerciseId)).toBe(false);
  });

  test("CM-HEAD-G02/G08/G11: reader fails closed before canonical state then becomes ready without stale denial", () => {
    beginRuntimeReaderConvergence(exerciseId);
    expect(runtimeReaderCommandReadiness(exerciseId,240)).toMatchObject({ready:false});
    acceptRuntimeReaderCheckpoint(checkpoint(),"REMOTE");
    observeSharedWorkflowHead(exerciseId,patientId,0,"USER-CM");
    expect(runtimeReaderCommandReadiness(exerciseId,240)).toEqual({ready:true});
  });

  test("CM-HEAD-G03/G05: ready reader submits once and writer consumer materializes once", async () => {
    replaceCanonicalExerciseSnapshot({exerciseId,lifecycleState:"RUNNING",simulationTimeSec:240,speed:1,
      version:8,clockVersion:2,clockInitializedAtSimulationTimeSec:0});
    beginRuntimeReaderConvergence(exerciseId);
    acceptRuntimeReaderCheckpoint(checkpoint(),"REMOTE");
    observeSharedWorkflowHead(exerciseId,patientId,0,"USER-CM");
    const accepted = Object.freeze({exerciseId,patientId,commandId:"P01-MOVE-ED",commandType:"PATIENT_LOCATION_TRANSFER" as const,
      commandSequence:1,patientBaseRevision:0,patientResultingRevision:1,simulationTimeSec:240,
      payload:Object.freeze({actionId:"P01-MOVE-ED"}),actorUserId:"USER-CM"});
    const submit = jest.fn(async () => Object.freeze({status:"APPLIED" as const,commandSequence:1,
      patientRevision:1,ownerUserId:"USER-CM"}));
    const record = jest.fn(async () => undefined);
    const loadAfter=jest.fn()
      .mockResolvedValueOnce(Object.freeze([accepted]))
      .mockResolvedValue(Object.freeze([]));
    const gateway: RuntimePatientCommandGateway = {submit,loadAfter,record};
    setRuntimePatientCommandGateway(gateway);
    await expect(submitPatientRuntimeCommand({exerciseId,patientId,commandId:"P01-MOVE-ED",
      commandType:"PATIENT_LOCATION_TRANSFER",payload:Object.freeze({actionId:"P01-MOVE-ED"})}))
      .resolves.toMatchObject({status:"APPLIED",commandSequence:1});
    const materialize=jest.fn(async()=>Object.freeze({status:"MATERIALIZED" as const,result:Object.freeze({locationId:"NARVA_ED"})}));
    const consumer=new RuntimePatientCommandConsumer(gateway,materialize,()=>240);
    const lease={leaseId:"LEASE-1",exerciseId,writerInstanceId:"WRITER-1",userId:"USER-EXCON",
      expiresAt:"2099-01-01T00:00:00.000Z"} satisfies RuntimeWriterLease;
    await consumer.drain(exerciseId,lease);
    await consumer.drain(exerciseId,lease);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(materialize).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });

  test("CM-HEAD-G09/G10: late scoped role, reconnect and takeover signals re-evaluate reader startup", () => {
    const base={exerciseId,activeLifecycle:true,packageBindingVersion:4,cloudConnected:true,foregroundEpoch:0};
    expect(shouldRetryFreshRuntimeBootstrap({...base,scopedAuthorityReady:false},
      {...base,scopedAuthorityReady:true},{state:"READER",code:"AUTHORIZATION_DENIED"})).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap({...base,scopedAuthorityReady:true},
      {...base,scopedAuthorityReady:true,foregroundEpoch:1},{state:"READER"})).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap({...base,scopedAuthorityReady:true},
      {...base,scopedAuthorityReady:true,cloudConnected:false},{state:"READER"})).toBe(true);
    expect(shouldRetryFreshRuntimeBootstrap({...base,scopedAuthorityReady:true,packageBindingVersion:3},
      {...base,scopedAuthorityReady:true},{state:"READER",revision:447})).toBe(false);
  });

  test("startup routes CM directly to canonical reader state and retains writer-only head creation", () => {
    const source=fs.readFileSync(path.join(process.cwd(),"src/services/RuntimeCheckpointSyncService.ts"),"utf8");
    const startup=source.slice(source.indexOf("async function startRuntimeCheckpointSyncForExercise"),
      source.indexOf("let publishInFlight=false"));
    const readerGuard=startup.indexOf("if (!runtimeWriterAcquisitionAllowed(getOperatorSession(),exerciseId))");
    const acquire=startup.indexOf("acquireRuntimeWriterTerminal",readerGuard);
    expect(readerGuard).toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(readerGuard);
    expect(startup.slice(readerGuard,acquire)).toContain("acceptReaderCheckpoint(remote");
    expect(startup.slice(readerGuard,acquire)).not.toContain("ensureWorkflowHeads()");
    expect(startup.slice(acquire)).toContain("ensureWorkflowHeads()");
    expect(source).toContain('return setAndReturn({state:"READER",code:"AUTHORIZATION_DENIED"})');
  });
});
