import {
  PERSISTED_RUNTIME_SCHEMA_VERSION,
  RuntimePersistenceError,
  type PersistedRuntimeState,
  type RuntimeProvenance,
} from "@/models/PersistedRuntimeState";
import type { ClinicalScenarioEngine } from "@/services/ScenarioEngine";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

export function moduleCompositionHash(modules: readonly Readonly<{ moduleId: string; version: string }>[]): string {
  return sha256Text(stableJson([...modules].sort((a, b) =>
    a.moduleId.localeCompare(b.moduleId) || a.version.localeCompare(b.version))));
}

export class CanonicalRuntimePersistenceService {
  capture(engine: ClinicalScenarioEngine, provenance: RuntimeProvenance): PersistedRuntimeState {
    const payload = engine.captureRuntimePayload();
    return Object.freeze({
      schemaVersion: PERSISTED_RUNTIME_SCHEMA_VERSION,
      provenance: structuredClone(provenance),
      capturedAtSimulationTimeSec: payload.simulationTimeSec,
      payload,
      payloadHash: sha256Text(stableJson(payload)),
    });
  }

  rehydrate(engine: ClinicalScenarioEngine, artifact: PersistedRuntimeState, expected: RuntimeProvenance): void {
    this.validate(artifact, expected);
    engine.rehydrateRuntimePayload(artifact.payload);
  }

  validate(artifact: PersistedRuntimeState, expected: RuntimeProvenance): void {
    if (!artifact || typeof artifact !== "object" || !artifact.payload || !artifact.provenance) {
      throw new RuntimePersistenceError("INVALID_ARTIFACT", "Persisted runtime artifact is malformed.");
    }
    if (artifact.schemaVersion !== PERSISTED_RUNTIME_SCHEMA_VERSION) {
      throw new RuntimePersistenceError("UNSUPPORTED_SCHEMA_VERSION", `Runtime schema ${String(artifact.schemaVersion)} is unsupported.`);
    }
    if (artifact.payloadHash !== sha256Text(stableJson(artifact.payload))) {
      throw new RuntimePersistenceError("PAYLOAD_HASH_MISMATCH", "Persisted runtime payload hash does not match its content.");
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
