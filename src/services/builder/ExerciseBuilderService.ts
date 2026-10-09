import type { ExerciseBuilderDraft, BuilderSourceBundle } from "@/models/builder/ExerciseBuilderDraft";
import type { ExercisePackage } from "@/models/exercise/ExercisePackage";
import type { PackagePatientDataset } from "@/models/exercise/PackagePatientDataset";
import type { ImagingAssetReference } from "@/models/ImagingAsset";
import { NARVA_LAB_ANALYTES } from "@/config/NarvaLaboratoryCatalog";
import { CANONICAL_EXERCISE_PACKAGES } from "@/services/exercise/CanonicalExercisePackages";
import { createExercisePackage } from "@/services/exercise/ExercisePackageHash";
import { ExercisePackageValidator } from "@/services/exercise/ExercisePackageValidator";
import { EXERCISE_DEFINITION_CATALOG } from "@/services/exercise/ExerciseDefinitionService";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";

export type BuilderIssue = Readonly<{ level: "ERROR" | "WARNING" | "INFO"; code: string; message: string }>;
const packageIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const patientIdPattern = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const allowedStatic = new Map(NARVA_LAB_ANALYTES.filter(item => item.reportable !== false &&
  ["STATIC_BASELINE", "DEMOGRAPHIC_CONDITIONAL"].includes(item.implementationClass)).map(item => [item.id, item]));

export function newBuilderDraft(): ExerciseBuilderDraft {
  return { schemaVersion: 1, packageId: "", packageVersion: "1.0.0", name: "", description: "",
    author: "", language: "et", patients: [], studies: [], labResultDelaySeconds: {} };
}

export function validateBuilderDraft(draft: ExerciseBuilderDraft,
  existingPackage?: (id: string, version: string) => boolean): readonly BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  const add = (level: BuilderIssue["level"], code: string, message: string) => issues.push({ level, code, message });
  if (!packageIdPattern.test(draft.packageId)) add("ERROR", "PACKAGE_ID", "Paketi ID peab sisaldama väiketähti, numbreid, punkte või sidekriipse.");
  if (!versionPattern.test(draft.packageVersion)) add("ERROR", "PACKAGE_VERSION", "Versioon peab olema kujul 1.0.0.");
  if (!draft.name.trim() || !draft.author.trim()) add("ERROR", "METADATA", "Nimi ja autor on kohustuslikud.");
  if (!draft.language.trim()) add("ERROR", "LANGUAGE", "Keel on kohustuslik.");
  if (/(?:access_token|refresh_token|id_token|[?&]code=)/i.test(draft.sourceReference ?? ""))
    add("ERROR", "SOURCE_SECRET", "Allikaviide ei tohi sisaldada autentimistunnust.");
  if (existingPackage?.(draft.packageId, draft.packageVersion)) add("ERROR", "IMMUTABLE_VERSION", "See paketi versioon on juba olemas. Loo uus versioon.");
  if (!draft.patients.length) add("ERROR", "PATIENTS", "Lisa vähemalt üks patsient.");
  const ids = new Set<string>();
  for (const patient of draft.patients) {
    if (!patientIdPattern.test(patient.id) || ids.has(patient.id)) add("ERROR", "PATIENT_ID", "Patsiendi ID puudub, on vigane või kordub.");
    ids.add(patient.id);
    if (!patient.name.trim() || !patient.location.trim()) add("ERROR", "PATIENT", "Patsiendil peavad olema nimi ja algasukoht.");
    if (patient.ageYears !== undefined && (!Number.isInteger(patient.ageYears) || patient.ageYears < 0 || patient.ageYears > 130)) add("ERROR", "AGE", "Vanus peab olema vahemikus 0–130.");
    for (const [field, value] of Object.entries(patient.vitals)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000) add("ERROR", "VITAL", `Elulise näitaja ${field} väärtus on struktuurselt vigane.`);
    }
    for (const [id, value] of Object.entries(patient.labs)) {
      if (!allowedStatic.has(id) || !(typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.trim())) add("ERROR", "LAB", `Labori väärtus ${id} ei ole toetatud staatiline tulemus.`);
    }
  }
  const studyIds = new Set<string>();
  for (const study of draft.studies) {
    if (!patientIdPattern.test(study.id) || studyIds.has(study.id)) add("ERROR", "STUDY_ID", "Uuringu ID puudub, on vigane või kordub.");
    studyIds.add(study.id);
    if (!ids.has(study.patientId) || !study.title.trim() || !study.report.trim()) add("ERROR", "STUDY", "Uuringul peab olema patsient, pealkiri ja vastus.");
    if (!Number.isInteger(study.resultDelaySeconds) || study.resultDelaySeconds < 0) add("ERROR", "STUDY_DELAY", "Uuringu viivitus peab olema mittenegatiivne täisarv sekundites.");
    if (study.image && (!/\.(png|jpe?g)$/i.test(study.image.fileName) || !study.image.source.trim())) add("ERROR", "IMAGE_SOURCE", "Pildil peab olema JPEG/PNG fail ja allikas.");
    if (study.image && /(?:access_token|refresh_token|id_token|[?&]code=)/i.test(study.image.source))
      add("ERROR", "IMAGE_SOURCE_SECRET", "Pildi allikas ei tohi sisaldada autentimistunnust.");
    if (study.image && !study.image.licenseId.trim()) add("ERROR", "IMAGE_LICENSE", "Pildi avaldamiseks on vaja loa või litsentsi märget.");
    if (study.image && study.image.contributor != null &&
      (typeof study.image.contributor !== "string" || study.image.contributor.includes("\0")))
      add("ERROR", "IMAGE_CONTRIBUTOR", "Pildi autor / omanik peab olema tekst.");
  }
  for (const value of Object.values(draft.labResultDelaySeconds)) if (!Number.isInteger(value) || value < 0) add("ERROR", "LAB_DELAY", "Labori viivitus peab olema mittenegatiivne täisarv sekundites.");
  return issues;
}

/** Converts a validated draft to the existing immutable package/dataset contract. */
export function prepareBuilderDraftForDesktopCompiler(draft: ExerciseBuilderDraft,
  resolvedAssets: Readonly<Record<string, ImagingAssetReference>> = {}): Readonly<{
  exercisePackage: ExercisePackage; patientDataset: PackagePatientDataset; datasetHash: string;
}> {
  const issues = validateBuilderDraft(draft);
  if (issues.some(item => item.level === "ERROR")) throw new Error(`BUILDER_INVALID:${issues.map(item => item.code).join(",")}`);
  for (const study of draft.studies) if (study.image && !resolvedAssets[study.id]) throw new Error(`BUILDER_ASSET_NOT_COMPILED:${study.id}`);
  const template = CANONICAL_EXERCISE_PACKAGES.find(item => item.definition.profile === "CUSTOM")!;
  const datasetVersion = draft.packageVersion.replaceAll(".", "-");
  const datasetId = `${draft.packageId}.patients.v${datasetVersion}`;
  const patients = [...draft.patients].sort((a, b) => a.id.localeCompare(b.id));
  const dataset: PackagePatientDataset = {
    datasetId, version: datasetVersion,
    patients: patients.map((item, index) => ({
      patient: { id: item.id, isikukood: `${draft.packageId.toUpperCase()}-${item.id}`, name: item.name,
        ...(item.ageYears === undefined ? {} : { ageYears: item.ageYears }),
        ...(item.sex ? { sex: item.sex } : {}),
        triage: item.triage, status: item.status ?? "Active", location: item.location, lastSeen: "T+0",
        mist: { mechanism: "", injuries: item.handover, signs: "", treatment: "" } },
      initialLocationId: item.location,
      runtimeFixture: { fixtureId: `FX-${draft.packageId}-${item.id}-${draft.packageVersion}`,
        fixtureType: "PROCESS", patientId: item.id, seed: index + 1, clockState: "RUNNING",
        ownershipVersion: 1, loadedModules: [], activeResources: { resources: [] },
        initialState: { processType: "HYPOVENTILATION_HYPERCAPNIA", templateId: `HV-${item.id}`,
          ventilationReserve: 85, reserveLossPerMin: 0, co2Burden: 30, co2GainPerMin: 0,
          baselineVitals: item.vitals },
      },
    })),
  };
  const definition = { ...structuredClone(template.definition),
    exerciseTypeId: `BUILDER_${draft.packageId.toUpperCase().replaceAll(/[.-]/g, "_")}`,
    name: draft.name, description: draft.description };
  const imagingDefinitions = [...draft.studies].sort((a, b) => a.id.localeCompare(b.id)).map(study => ({
    study: { id: study.id, patientId: study.patientId, modality: study.modality,
      title: study.title, report: study.report, status: "processing" as const,
      imageVisibility: "hidden" as const, reportVisibility: "hidden" as const,
      ...(resolvedAssets[study.id] ? { asset: resolvedAssets[study.id] } : {}) },
    order: { id: `ORDER-${study.id}`, title: study.title, status: "available" as const,
      visibility: "revealed" as const, workflow: { resultAction: "imaging.available" as const,
        resultTargetId: study.id, delayMinutes: study.resultDelaySeconds / 60,
        resultTitle: `${study.title} valmis`, resultDescription: "Uuringu vastus on kättesaadav." } },
  }));
  const exercisePackage = createExercisePackage({ packageId: draft.packageId, packageVersion: draft.packageVersion,
    patientDatasetId: datasetId, definition,
    enabledPatientProcesses: definition.enabledPatientProcesses,
    enabledAnalyticsProviders: definition.enabledAnalyticsProviders,
    enabledMetricProviders: definition.enabledMetricProviders,
    metadata: { name: draft.name, description: draft.description, author: draft.author,
      organization: "RussiCaptor", createdVersion: "1.2.0", exerciseType: "CUSTOM", tags: [draft.language],
      language: draft.language, ...(draft.sourceReference ? { sourceReference: draft.sourceReference } : {}) },
    laboratoryConfiguration: { schemaVersion: 1, catalogPackageId: "NARVA_POLYTRAUMA",
      patients: patients.map(patient => ({ patientId: patient.id, initialResults: patient.labs })),
      resultDelaySeconds: draft.labResultDelaySeconds },
    ...(imagingDefinitions.length ? { imagingConfiguration: { schemaVersion: 1 as const,
      definitions: imagingDefinitions } } : {}),
  });
  return { exercisePackage, patientDataset: dataset, datasetHash: sha256Text(stableJson(dataset)) };
}

/** Final validation runs after the desktop compiler has registered bundled image bytes. */
export function compileBuilderDraft(draft: ExerciseBuilderDraft,
  resolvedAssets: Readonly<Record<string, ImagingAssetReference>> = {}) {
  const compiled = prepareBuilderDraftForDesktopCompiler(draft, resolvedAssets);
  new ExercisePackageValidator(EXERCISE_DEFINITION_CATALOG).assertValid(compiled.exercisePackage);
  return compiled;
}

/** Stable source export; the desktop compiler supplies trusted image inspection and Metro registry generation. */
export function serializeBuilderSourceBundle(bundle: BuilderSourceBundle): string {
  const ids = new Set(bundle.draft.studies.filter(item => item.image).map(item => item.id));
  if (bundle.schemaVersion !== 1 || bundle.images.length !== ids.size ||
    bundle.images.some(item => !ids.has(item.studyId) || !item.base64)) throw new Error("BUILDER_IMAGE_BUNDLE_MISMATCH");
  const portableDraft = { ...bundle.draft, studies: bundle.draft.studies.map(study => {
    if (!study.image) return study;
    const { contributor, ...image } = study.image;
    const normalizedContributor = typeof contributor === "string" ? contributor.trim() : "";
    return { ...study, image: { ...image, localUri: "",
      ...(normalizedContributor ? { contributor: normalizedContributor } : {}) } };
  }) };
  return stableJson({ schemaVersion: 1, draft: portableDraft,
    images: [...bundle.images].sort((a, b) => a.studyId.localeCompare(b.studyId)) });
}
