import Constants from "expo-constants";

import { getBuildProvenance } from "@/config/ReleaseConfig";
import { getCanonicalExerciseSnapshot } from "@/repositories/ExerciseSessionRepository";
import { getCloudSyncOperationalState } from "@/services/CloudSyncService";
import { getOperatorSession, hasActiveRole } from "@/services/authorization/OperatorSessionService";
import { getLocalRuntimeCheckpoint, getLocalSaveStatus } from "@/services/StatePersistenceService";
import { getRuntimeCheckpointOperationalState } from "@/services/RuntimeCheckpointSyncService";
import { getRuntimePersistenceFailure } from "@/services/runtime/persistence/RuntimePersistenceFailureState";
import { getSharedWorkflowOperationalState } from "@/services/sharedWorkflow/SharedWorkflowMutationService";

export const operationalSeverities = ["INFO", "DEGRADED", "ACTION_REQUIRED", "EXERCISE_BLOCKING"] as const;
export type OperationalSeverity = typeof operationalSeverities[number];
export type OperationalIssue = Readonly<{
  code: string;
  severity: OperationalSeverity;
  title: string;
  explanation: string;
  scope: "DEVICE" | "NETWORK" | "AUTH" | "EXERCISE" | "RUNTIME" | "PERSISTENCE";
  dataIntegrityRisk: boolean;
  nextAction: string;
}>;

export type OperationalDiagnosticSnapshot = Readonly<{
  capturedAt: string;
  app: Readonly<{ version: string; versionCode: string; gitSha: string; environment: string; supabaseProjectRef?: string }>;
  session: Readonly<{ state: string; exconScope: "ALLOWED" | "DENIED"; recoveryPermission: "ALLOWED" | "DENIED"; roleScopes: readonly string[] }>;
  exercise: Readonly<{ exerciseId: string; lifecycle: string; simulationTimeSec: number; localProjectionRevision?: number; authoritativeWorkflowRevision: number }>;
  runtime: ReturnType<typeof getRuntimeCheckpointOperationalState> & Readonly<{ localCheckpointRevision?: number; durableCache: "VALID" | "MISSING_OR_DIFFERENT_EXERCISE" }>;
  sync: ReturnType<typeof getCloudSyncOperationalState> & Readonly<{ localSaveState: string; localSavedAt?: string; pendingMutationCount: number; unresolvedConflictCount: number }>;
  issues: readonly OperationalIssue[];
}>;

function issue(input: OperationalIssue): OperationalIssue { return Object.freeze(input); }

export function diagnoseOperationalState(input?: Readonly<{
  sessionState?: string; exconAllowed?: boolean; recoveryAllowed?: boolean; lifecycle?: string;
  cloudState?: string; runtimeState?: string; runtimeCode?: string; persistenceMissing?: boolean;
  unresolvedConflicts?: number;
}>): readonly OperationalIssue[] {
  const issues: OperationalIssue[] = [];
  if (input?.sessionState !== "AUTHENTICATED") issues.push(issue({code:"AUTH_REQUIRED",severity:"ACTION_REQUIRED",title:"Autentimine on vajalik",explanation:"Eelisõigusega taastamistoimingud on peatatud, kuni operaatori sessioon on kontrollitud.",scope:"AUTH",dataIntegrityRisk:false,nextAction:"Logi uuesti sisse ja kontrolli EXCON-i õigust."}));
  else if (!input.exconAllowed) issues.push(issue({code:"EXCON_SCOPE_MISSING",severity:"ACTION_REQUIRED",title:"EXCON-i õigus puudub",explanation:"Selle õppuse juhtimis- ja taastamistoimingud pole lubatud.",scope:"AUTH",dataIntegrityRisk:false,nextAction:"Palu administraatoril kontrollida aktiivset õppuse scope’i."}));
  if (input?.persistenceMissing) issues.push(issue({code:"CHECKPOINT_MISSING",severity:"EXERCISE_BLOCKING",title:"Runtime’i kontrollpunkt puudub",explanation:"RUNNING õppust ei saa kliinilist olekut fabritseerimata taastada.",scope:"PERSISTENCE",dataIntegrityRisk:true,nextAction:input?.recoveryAllowed?"Kasuta toetatud auditeeritud lõpetamist EXCON-i töölaual.":"Taastamiseks puudub õigus; võta ühendust volitatud EXCON-iga."}));
  if (["offline","error","disabled"].includes(input?.cloudState ?? "")) issues.push(issue({code:"BACKEND_UNREACHABLE",severity:"DEGRADED",title:"Backend pole kättesaadav",explanation:"Autoriteetseid muudatusi ei kinnitata enne ühenduse taastumist.",scope:"NETWORK",dataIntegrityRisk:false,nextAction:"Kontrolli võrku, oota ühendust ja värskenda autoriteetne seis."}));
  if (["CONFLICT","FAILED"].includes(input?.runtimeState ?? "")) issues.push(issue({code:"RUNTIME_ACTION_REQUIRED",severity:"ACTION_REQUIRED",title:"Runtime vajab sekkumist",explanation:"Selle seadme Runtime pole praegu autoriteetne.",scope:"RUNTIME",dataIntegrityRisk:true,nextAction:input?.runtimeCode==="CHECKPOINT_REVISION_CONFLICT"?"Taasta pilve kontrollpunktist.":"Kontrolli lease’i ja kasuta ainult toetatud takeover/recovery toimingut."}));
  if ((input?.unresolvedConflicts ?? 0)>0) issues.push(issue({code:"WORKFLOW_STALE",severity:"ACTION_REQUIRED",title:"Patsienditöövoog vajab värskendamist",explanation:"Teine CM muutis autoriteetset patsiendiseisu.",scope:"EXERCISE",dataIntegrityRisk:false,nextAction:"Taasta ühendus ja laadi autoriteetne seis enne uut muudatust."}));
  if (!issues.length) issues.push(issue({code:"OPERATIONAL",severity:"INFO",title:"Operatsiooniseis on normaalne",explanation:"Teadaolevaid blokeerivaid recovery-probleeme ei ole.",scope:"EXERCISE",dataIntegrityRisk:false,nextAction:"Jätka tavapärast jälgimist."}));
  return Object.freeze(issues);
}

export function captureOperationalDiagnosticSnapshot(now = new Date()): OperationalDiagnosticSnapshot {
  const build = getBuildProvenance();
  const session = getOperatorSession();
  const exercise = getCanonicalExerciseSnapshot();
  const cloud = getCloudSyncOperationalState(exercise.exerciseId);
  const runtime = getRuntimeCheckpointOperationalState();
  const checkpoint = getLocalRuntimeCheckpoint();
  const localSave = getLocalSaveStatus();
  const workflow = getSharedWorkflowOperationalState();
  const exconAllowed = hasActiveRole(session,"EXCON",exercise.exerciseId);
  const recoveryAllowed = session.state === "AUTHENTICATED" && exconAllowed && session.principal.permissions.includes("EXERCISE_RUNTIME_RECOVERY");
  const roleScopes = session.state === "AUTHENTICATED" ? session.principal.roleAssignments.filter(item=>item.status==="ACTIVE").map(item=>`${item.role}:${item.scope.scopeType}${item.scope.scopeType==="EXERCISE"&&item.scope.scopeId===exercise.exerciseId?":CURRENT":""}`) : [];
  const persistenceMissing = getRuntimePersistenceFailure()?.exerciseId === exercise.exerciseId;
  const issues = diagnoseOperationalState({sessionState:session.state,exconAllowed,recoveryAllowed,lifecycle:exercise.lifecycleState,
    cloudState:cloud.state,runtimeState:runtime.state,runtimeCode:runtime.code,persistenceMissing,unresolvedConflicts:workflow.unresolvedConflictCount});
  return Object.freeze({capturedAt:now.toISOString(),app:Object.freeze({version:Constants.expoConfig?.version??"unknown",versionCode:build.versionCode,gitSha:build.gitSha,environment:build.environment,supabaseProjectRef:build.supabaseProjectRef}),
    session:Object.freeze({state:session.state,exconScope:exconAllowed?"ALLOWED":"DENIED",recoveryPermission:recoveryAllowed?"ALLOWED":"DENIED",roleScopes:Object.freeze(roleScopes)}),
    exercise:Object.freeze({exerciseId:exercise.exerciseId,lifecycle:exercise.lifecycleState,simulationTimeSec:exercise.simulationTimeSec,localProjectionRevision:cloud.authoritativeProjectionRevision,authoritativeWorkflowRevision:workflow.authoritativeRevision}),
    runtime:Object.freeze({...runtime,localCheckpointRevision:checkpoint?.exerciseId===exercise.exerciseId?checkpoint.checkpointRevision:undefined,durableCache:checkpoint?.exerciseId===exercise.exerciseId?"VALID":"MISSING_OR_DIFFERENT_EXERCISE"}),
    sync:Object.freeze({...cloud,localSaveState:localSave.state,localSavedAt:localSave.savedAt,pendingMutationCount:workflow.pendingMutationCount,unresolvedConflictCount:workflow.unresolvedConflictCount}),issues});
}

/** Privacy-safe export: the diagnostic model structurally contains no patient payload, credentials, tokens, or user IDs. */
export function exportOperationalDiagnostics(snapshot: OperationalDiagnosticSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
