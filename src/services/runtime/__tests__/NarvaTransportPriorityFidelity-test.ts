import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NARVA_TRAUMA_EXERCISE_PACKAGE } from "@/services/exercise/NarvaExercisePackages";
import { NARVA_TRAUMA_OXYGEN_PATIENT_DATASET } from "@/services/exercise/NarvaPatientDatasets";
import { NARVA_TRAUMA_QUESTION_CONFIGURATION } from "@/services/exercise/NarvaTraumaQuestionDefinitions";
import { PatientTransportEngine } from "@/services/runtime/PatientTransportEngine";

const configuration = NARVA_TRAUMA_EXERCISE_PACKAGE.transportConfiguration!;
const locations = Object.fromEntries(NARVA_TRAUMA_OXYGEN_PATIENT_DATASET.patients
  .map(item => [item.patient.id, item.patient.location]));
const fresh = () => new PatientTransportEngine(configuration, locations);

describe("NARVA-P02-TRANSPORT-PRIORITY-FIDELITY-01 / SRC-G15..G18", () => {
  test("preserves the exact package-owned P02-first question and P01 waiting rationale", () => {
    expect(NARVA_TRAUMA_QUESTION_CONFIGURATION.definitions.find(item => item.questionId === "P02-Q4"))
      .toMatchObject({ patientId: "PT-CHEST-001", category: "Transport", order: 4,
        prompt: "Miks transporditakse rindkerepatsient esimesena?",
        answer: "Tal on jätkuv aktiivne verejooks ja torakaalkeskus asub 30 minuti kaugusel." });
    expect(NARVA_TRAUMA_QUESTION_CONFIGURATION.definitions.find(item => item.questionId === "P01-Q2"))
      .toMatchObject({ patientId: "PT-PELVIC-001", category: "Transport", order: 2,
        prompt: "Miks võib patsient oodata reanimobiili tagasitulekut?",
        answer: "Vaagnalahas ja MTP loovad ajutise stabiliseerumisakna; lõplik ravi jääb siiski vältimatuks." });
  });

  test.each([
    ["PT-CHEST-001", "PT-PELVIC-001"],
    ["PT-PELVIC-001", "PT-CHEST-001"],
  ] as const)("allows %s to choose first while exclusivity blocks %s", (firstPatient, secondPatient) => {
    const engine = fresh();
    expect(engine.start(`FIRST-${firstPatient}`, firstPatient, "NARVA-REANIMOBILE-01", "IVKH", 0).status)
      .toBe("STARTED");
    expect(engine.start(`SECOND-${secondPatient}`, secondPatient, "NARVA-REANIMOBILE-01", "IVKH", 0))
      .toMatchObject({ status: "REJECTED", reason: "TRANSPORT_RESOURCE_BUSY" });
    expect(engine.snapshot().transports).toHaveLength(1);
  });

  test("contains no assessment-specific priority, queue, precedence or rejection policy", () => {
    const files = ["src/models/PatientTransport.ts", "src/services/runtime/PatientTransportEngine.ts",
      "src/services/runtime/exercise/PatientTransportRuntimeService.ts",
      "src/components/patient/PatientTransportControls.tsx"];
    const source = files.map(file => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");
    expect(configuration.resources).toHaveLength(1);
    expect(source).not.toMatch(/P02[_-]?(PRIORITY|FIRST)|patientPriority|transportQueue|priorityQueue|P01_FIRST/iu);
    expect(source).toContain("TRANSPORT_RESOURCE_BUSY");
  });
});
