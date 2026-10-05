import fs from "node:fs"; import path from "node:path";
const root=path.resolve(__dirname,"../../.."); const read=(file:string)=>fs.readFileSync(path.join(root,file),"utf8");
describe("WP-NEXT-06 EXCON diagnostics integration",()=>{
  test("platform administration exposes privacy-safe diagnostics and supported recovery only",()=>{
    expect(read("app/admin/index.tsx")).toContain("Tehnilised üksikasjad");
    expect(read("app/excon/index.tsx")).not.toContain("Diagnostika ja taastamine");
    expect(read("app/_layout.tsx")).toContain('if (isDiagnostics)');
    expect(read("app/_layout.tsx")).toContain('if (!hasPlatformAdminAuthority(operator))');
    const screen=read("app/excon/diagnostics.tsx");
    expect(screen).toContain("captureOperationalDiagnosticSnapshot");
    expect(screen).toContain("refreshRemoteCurrentExercise");
    expect(screen).toContain("takeOverRuntimeWriter");
    expect(screen).toContain("reacquireRuntimeFromRemoteCheckpoint");
    expect(screen).toContain("terminateStaleRuntimeAfterExpiredLease");
    expect(screen).toContain("isSharedWorkflowValidationHarnessEnabled");
    expect(screen).toContain("renewRuntimeLeaseNowForValidation");
    expect(screen).toContain("Uuenda lease kohe (validation)");
    expect(screen).toContain("armNextRuntimeCheckpointPublicationLostResponseForValidation");
    expect(screen).toContain("simuleeri vastuse kadu pärast commit’i");
    expect(screen).toContain('snapshot.runtime.state==="WRITER"');
    expect(screen).toContain("if(pending)return");
    expect(screen).toContain("Lõpeta aegunud Runtime’i õppus turvaliselt");
    expect(screen).toContain('snapshot.runtime.state==="CONFLICT"||snapshot.runtime.state==="FAILED"');
    expect(screen).toContain("kontrollpunkt on aegunud");
    expect(screen).not.toMatch(/delete\(|service_role|access_token|from\("exercise_states"\)/);
  });
  test("missing Runtime termination stays permission-gated and audited",()=>{
    const card=read("components/excon/RuntimeRecoveryCard.tsx");
    const repository=read("services/runtime/exercise/SupabaseExerciseRuntimeRecoveryRepository.ts");
    expect(card).toContain("terminate-missing-runtime");
    expect(repository).toContain("terminate_exercise_with_missing_runtime");
    expect(repository).toContain("exercise_runtime_recovery_audit.latest");
  });
});
