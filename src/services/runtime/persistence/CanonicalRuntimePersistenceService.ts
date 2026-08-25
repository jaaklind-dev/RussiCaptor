import {
  LEGACY_PERSISTED_RUNTIME_SCHEMA_VERSION,
  PERSISTED_RUNTIME_SCHEMA_VERSION,
  RuntimePersistenceError,
  type PersistedRuntimeState,
  type RuntimeProvenance,
} from "@/models/PersistedRuntimeState";
import type { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { sha256Text, sha256TextAsync } from "@/utils/sha256";
import { stableJson, stableJsonAsync } from "@/utils/stableJson";
import type { PipelineYield } from "@/services/runtime/persistence/LatestGenerationPipeline";

const capturedCanonicalArtifacts = new WeakSet<object>();

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  Object.values(value as Record<string, unknown>).forEach(item => deepFreeze(item, seen));
  return Object.freeze(value);
}

async function deepFreezeAsync<T>(value: T, yieldControl: PipelineYield, seen = new WeakSet<object>(), count = { value: 0 }): Promise<T> {
  if (!value || typeof value !== "object" || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const item of Object.values(value as Record<string, unknown>)) {
    await deepFreezeAsync(item, yieldControl, seen, count);
    count.value += 1;
    if (count.value % 4_096 === 0) await yieldControl();
  }
  return Object.freeze(value);
}

/** True only for detached, deeply immutable artifacts created in this process. */
export function isCapturedCanonicalRuntimeArtifact(value: PersistedRuntimeState): boolean {
  return capturedCanonicalArtifacts.has(value);
}

export function moduleCompositionHash(modules: readonly Readonly<{ moduleId: string; version: string }>[]): string {
  return sha256Text(stableJson([...modules].sort((a, b) =>
    a.moduleId.localeCompare(b.moduleId) || a.version.localeCompare(b.version))));
}

export class CanonicalRuntimePersistenceService {
  capture(engine: ClinicalScenarioEngine, provenance: RuntimeProvenance): PersistedRuntimeState {
    const payload = engine.captureRuntimePayload();
    const artifact = deepFreeze({
      schemaVersion: PERSISTED_RUNTIME_SCHEMA_VERSION,
      provenance: structuredClone(provenance),
      capturedAtSimulationTimeSec: payload.simulationTimeSec,
      payload,
      payloadHash: sha256Text(stableJson(payload)),
    });
    capturedCanonicalArtifacts.add(artifact);
    return artifact;
  }

  async captureAsync(engine: ClinicalScenarioEngine, provenance: RuntimeProvenance, yieldControl: PipelineYield): Promise<PersistedRuntimeState> {
    const payload = engine.captureRuntimePayload();
    return this.capturePayloadAsync(payload, provenance, yieldControl);
  }

  async capturePayloadAsync(
    payload: ReturnType<ClinicalScenarioEngine["captureRuntimePayload"]>,
    provenance: RuntimeProvenance,
    yieldControl: PipelineYield,
  ): Promise<PersistedRuntimeState> {
    await yieldControl();
    const canonical = await stableJsonAsync(payload, { yieldControl });
    const payloadHash = await sha256TextAsync(canonical, { yieldControl });
    await yieldControl();
    const artifact = await deepFreezeAsync({
      schemaVersion: PERSISTED_RUNTIME_SCHEMA_VERSION,
      provenance: structuredClone(provenance),
      capturedAtSimulationTimeSec: payload.simulationTimeSec,
      payload,
      payloadHash,
    }, yieldControl);
    capturedCanonicalArtifacts.add(artifact);
    return artifact;
  }

  rehydrate(engine: ClinicalScenarioEngine, artifact: PersistedRuntimeState, expected: RuntimeProvenance): void {
    this.validate(artifact, expected);
    engine.rehydrateRuntimePayload(artifact.payload);
  }

  validate(artifact: PersistedRuntimeState, expected: RuntimeProvenance): void {
    if (!artifact || typeof artifact !== "object" || !artifact.payload || !artifact.provenance) {
      throw new RuntimePersistenceError("INVALID_ARTIFACT", "Persisted runtime artifact is malformed.");
    }
    if (artifact.schemaVersion !== PERSISTED_RUNTIME_SCHEMA_VERSION &&
      artifact.schemaVersion !== LEGACY_PERSISTED_RUNTIME_SCHEMA_VERSION) {
      throw new RuntimePersistenceError("UNSUPPORTED_SCHEMA_VERSION", `Runtime schema ${String(artifact.schemaVersion)} is unsupported.`);
    }
    if (!isCapturedCanonicalRuntimeArtifact(artifact) && artifact.payloadHash !== sha256Text(stableJson(artifact.payload))) {
      throw new RuntimePersistenceError("PAYLOAD_HASH_MISMATCH", "Persisted runtime payload hash does not match its content.");
    }
    if (artifact.capturedAtSimulationTimeSec !== artifact.payload.simulationTimeSec) {
      throw new RuntimePersistenceError("RUNTIME_INVARIANT_VIOLATION", "Persisted runtime clock does not match its capture metadata.");
    }
    if (artifact.provenance.exerciseId !== expected.exerciseId) throw new RuntimePersistenceError("EXERCISE_IDENTITY_MISMATCH", "Persisted runtime belongs to another exercise.");
    if (artifact.provenance.patientId !== expected.patientId) throw new RuntimePersistenceError("PATIENT_IDENTITY_MISMATCH", "Persisted runtime belongs to another patient.");
    if (artifact.provenance.packageId !== expected.packageId || artifact.provenance.packageVersion !== expected.packageVersion ||
      artifact.provenance.packageHash !== expected.packageHash) {
      throw new RuntimePersistenceError("PACKAGE_PROVENANCE_MISMATCH", "Persisted runtime package provenance does not match.");
    }
    if (artifact.provenance.definitionHash !== expected.definitionHash) throw new RuntimePersistenceError("DEFINITION_PROVENANCE_MISMATCH", "Persisted runtime definition hash does not match.");
    if (artifact.provenance.moduleCompositionHash !== expected.moduleCompositionHash) throw new RuntimePersistenceError("MODULE_COMPOSITION_MISMATCH", "Persisted runtime module composition does not match.");
  }
}

export const canonicalRuntimePersistenceService = new CanonicalRuntimePersistenceService();
