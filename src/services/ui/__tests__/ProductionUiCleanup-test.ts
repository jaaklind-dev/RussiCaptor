import fs from "node:fs";
import path from "node:path";

import {
  accountStatusLabel,
  assignmentStatusLabel,
  exerciseLifecycleLabel,
  publicErrorMessage,
} from "@/localization/et";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("PRODUCTION-UI-CLEANUP-01", () => {
  test("UI-01/UI-02 CM views hide internal patient and Runtime metadata while selectors remain", () => {
    expect(source("src/app/patients.tsx")).not.toContain("<Text style={styles.patientId}>{patient.id}</Text>");
    expect(source("src/app/patient/[id].tsx")).not.toContain("<Text style={styles.patientId}>{patient.id}</Text>");
    const vitals = source("src/components/patient/VitalsTab.tsx");
    expect(vitals).not.toContain("Kanooniline Runtime");
    expect(vitals).not.toContain("state.stateVersion");
    expect(vitals).toContain('testID="canonical-runtime-vitals"');
  });

  test("UI-03 EXCON operational cards hide hashes and internal patient IDs", () => {
    const packageCard = source("src/components/excon/ExercisePackageInformationCard.tsx");
    const definitionCard = source("src/components/excon/ExerciseInformationCard.tsx");
    const patientCard = source("src/components/instructor/InstructorPatientCard.tsx");
    expect(packageCard).not.toMatch(/packageHash|protocolHash|definitionHash/);
    expect(definitionCard).not.toMatch(/protocolHash|enabledAnalyticsProviders|enabledMetricProviders/);
    expect(patientCard).not.toContain("<Text style={styles.patientId}>{patient.patientId}</Text>");
    expect(patientCard).toContain("onPress={() => onPress(patient.patientId)}");
    const excon = source("src/app/excon/index.tsx");
    expect(excon).not.toContain("WorkbookImportCard");
    expect(excon).not.toContain("Diagnostika ja taastamine");
    expect(source("src/app/excon/dashboard.tsx")).not.toContain("Diagnostika ja taastamine");
    const timelineDetail = source("src/app/excon/timeline/[id].tsx");
    expect(timelineDetail).not.toMatch(/Sündmuse ID|Järjekorranumber|Metaandmed|JSON\.stringify/);
    expect(source("src/components/excon/ExerciseTimelineFilterBar.tsx")).not.toContain("Patsiendi ID");
    const metricCard = source("src/components/excon/analytics/MetricCard.tsx");
    expect(metricCard).not.toContain("<Text style={styles.id}>{metric.metricId}</Text>");
    expect(metricCard).not.toContain("{metric.providerId}@{metric.metricVersion}");
    expect(source("src/components/excon/ActivePatientsCard.tsx")).not.toContain("{patient.id} · {patient.name}");
    expect(source("src/components/excon/UpcomingEventsCard.tsx")).not.toContain("{event.patientId}");
    expect(source("src/components/patient/LaboratoryWorkflowCard.tsx")).not.toContain("Proov {sample.sampleId} · sampledAt");
    expect(source("src/components/patient/PatientTransportControls.tsx")).not.toContain("{resource.resourceId}: {resource.state}");
  });

  test("UI-04 admin screens use friendly states and bounded errors", () => {
    expect(accountStatusLabel("ACTIVE")).toBe("Aktiivne");
    expect(assignmentStatusLabel("REVOKED")).toBe("Tühistatud");
    expect(source("src/app/admin/users.tsx")).not.toContain("setMessage(String(error))");
    const exercises = source("src/app/admin/exercises.tsx");
    expect(exercises).not.toContain("setMessage(String(error))");
    expect(exercises).not.toMatch(/bootstrap-|kanoonilise ettevalmistusvooga/);
    expect(publicErrorMessage(new Error("HTTP 500 rpc_internal payload"))).toBe("Toiming ebaõnnestus. Proovi uuesti.");
  });

  test("UI-05 diagnostics are explicit, role-gated and validation controls stay feature-gated", () => {
    const diagnostics = source("src/app/excon/diagnostics.tsx");
    const routeGate = source("src/app/_layout.tsx");
    expect(diagnostics).toContain("Tehnilised üksikasjad");
    expect(diagnostics).not.toContain("snapshot.app.supabaseProjectRef");
    expect(diagnostics).toContain("isSharedWorkflowValidationHarnessEnabled()");
    expect(routeGate).toContain('if (isDiagnostics)');
    expect(routeGate).toContain('if (!hasPlatformAdminAuthority(operator))');
    expect(source("src/app/admin/index.tsx")).toContain("Tehnilised üksikasjad");
  });

  test("UI-06/UI-07 raw errors are bounded and lifecycle labels are localized", () => {
    expect(exerciseLifecycleLabel("RUNNING")).toBe("Käimas");
    expect(exerciseLifecycleLabel("COMPLETED")).toBe("Lõpetatud");
    expect(source("src/app/index.tsx")).not.toContain("cause.message");
    expect(source("src/components/instructor/InspectorCardiacState.tsx")).not.toContain("result.errorCode");
    const instructorEvaluation = source("src/components/excon/evaluation/InstructorEvaluationPanel.tsx");
    expect(instructorEvaluation).not.toMatch(/Human-authored|Saved and confirmed|SOURCE CHANGED|Evaluator |WP-40/);
    const evaluation = source("src/components/excon/evaluation/ExerciseEvaluationSummary.tsx");
    expect(evaluation).not.toMatch(/result\.profileHash|result\.evaluationHash|STANDARD/);
    expect(source("src/components/excon/catalog/ExerciseCatalogScreen.tsx")).not.toContain("ExercisePackageRegistry");
  });

  test("UI-08 terminal/read-only presentation remains explicit", () => {
    expect(source("src/app/patient/[id].tsx")).toContain("Õppus lõpetatud");
    expect(source("src/app/admin/exercises.tsx")).toContain("Terminalne õppus on kirjutuskaitstud.");
  });

  test("UI-09 deterministic semantic selectors remain available", () => {
    expect(source("src/components/excon/NarvaIroScenarioControlsCard.tsx")).toContain("testID={`iro-control-${commandType}`}");
    expect(source("src/components/dashboard/CloudSyncStatusCard.tsx")).toContain('testID="runtime-checkpoint-recovery"');
    expect(source("src/components/excon/ExercisePackageInformationCard.tsx")).toContain('testID="exercise-package-information-card"');
  });

  test("development-only Expo starter route is absent from the production route tree", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src/app/explore.tsx"))).toBe(false);
  });

  test("UI-10 auth screens never render callback parameters, tokens or backend identity", () => {
    const login = source("src/app/index.tsx");
    const callback = source("src/app/auth/callback.tsx");
    const password = source("src/app/auth/set-password.tsx");
    expect(login).not.toContain("build.supabaseProjectRef");
    expect(login).not.toContain("build.gitSha");
    expect(callback).not.toMatch(/access_token|refresh_token|token_hash/);
    expect(password).not.toMatch(/AsyncStorage|console\.(log|info|warn|error)/);
  });
});
