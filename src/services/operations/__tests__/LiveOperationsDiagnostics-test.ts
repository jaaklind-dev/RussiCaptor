import { diagnoseOperationalState, exportOperationalDiagnostics, type OperationalDiagnosticSnapshot } from "../LiveOperationsDiagnostics";

describe("WP-NEXT-06 live operations diagnostics", () => {
  test.each([
    [{sessionState:"UNAUTHENTICATED"},"AUTH_REQUIRED","ACTION_REQUIRED"],
    [{sessionState:"AUTHENTICATED",exconAllowed:false},"EXCON_SCOPE_MISSING","ACTION_REQUIRED"],
    [{sessionState:"AUTHENTICATED",exconAllowed:true,recoveryAllowed:true,persistenceMissing:true},"CHECKPOINT_MISSING","EXERCISE_BLOCKING"],
    [{sessionState:"AUTHENTICATED",exconAllowed:true,cloudState:"offline"},"BACKEND_UNREACHABLE","DEGRADED"],
    [{sessionState:"AUTHENTICATED",exconAllowed:true,runtimeState:"CONFLICT",runtimeCode:"CHECKPOINT_REVISION_CONFLICT"},"RUNTIME_ACTION_REQUIRED","ACTION_REQUIRED"],
    [{sessionState:"AUTHENTICATED",exconAllowed:true,unresolvedConflicts:1},"WORKFLOW_STALE","ACTION_REQUIRED"],
  ])("classifies deterministic failure state %j",(input,code,severity)=>{
    expect(diagnoseOperationalState(input).some(item=>item.code===code&&item.severity===severity)).toBe(true);
  });

  test("healthy state is explicit and export contains no patient or credential fields",()=>{
    expect(diagnoseOperationalState({sessionState:"AUTHENTICATED",exconAllowed:true,cloudState:"synced",runtimeState:"WRITER"})).toEqual([
      expect.objectContaining({code:"OPERATIONAL",severity:"INFO"}),
    ]);
    const exported=exportOperationalDiagnostics({capturedAt:"2026-08-29T00:00:00.000Z",app:{version:"1",versionCode:"1",gitSha:"abc",environment:"production"},session:{state:"AUTHENTICATED",exconScope:"ALLOWED",recoveryPermission:"ALLOWED",roleScopes:["EXCON:EXERCISE:CURRENT"]},exercise:{exerciseId:"EX-1",lifecycle:"RUNNING",simulationTimeSec:0,authoritativeWorkflowRevision:2},runtime:{state:"WRITER",revision:3,durableCache:"VALID"},sync:{state:"synced",realtimeConnected:true,remoteSelectionState:"RESOLVED",localSaveState:"saved",pendingMutationCount:0,unresolvedConflictCount:0},issues:[]} as unknown as OperationalDiagnosticSnapshot);
    expect(exported).toContain('"exerciseId": "EX-1"');
    expect(exported).not.toMatch(/patient|password|token|publishableKey|service.role|userId/i);
  });
});
