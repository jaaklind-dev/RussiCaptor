import path from "node:path";
import { readSheet } from "read-excel-file/node";

import { clinicalDataProvider } from "@/providers/ProviderFactory";
import { getImagingStudies } from "@/repositories/ImagingRepository";
import { getOrders } from "@/repositories/OrderRepository";
import { clearScenarioEvents, getUpcomingScenarioEvents } from "@/repositories/ScenarioRepository";
import { resetExercise } from "@/services/ExerciseResetService";
import { runScenarioEvents } from "@/services/ScenarioEngine";
import { createSharedExerciseSnapshot, restoreSharedExerciseState } from "@/services/StatePersistenceService";
import { processOrder } from "@/services/WorkflowService";
import { parseWorkbookSheets, workbookSheetNames } from "@/providers/excel/WorkbookFileParser";
import { NARVA_IRO_EXERCISE_PACKAGE, NARVA_TRAUMA_EXERCISE_PACKAGE } from "../NarvaExercisePackages";
import { CANONICAL_EXERCISE_PACKAGES, DEFAULT_EXERCISE_PACKAGE } from "../CanonicalExercisePackages";
import { packagePatientDatasetRegistry } from "../CanonicalPatientDatasets";
import { createPatientMaterializationPlan, installPatientMaterialization } from "../PackagePatientMaterializationService";
import { installPackageImagingDefinitions } from "../PackageImagingInstallationService";
import { createExercisePackage } from "../ExercisePackageHash";
import { exercisePackageValidator } from "../ExercisePackageService";

const workbookPath = path.join(process.cwd(), "outputs/russicaptor-botulism-johvi-v2/Botulism_Johvi_12_Patients_v2.xlsx");
const expectedPatients = ["P09", "P11", "P12"];

function install(pkg = DEFAULT_EXERCISE_PACKAGE, exerciseId = "EX-I1") {
  const plan = createPatientMaterializationPlan(exerciseId, pkg, packagePatientDatasetRegistry);
  installPatientMaterialization(plan);
  installPackageImagingDefinitions(plan, pkg);
  return plan;
}

const semanticDefinition = (study: ReturnType<typeof clinicalDataProvider.getImagingStudies>[number], order: ReturnType<typeof clinicalDataProvider.getOrders>[number]) => ({
  patientId: study.patientId,
  studyId: study.id,
  modality: study.modality,
  title: study.title,
  report: study.report,
  attachment: study.attachment,
  orderId: order.id,
  targetId: order.workflow.resultTargetId,
  delayMinutes: order.workflow.delayMinutes,
});

describe("I1 package-owned Imaging definitions / IMG-G01..IMG-G10", () => {
  beforeEach(() => resetExercise());
  afterEach(() => resetExercise());

  test("I1-A1/A2/A3 installs only P09/P11/P12 Botulism chest X-rays without workbook import", () => {
    expect(DEFAULT_EXERCISE_PACKAGE.imagingConfiguration).toMatchObject({ schemaVersion: 1 });
    install();
    expect(clinicalDataProvider.getImagingStudies().map(study => study.patientId)).toEqual(expectedPatients);
    for (const patientId of expectedPatients) {
      expect(getImagingStudies(patientId)).toEqual([expect.objectContaining({
        id: `${patientId}-CXR`, patientId, modality: "XR", title: "Rindkere röntgen",
        report: "Kopsuväljad ilma fokaalse infiltraadita; aspiratsiooni varajasi radioloogilisi tunnuseid ei ole.",
        status: "processing", imageVisibility: "hidden", reportVisibility: "hidden",
      })]);
      expect(getOrders(patientId)).toEqual([expect.objectContaining({
        id: `${patientId}-ORD-CXR`, category: "imaging", status: "available",
        workflow: expect.objectContaining({ resultTargetId: `${patientId}-CXR`, delayMinutes: 7 }),
      })]);
    }
    for (const patientId of ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P10"]) {
      expect(getImagingStudies(patientId)).toEqual([]);
      expect(getOrders(patientId).filter(order => order.category === "imaging")).toEqual([]);
    }
  });

  test("IMG-G01 versions Imaging content inside the immutable package hash and validates linkage", () => {
    const content = structuredClone(DEFAULT_EXERCISE_PACKAGE);
    const changed = createExercisePackage({
      ...content,
      packageHash: undefined as never,
      manifest: undefined as never,
      imagingConfiguration: {
        ...content.imagingConfiguration!,
        definitions: content.imagingConfiguration!.definitions.map((item, index) => index === 0
          ? { ...item, order: { ...item.order, workflow: { ...item.order.workflow, delayMinutes: 8 } } }
          : item),
      },
    } as never);
    expect(changed.packageHash).not.toBe(DEFAULT_EXERCISE_PACKAGE.packageHash);

    const invalid = structuredClone(DEFAULT_EXERCISE_PACKAGE);
    invalid.imagingConfiguration!.definitions[0].order.workflow.resultTargetId = "OTHER";
    expect(exercisePackageValidator.validate(invalid).map(issue => issue.code))
      .toContain("INVALID_IMAGING_CONFIGURATION");
  });

  test("I1-A4/A5 isolates canonical packages from legacy PT-001 demo Imaging", () => {
    expect(getImagingStudies("PT-001").map(study => study.id)).toEqual(["IMG-001", "IMG-002"]);
    for (const pkg of CANONICAL_EXERCISE_PACKAGES.filter(item => item.definition.profile !== "BOTULISM")) {
      install(pkg, `EX-${pkg.definition.profile}`);
      expect(clinicalDataProvider.getImagingStudies()).toEqual([]);
      expect(clinicalDataProvider.getOrders().filter(order => order.category === "imaging")).toEqual([]);
      resetExercise();
    }
  });

  test("I1-A6 keeps every Narva package Imaging-empty", () => {
    for (const pkg of [NARVA_TRAUMA_EXERCISE_PACKAGE, NARVA_IRO_EXERCISE_PACKAGE]) {
      expect(pkg.imagingConfiguration).toBeUndefined();
      install(pkg, `EX-${pkg.packageId}`);
      expect(clinicalDataProvider.getImagingStudies()).toEqual([]);
      expect(clinicalDataProvider.getOrders().filter(order => order.category === "imaging")).toEqual([]);
      resetExercise();
    }
  });

  test("I1-A7/A8/A10 restores stable package IDs and repeated installation cannot duplicate", () => {
    const plan = install();
    const initial = structuredClone(clinicalDataProvider.getImagingStudies());
    installPackageImagingDefinitions(plan, DEFAULT_EXERCISE_PACKAGE);
    expect(clinicalDataProvider.getImagingStudies()).toEqual(initial);
    expect(new Set(clinicalDataProvider.getImagingStudies().map(study => study.id)).size).toBe(3);

    const snapshot = createSharedExerciseSnapshot();
    clinicalDataProvider.getImagingStudies().splice(0);
    clinicalDataProvider.getOrders().splice(0);
    restoreSharedExerciseState(snapshot, false);
    expect(clinicalDataProvider.getImagingStudies()).toEqual(initial);
    expect(clinicalDataProvider.getOrders().filter(order => order.category === "imaging").map(order => order.id))
      .toEqual(["P09-ORD-CXR", "P11-ORD-CXR", "P12-ORD-CXR"]);
  });

  test("I1-A9/A10 preserves workbook mapping and package/workbook semantic equivalence", async () => {
    const sheets = await Promise.all(workbookSheetNames.map(async sheet => ({
      sheet,
      data: await readSheet(workbookPath, sheet, { trim: false }) as unknown[][],
    })));
    const parsed = parseWorkbookSheets(sheets);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    install();
    const packageSemantics = clinicalDataProvider.getImagingStudies().map(study => {
      const order = clinicalDataProvider.getOrders().find(item => item.workflow.resultTargetId === study.id)!;
      return semanticDefinition(study, order);
    });
    const workbookSemantics = parsed.data.imagingStudies.map(study => {
      const order = parsed.data.orders.find(item => item.category === "imaging" && item.workflow.resultTargetId === study.id)!;
      return semanticDefinition(study, order);
    });
    expect(packageSemantics).toEqual(workbookSemantics);
  });

  test("I1-A11 package-installed study uses the existing delayed Imaging workflow", () => {
    install();
    const order = getOrders("P09").find(item => item.id === "P09-ORD-CXR")!;
    processOrder(order);
    expect(order.status).toBe("processing");
    expect(getUpcomingScenarioEvents()).toEqual([expect.objectContaining({
      patientId: "P09", targetId: "P09-CXR", orderId: "P09-ORD-CXR", triggerMinute: 7,
    })]);
    runScenarioEvents(7);
    expect(order.status).toBe("completed");
    expect(getImagingStudies("P09")[0].status).toBe("available");
    clearScenarioEvents();
  });
});
