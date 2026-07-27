import type { ImportSheetData } from "@/models/ModuleImport";

export type GoldenComparator = "EQ" | "NEAR" | "COUNT_EQ" | "SET_EQ" | "LIST_EQ" | "IN";
export type GoldenStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

export type GoldenTestCase = {
  testId: string;
  title: string;
  priority: string;
  fixtureId: string;
  eventSequenceId: string;
  assertionGroupId: string;
  deterministic: boolean;
  automated: boolean;
};

export type GoldenFixture = {
  fixtureId: string;
  fixtureType: string;
  patientId?: string;
  seed: number;
  clockState: string;
  ownerCm?: string;
  ownershipVersion: number;
  initialState: unknown;
  activeResources: unknown;
  loadedModules: unknown;
};

export type GoldenInputEvent = {
  sequenceId: string;
  step: number;
  offsetSec: number;
  eventType: string;
  actor: string;
  target: string;
  eventId: string;
  actionId?: string;
  result: string;
  payload: unknown;
  expectedGeneratedEvent?: string;
};

export type GoldenAssertion = {
  assertionId: string;
  assertionGroupId: string;
  testId: string;
  assertionType: string;
  checkpointSec: number;
  queryOrField: string;
  comparator: GoldenComparator;
  expectedValue: string;
  tolerance: number;
  severity: string;
  sourceRef?: string;
};

export type GoldenExpectedSnapshot = {
  testId: string;
  checkpointSec: number;
  patientId?: string;
  scope: string;
  fieldPath: string;
  comparator: GoldenComparator;
  expectedValue: string;
  tolerance: number;
};

export type GoldenExpectedEvent = {
  testId: string;
  expectedOrder: number;
  eventType: string;
  expectedCount: number;
  sourceModule: string;
  target: string;
  required: boolean;
  mustNotExist: boolean;
  attributionRule?: string;
};

export type GoldenExpectedProcess = {
  testId: string;
  checkpointSec: number;
  parentProcessType: string;
  parentProcessId: string;
  childProcessType: string;
  childTemplateId: string;
  expectedActiveCount: number;
  expectedStatus: string;
  instanceKeyRule: string;
  mustNotExist: boolean;
};

export type GoldenActualProcess = {
  checkpointSec: number;
  parentProcessType: string;
  parentProcessId: string;
  childProcessType: string;
  childTemplateId: string;
  status: string;
  instanceKey?: string;
};

export type GoldenActualEvent = {
  eventType: string;
  sourceModule?: string;
  target?: string;
  simulationTime?: number;
  enginePhase?: number;
  sequence?: number;
  payload?: unknown;
  insertedAt?: string;
};

export type GoldenWorkbook = {
  packId: string;
  packVersion: string;
  tests: GoldenTestCase[];
  fixtures: GoldenFixture[];
  eventSequences: GoldenInputEvent[];
  assertions: GoldenAssertion[];
  expectedSnapshots: GoldenExpectedSnapshot[];
  expectedEvents: GoldenExpectedEvent[];
  expectedProcessTree: GoldenExpectedProcess[];
  sheets: Record<string, ImportSheetData>;
};

export type GoldenExecutionOutput = {
  values: Record<string, unknown>;
  checkpointValues?: Record<string, Record<string, unknown>>;
  snapshots?: Record<string, unknown>;
  events: GoldenActualEvent[];
  processTree?: GoldenActualProcess[];
  stateHash?: string;
  eventLogHash?: string;
  processTreeHash?: string;
  evidenceRef?: string;
};

export type GoldenAssertionResult = {
  runId: string;
  testId: string;
  assertionId: string;
  status: GoldenStatus;
  expected: string;
  actual: unknown;
  tolerance: number;
  evidenceRef?: string;
  failureReason?: string;
};

export type GoldenTestResult = {
  testId: string;
  status: GoldenStatus;
  assertionResults: GoldenAssertionResult[];
  eventComparison: { status: GoldenStatus; failures: string[] };
  processTreeComparison: { status: GoldenStatus; failures: string[] };
  replayComparison: { status: GoldenStatus; failures: string[] };
  stateHash?: string;
  eventLogHash?: string;
  processTreeHash?: string;
};

export type GoldenRunReport = {
  runId: string;
  packId: string;
  packVersion: string;
  runnerVersion: string;
  commitHash?: string;
  startedAt: string;
  finishedAt: string;
  seedByFixture: Record<string, number>;
  stateHash?: string;
  eventLogHash?: string;
  processTreeHash?: string;
  tests: GoldenTestResult[];
};
