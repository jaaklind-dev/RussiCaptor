import { getQuestions, resetQuestions, setQuestionVisibility } from "@/repositories/QuestionRepository";
import { capturePatientSharedWorkflowState, restorePatientSharedWorkflowState } from
  "@/services/sharedWorkflow/PatientSharedWorkflowState";
import { clinicalDataProvider } from "@/providers/ProviderFactory";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { NARVA_TRAUMA_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE_V102,
  NARVA_TRAUMA_EXERCISE_PACKAGE_V104 } from
  "../NarvaExercisePackages";
import { createPatientMaterializationPlan } from "../PackagePatientMaterializationService";
import { installPackageQuestions } from "../PackageQuestionInstallationService";

const exerciseId = "EX-NARVA-QUESTIONS";
const pelvicId = "PT-PELVIC-001";
const chestId = "PT-CHEST-001";
const expected = [
  { questionId: "P01-Q1", patientId: pelvicId, sourcePatientId: "P01", category: "Trauma", order: 1,
    prompt: "Milline sekkumine vähendab vaagnaverejooksu?",
    answer: "Paigaldada vaagnalahas võimalikult vara ja korrektselt.", visibility: "hidden" },
  { questionId: "P01-Q2", patientId: pelvicId, sourcePatientId: "P01", category: "Transport", order: 2,
    prompt: "Miks võib patsient oodata reanimobiili tagasitulekut?",
    answer: "Vaagnalahas ja MTP loovad ajutise stabiliseerumisakna; lõplik ravi jääb siiski vältimatuks.",
    visibility: "hidden" },
  { questionId: "P02-Q1", patientId: chestId, sourcePatientId: "P02", category: "Dreen", order: 1,
    prompt: "Kui suur oli esmane dreenieritus?", answer: "Ligikaudu 1450 ml verd.", visibility: "hidden" },
  { questionId: "P02-Q2", patientId: chestId, sourcePatientId: "P02", category: "Dreen", order: 2,
    prompt: "Kui suur on jätkuv dreeniverejooks?", answer: "200 ml tunnis.", visibility: "hidden" },
  { questionId: "P02-Q3", patientId: chestId, sourcePatientId: "P02", category: "Transport", order: 3,
    prompt: "Kus mängitakse transpordifaas läbi?",
    answer: "Seisvas reanimobiilis; auto reaalselt ei sõida.", visibility: "hidden" },
  { questionId: "P02-Q4", patientId: chestId, sourcePatientId: "P02", category: "Transport", order: 4,
    prompt: "Miks transporditakse rindkerepatsient esimesena?",
    answer: "Tal on jätkuv aktiivne verejooks ja torakaalkeskus asub 30 minuti kaugusel.", visibility: "hidden" },
] as const;

const install = () => installPackageQuestions(createPatientMaterializationPlan(exerciseId,
  NARVA_TRAUMA_EXERCISE_PACKAGE, packagePatientDatasetRegistry), NARVA_TRAUMA_EXERCISE_PACKAGE);

describe("Q-G01..Q-G10 package-owned Narva questions", () => {
  beforeEach(() => resetQuestions());
  afterEach(() => resetQuestions());

  test("freezes the six authority-resolved questions in immutable package content", () => {
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE.questionConfiguration?.definitions).toEqual(expected);
    expect(Object.isFrozen(NARVA_TRAUMA_EXERCISE_PACKAGE.questionConfiguration)).toBe(true);
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE_V102.questionConfiguration).toBeUndefined();
    expect(NARVA_TRAUMA_EXERCISE_PACKAGE_V104.questionConfiguration?.definitions
      .find(item => item.questionId === "P02-Q2")?.answer).toBe("Ligikaudu 400 ml tunnis.");
  });

  test("changes only P02-Q2 from the immutable 1.0.4 question content", () => {
    const historical = NARVA_TRAUMA_EXERCISE_PACKAGE_V104.questionConfiguration!.definitions;
    const current = NARVA_TRAUMA_EXERCISE_PACKAGE.questionConfiguration!.definitions;
    expect(current).toHaveLength(historical.length);
    expect(current.filter((question, index) => JSON.stringify(question) !== JSON.stringify(historical[index])))
      .toEqual([expected.find(question => question.questionId === "P02-Q2")]);
    expect(current.find(question => question.questionId === "P02-Q4"))
      .toEqual(historical.find(question => question.questionId === "P02-Q4"));
  });

  test("installs exactly two P01 questions and four P02 questions without demo or cross-patient leakage", () => {
    install();
    expect(getQuestions(pelvicId).map(item => item.id)).toEqual(["P01-Q1", "P01-Q2"]);
    expect(getQuestions(chestId).map(item => item.id)).toEqual(["P02-Q1", "P02-Q2", "P02-Q3", "P02-Q4"]);
    expect(getQuestions(pelvicId).every(item => item.sourcePatientId === "P01")).toBe(true);
    expect(getQuestions(chestId).every(item => item.sourcePatientId === "P02")).toBe(true);
    expect([...getQuestions(pelvicId), ...getQuestions(chestId)].some(item => item.id === "Q-001")).toBe(false);
  });

  test("uses stable source IDs, ordering and package provenance across repeated bootstrap", () => {
    install(); const first = [...getQuestions(pelvicId), ...getQuestions(chestId)]; install();
    const second = [...getQuestions(pelvicId), ...getQuestions(chestId)];
    expect(second).toEqual(first); expect(second).toHaveLength(6);
    expect(second.every(item => item.exerciseId === exerciseId &&
      item.packageId === "russicaptor.narva-trauma" && item.packageVersion === "1.0.5")).toBe(true);
  });

  test("shared-workflow restore preserves reveal state and never duplicates package definitions", () => {
    install(); setQuestionVisibility(pelvicId, "P01-Q1", "revealed");
    const captured = capturePatientSharedWorkflowState(pelvicId);
    clinicalDataProvider.getQuestions().find(item => item.id === "P01-Q1")!.visibility = "hidden";
    restorePatientSharedWorkflowState(pelvicId, captured);
    expect(getQuestions(pelvicId)).toEqual([
      expect.objectContaining({ id: "P01-Q1", visibility: "revealed" }),
      expect.objectContaining({ id: "P01-Q2", visibility: "hidden" }),
    ]);
  });

  test("packages without question content retain the legacy demo question behavior", () => {
    const before = getQuestions("PT-001");
    installPackageQuestions({ ...createPatientMaterializationPlan(exerciseId,
      NARVA_TRAUMA_EXERCISE_PACKAGE, packagePatientDatasetRegistry), patients: [] },
    NARVA_TRAUMA_EXERCISE_PACKAGE_V102);
    expect(getQuestions("PT-001")).toEqual(before);
  });
});
