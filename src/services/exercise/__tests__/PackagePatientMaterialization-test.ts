import type { Patient } from "@/models/Patient";
import type { PackagePatientDataset } from "@/models/exercise/PackagePatientDataset";
import { PELVIC_INJURY_EXERCISE_PACKAGE } from "../CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { createPatientMaterializationPlan, getPatientMaterialization, installPatientMaterialization, PackagePatientDatasetRegistry, PatientDatasetError, restorePatientMaterialization } from "../PackagePatientMaterializationService";
import { dataProvider } from "@/providers/ProviderFactory";
import fs from "node:fs";
import path from "node:path";

const patient = (id: string): Patient => ({ id, isikukood: `TEST-${id}`, name: `Patient ${id}`, triage: "P1", status: "Active", location: "Resus", lastSeen: "T+0", mist: { mechanism: "Synthetic", injuries: "Synthetic", signs: "Synthetic", treatment: "None" } });
const pkg = (datasetId: string) => ({ ...PELVIC_INJURY_EXERCISE_PACKAGE, packageId: `test.${datasetId}`, patientDatasetId: datasetId });
const register = (records: PackagePatientDataset["patients"], id = "patients.synthetic.v1") => { const registry = new PackagePatientDatasetRegistry(); registry.register({ datasetId: id, version: "1", patients: records }); return registry; };

describe("WP-43A Package Patient Materialization", () => {
  afterEach(() => restorePatientMaterialization());

  test("resolves and materializes the pelvic reference patient with exact provenance", () => {
    const plan = createPatientMaterializationPlan("EX-PELVIC", PELVIC_INJURY_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    expect(plan).toMatchObject({ exerciseId: "EX-PELVIC", packageId: PELVIC_INJURY_EXERCISE_PACKAGE.packageId, datasetId: "patients.pelvic-injury-reference.v1", datasetVersion: "1", patients: [{ patient: { id: "PT-PELVIC-001" }, runtimeFixture: { patientId: "PT-PELVIC-001" } }] });
    installPatientMaterialization(plan);
    expect(dataProvider.getPatients().map(item => item.id)).toEqual(["PT-PELVIC-001"]);
    expect(getPatientMaterialization("EX-PELVIC")).toEqual(plan);
    expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.patients)).toBe(true);
    expect(Object.isFrozen(plan.patients[0].runtimeFixture?.initialState)).toBe(true);
  });

  test("supports N patients with input-order invariant identity, hash and process configuration", () => {
    const first = createPatientMaterializationPlan("EX-MULTI", pkg("patients.synthetic.v1"), register([{ patient: patient("PT-002") }, { patient: patient("PT-001") }]));
    const second = createPatientMaterializationPlan("EX-MULTI", pkg("patients.synthetic.v1"), register([{ patient: patient("PT-001") }, { patient: patient("PT-002") }]));
    expect(first).toEqual(second); expect(first.patients.map(item => item.patient.id)).toEqual(["PT-001", "PT-002"]); expect(first.materializationHash).toBe(second.materializationHash);
  });

  test.each([
    ["missing", () => createPatientMaterializationPlan("EX", pkg("patients.missing.v1"), new PackagePatientDatasetRegistry()), "UNKNOWN_PATIENT_DATASET"],
    ["duplicate", () => createPatientMaterializationPlan("EX", pkg("patients.synthetic.v1"), register([{ patient: patient("PT-1") }, { patient: patient("PT-1") }])), "DUPLICATE_PATIENT_ID"],
    ["malformed", () => createPatientMaterializationPlan("EX", pkg("patients.synthetic.v1"), register([{ patient: { ...patient("PT-1"), name: "" } }])), "MALFORMED_PATIENT"],
    ["empty", () => createPatientMaterializationPlan("EX", pkg("patients.synthetic.v1"), register([])), "EMPTY_PATIENT_DATASET"],
  ])("fails closed for %s datasets before installation", (_name, run, code) => {
    expect(run).toThrow(expect.objectContaining({ code })); expect(run).toThrow(PatientDatasetError);
  });

  test("restores materialization provenance without a live package lookup", () => {
    const plan = createPatientMaterializationPlan("EX-RESTORE", PELVIC_INJURY_EXERCISE_PACKAGE, packagePatientDatasetRegistry);
    restorePatientMaterialization(plan); expect(getPatientMaterialization("EX-RESTORE")).toEqual(plan);
  });

  test("materializes a larger dataset in canonical order without per-patient side effects", () => {
    const records = Array.from({ length: 100 }, (_, index) => ({ patient: patient(`PT-${String(100 - index).padStart(3, "0")}`) }));
    const plan = createPatientMaterializationPlan("EX-SCALE", pkg("patients.synthetic.v1"), register(records));
    expect(plan.patients).toHaveLength(100); expect(plan.patients[0].patient.id).toBe("PT-001"); expect(plan.patients.at(-1)?.patient.id).toBe("PT-100");
  });

  test("keeps ScenarioEngine and materializer dependency directions isolated", () => {
    const root = process.cwd(); const scenario = fs.readFileSync(path.join(root, "src/services/ScenarioEngine.ts"), "utf8"); const materializer = fs.readFileSync(path.join(root, "src/services/exercise/PackagePatientMaterializationService.ts"), "utf8");
    expect(scenario).not.toMatch(/PackagePatient|Materialization|patientDataset/);
    expect(materializer).not.toMatch(/ScenarioEngine|ProtocolAssessment|EvaluationService|PELVIC_INJURY|pelvic-injury-reference/);
  });
});
