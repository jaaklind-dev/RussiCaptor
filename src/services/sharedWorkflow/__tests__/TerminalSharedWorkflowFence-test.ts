import fs from "fs";
import path from "path";

import { InMemorySharedWorkflowGateway } from "../InMemorySharedWorkflowGateway";
import {
  classifySharedWorkflowError,
  resetSharedWorkflowConflictMetrics,
  setSharedWorkflowConnectivity,
  setSharedWorkflowGateway,
  sharedWorkflowStatusMessage,
  submitSharedWorkflowMutation,
  type SharedWorkflowMutationKind,
  type SharedWorkflowMutationRequest,
} from "../SharedWorkflowMutationService";

const migration = fs.readFileSync(path.resolve(process.cwd(),
  "supabase/migrations/20260909055656_fence_shared_workflow_mutations_after_completion.sql"), "utf8");
const baselineState = Object.freeze({ notes: [], timelineEvents: [], interventions: [],
  medicationAdministrations: [], vitalSigns: [] });
const actor = Object.freeze({ userId: "CM-A", role: "CM" as const, exerciseIds: ["EX-A"] });
const request = (kind: SharedWorkflowMutationKind, commandId = `CMD-${kind}`): SharedWorkflowMutationRequest => Object.freeze({
  exerciseId: "EX-A", patientId: "P-1", commandId, kind, expectedRevision: 4,
  expectedOwnerUserId: "CM-A",
  nextOwnerUserId: kind === "RELEASE" ? undefined : kind === "TRANSFER" ? "CM-B" : "CM-A",
  state: baselineState,
});

describe("WP-NARVA-07K terminal shared-workflow immutability", () => {
  beforeEach(() => { resetSharedWorkflowConflictMetrics(); setSharedWorkflowConnectivity(true); });
  afterEach(() => setSharedWorkflowGateway(undefined));

  it.each(["CLAIM", "RELEASE", "TRANSFER_REQUEST", "TRANSFER", "MUTABLE"] as const)(
    "rejects post-completion %s without changing the patient head or command ledger",
    async kind => {
      const gateway = new InMemorySharedWorkflowGateway(() => actor);
      gateway.seed("EX-A", "P-1", baselineState, "CM-A", 4);
      gateway.complete("EX-A");

      expect(await gateway.submit(request(kind))).toMatchObject({ status: "EXERCISE_COMPLETED", revision: 4 });
      expect(gateway.read("EX-A", "P-1")?.revision).toBe(4);
      expect(gateway.acceptedCount("EX-A")).toBe(0);
    },
  );

  it("rejects after the pending completion fence with the stable domain result", async () => {
    const gateway = new InMemorySharedWorkflowGateway(() => actor);
    gateway.seed("EX-A", "P-1", baselineState, "CM-A", 4);
    gateway.fence("EX-A");
    expect(await gateway.submit(request("MUTABLE"))).toMatchObject({ status: "COMPLETION_FENCED", revision: 4 });
  });

  it("preserves an accepted pre-fence mutation and rejects every later mutation", async () => {
    const gateway = new InMemorySharedWorkflowGateway(() => actor);
    gateway.seed("EX-A", "P-1", baselineState, "CM-A", 4);
    expect(await gateway.submit(request("MUTABLE", "BEFORE-FENCE"))).toMatchObject({ status: "APPLIED", revision: 5 });
    gateway.fence("EX-A");
    expect(await gateway.submit({ ...request("MUTABLE", "AFTER-FENCE"), expectedRevision: 5 })).toMatchObject({
      status: "COMPLETION_FENCED", revision: 5,
    });
    expect(gateway.acceptedCount("EX-A")).toBe(1);
  });

  it("keeps exact duplicate retries idempotent after terminal completion", async () => {
    const gateway = new InMemorySharedWorkflowGateway(() => actor);
    gateway.seed("EX-A", "P-1", baselineState, "CM-A", 4);
    const accepted = request("MUTABLE", "BEFORE-COMPLETE");
    await gateway.submit(accepted);
    gateway.complete("EX-A");
    expect(await gateway.submit(accepted)).toMatchObject({ status: "IDEMPOTENT", revision: 5 });
    expect(gateway.acceptedCount("EX-A")).toBe(1);
  });

  it("rejects a reconnecting stale client at authority and keeps the head unchanged", async () => {
    const gateway = new InMemorySharedWorkflowGateway(() => actor);
    gateway.seed("EX-A", "P-1", baselineState, "CM-A", 4);
    setSharedWorkflowGateway(gateway);
    setSharedWorkflowConnectivity(false);
    expect(await submitSharedWorkflowMutation(request("MUTABLE", "OFFLINE"))).toMatchObject({ status: "RECONNECT_REQUIRED" });
    gateway.complete("EX-A");
    setSharedWorkflowConnectivity(true);
    expect(await submitSharedWorkflowMutation(request("MUTABLE", "RECONNECTED"))).toMatchObject({
      status: "EXERCISE_COMPLETED", revision: 4,
    });
    expect(gateway.acceptedCount("EX-A")).toBe(0);
  });

  it("maps terminal database errors without retryable/unavailable ambiguity", () => {
    expect(classifySharedWorkflowError("EXERCISE_COMPLETED 55000")).toBe("EXERCISE_COMPLETED");
    expect(classifySharedWorkflowError("COMPLETION_FENCED 55000")).toBe("COMPLETION_FENCED");
    expect(sharedWorkflowStatusMessage("EXERCISE_COMPLETED")).toBe("Õppus on lõpetatud. Muudatusi ei saa enam teha.");
    expect(sharedWorkflowStatusMessage("COMPLETION_FENCED")).toContain("lõpetamine on pooleli");
  });

  it("locks lifecycle before mutation and checks terminal state before patient CAS/ownership", () => {
    expect(migration).toMatch(/from public\.exercise_states as es[\s\S]*for update/);
    expect(migration).toMatch(/exercise_lifecycle_from_state\(v_exercise\.state\)='COMPLETED'[\s\S]*EXERCISE_COMPLETED/);
    expect(migration).toMatch(/v_completion_status='PENDING'[\s\S]*COMPLETION_FENCED/);
    expect(migration.indexOf("from public.exercise_states as es")).toBeLessThan(migration.indexOf("insert into public.shared_workflow_patient_states"));
    expect(migration.indexOf("v_completion_status='PENDING'")).toBeLessThan(migration.indexOf("v_head.revision<>p_expected_revision"));
  });

  it("leaves authenticated RPC grants and command idempotency intact", () => {
    expect(migration).toMatch(/security definer set search_path=''/);
    expect(migration).toMatch(/revoke all on function public\.apply_shared_workflow_patient_mutation[\s\S]*from public,anon/);
    expect(migration).toMatch(/grant execute on function public\.apply_shared_workflow_patient_mutation[\s\S]*to authenticated/);
    expect(migration).toMatch(/if found then[\s\S]*'IDEMPOTENT'::text/);
  });

  it("fences the validation card from authoritative completed lifecycle", () => {
    const dashboard = fs.readFileSync(path.resolve(process.cwd(), "src/app/dashboard.tsx"), "utf8");
    const card = fs.readFileSync(path.resolve(process.cwd(), "src/components/dashboard/SharedWorkflowValidationCard.tsx"), "utf8");
    const patient = fs.readFileSync(path.resolve(process.cwd(), "src/app/patient/[id].tsx"), "utf8");
    const scan = fs.readFileSync(path.resolve(process.cwd(), "src/app/scan.tsx"), "utf8");
    expect(dashboard).toMatch(/readOnly=\{canonicalExercise\.lifecycleState === "COMPLETED"\}/);
    expect(card).toMatch(/disabled=\{pending \|\| readOnly\}/);
    expect(card).toMatch(/disabled=\{pending \|\| !prepared \|\| readOnly\}/);
    expect(card).toContain("Õppus on lõpetatud · ainult lugemiseks");
    expect(patient).toMatch(/isExerciseCompleted \|\| isCompleted \|\| !canCurrentCaseManagerEditPatient/);
    expect(scan).toMatch(/disabled=\{pending \|\| readOnly\}/);
    expect(scan).toContain("Patsiente ei saa enam määrata.");
  });
});
