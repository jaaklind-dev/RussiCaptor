import fs from "node:fs";
import path from "node:path";
import { runInitialWriterStartOrder, type InitialWriterStartPort } from "@/services/runtime/persistence/InitialWriterStartOrder";

function harness() {
  const calls: string[] = [];
  const port: InitialWriterStartPort = {
    currentWriter: jest.fn(async () => { calls.push("lease"); return true; }),
    publishAndConfirmRunning: jest.fn(async () => { calls.push("publish+readback"); return { ok: true as const, revision: 2 }; }),
    initializeWorkflowHeads: jest.fn(async () => { calls.push("heads"); return true; }),
    establishRuntimeOwner: jest.fn(() => { calls.push("owner"); return true; }),
  };
  return { calls, port };
}

describe("INITIAL-WRITER-START-ORDER", () => {
  test("START-ORDER-01 lease → durable RUNNING → heads → owner", async () => {
    const { calls, port } = harness();
    expect(await runInitialWriterStartOrder(port)).toEqual({ ok: true, phase: "RUNTIME_READY", revision: 2 });
    expect(calls).toEqual(["lease", "publish+readback", "lease", "heads", "lease", "owner"]);
  });
  test("START-ORDER-02 no lease never publishes or creates heads", async () => {
    const { calls, port } = harness();
    expect(await runInitialWriterStartOrder({ ...port, currentWriter: async () => false }))
      .toEqual({ ok: false, phase: "WRITER_READY", code: "WRITER_AUTHORITY_UNAVAILABLE" });
    expect(calls).toEqual([]);
  });
  test("START-ORDER-03 publication rejection never creates heads", async () => {
    const { calls, port } = harness();
    const result = await runInitialWriterStartOrder({ ...port,
      publishAndConfirmRunning: async () => ({ ok: false, code: "REVISION_CONFLICT" }) });
    expect(result).toEqual({ ok: false, phase: "RUNNING_PUBLISH_PENDING", code: "REVISION_CONFLICT" });
    expect(calls).toEqual(["lease"]);
  });
  test("START-ORDER-04 transport failure remains bounded and withholds heads", async () => {
    const { calls, port } = harness();
    const result = await runInitialWriterStartOrder({ ...port,
      publishAndConfirmRunning: async () => { throw new Error("raw transport secret"); } });
    expect(result).toEqual({ ok: false, phase: "RUNNING_PUBLISH_PENDING", code: "EXERCISE_STATE_WRITE_FAILED" });
    expect(calls).toEqual(["lease"]);
  });
  test("START-ORDER-05 lost authority after publish withholds heads", async () => {
    const { calls, port } = harness(); let count = 0;
    const result = await runInitialWriterStartOrder({ ...port, currentWriter: async () => ++count === 1 });
    expect(result).toEqual({ ok: false, phase: "RUNNING_PUBLISH_DURABLE", code: "WRITER_AUTHORITY_UNAVAILABLE" });
    expect(calls).toEqual(["publish+readback"]);
  });
  test("START-ORDER-06 head failure withholds owner", async () => {
    const { calls, port } = harness();
    const result = await runInitialWriterStartOrder({ ...port, initializeWorkflowHeads: async () => false });
    expect(result).toEqual({ ok: false, phase: "WORKFLOW_HEAD_BOOTSTRAP", code: "WORKFLOW_HEAD_INITIALIZATION_FAILED" });
    expect(calls).toEqual(["lease", "publish+readback", "lease"]);
  });
  test("START-ORDER-07 head exception withholds owner and stays bounded", async () => {
    const { port } = harness();
    expect(await runInitialWriterStartOrder({ ...port, initializeWorkflowHeads: async () => { throw new Error("raw"); } }))
      .toEqual({ ok: false, phase: "WORKFLOW_HEAD_BOOTSTRAP", code: "WORKFLOW_HEAD_INITIALIZATION_FAILED" });
    expect(port.establishRuntimeOwner).not.toHaveBeenCalled();
  });
  test("START-ORDER-08 authority loss after heads withholds owner", async () => {
    const { port } = harness(); let count = 0;
    expect(await runInitialWriterStartOrder({ ...port, currentWriter: async () => ++count < 3 }))
      .toEqual({ ok: false, phase: "WORKFLOW_HEAD_BOOTSTRAP", code: "RUNTIME_OWNER_NOT_READY" });
    expect(port.establishRuntimeOwner).not.toHaveBeenCalled();
  });
  test("START-ORDER-09 owner registration failure is not a successful start", async () => {
    const { port } = harness();
    expect(await runInitialWriterStartOrder({ ...port, establishRuntimeOwner: () => false }))
      .toEqual({ ok: false, phase: "WORKFLOW_HEAD_BOOTSTRAP", code: "RUNTIME_OWNER_NOT_READY" });
  });
  test("START-ORDER-10 initial publish uses existing writer-fenced RPC and durable SELECT", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    const initial = source.slice(source.indexOf("export async function publishInitialRunningExerciseState"),
      source.indexOf("const projectionWriteCoordinator ="));
    expect(initial).toContain('client.rpc("publish_exercise_state_current_writer", request)');
    expect(initial).toContain('client.from("exercise_states")');
    expect(initial).toContain('durablePackage.lifecycle !== "RUNNING"');
    expect(initial).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });
  test("START-ORDER-11 ambiguous retry reuses frozen operation ID and payload", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    const initial = source.slice(source.indexOf("export async function publishInitialRunningExerciseState"),
      source.indexOf("const projectionWriteCoordinator ="));
    expect(initial).toContain("const operationId = `START-RUNNING-${input.leaseId}`");
    expect(initial.match(/client\.rpc\("publish_exercise_state_current_writer", request\)/g)).toHaveLength(2);
  });
  test("START-ORDER-12 non-bootstrap path retains its original head/owner ordering", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/RuntimeCheckpointSyncService.ts"), "utf8");
    const branch = source.slice(source.indexOf("if (readyBootstrap) {", source.indexOf("const acquired=await acquireRuntimeWriterTerminal")),
      source.indexOf("else {\n        // A discovery projection", source.indexOf("const acquired=await acquireRuntimeWriterTerminal")));
    expect(branch).toContain("} else if (!await ensureWorkflowHeads()) {");
    expect(branch).toContain("} else if (!establishRuntimeOwner()) {");
  });
  test("START-ORDER-13 existing durable RUNNING resumes without a duplicate publication", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/services/CloudSyncService.ts"), "utf8");
    const initial = source.slice(source.indexOf("export async function publishInitialRunningExerciseState"),
      source.indexOf("const projectionWriteCoordinator ="));
    expect(initial.indexOf('if (exerciseLifecycle(before.state) === "RUNNING")')).toBeLessThan(
      initial.indexOf('client.rpc("publish_exercise_state_current_writer", request)'));
    expect(initial).toContain('if (exerciseLifecycle(before.state) !== "READY")');
  });
  test("START-ORDER-14 owner registration exception never reports runtime ready", async () => {
    const { port } = harness();
    expect(await runInitialWriterStartOrder({ ...port, establishRuntimeOwner: () => { throw new Error("raw"); } }))
      .toEqual({ ok: false, phase: "WORKFLOW_HEAD_BOOTSTRAP", code: "RUNTIME_OWNER_NOT_READY" });
  });
});
