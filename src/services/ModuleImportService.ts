import { File } from "expo-file-system";
import { readSheet } from "read-excel-file/universal";

import type {
  CanonicalModulePayload,
  CanonicalSheet,
  ImportCellValue,
  ImportSheetData,
  ModuleImportIssue,
  ModulePackageImportResult,
  StagedModule,
} from "@/models/ModuleImport";
import {
  manifestSheetNames,
  parseModuleManifest,
  validateModuleManifest,
  type ManifestSheets,
} from "@/providers/excel/ModuleManifestParser";
import { isSupabaseConfigured, supabase } from "@/services/SupabaseService";
import { sha256Hex, sha256Text } from "@/utils/sha256";

export const moduleManifestFileName = "RussiCaptor_Module_Import_Manifest_v1.xlsx";
const runtimeClasses = new Set(["RUNTIME_CONFIG", "EXERCISE_DATA"]);

export type ModulePackageFile = { name: string; uri: string };
export type ActiveModulePackageSummary = {
  exerciseId: string;
  exerciseVersion: string;
};

function issue(code: string, message: string): ModuleImportIssue {
  return { severity: "FATAL", code, message };
}

function cellText(value: ImportCellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

function canonicalizeSheet(data: ImportSheetData): CanonicalSheet {
  const headerIndex = data.findIndex(
    (row) => row.filter((cell) => cellText(cell) !== "").length >= 2
  );
  if (headerIndex < 0) return { columns: [], rows: [] };
  const headers = data[headerIndex].map(cellText);
  const columns = headers.filter(Boolean);
  const rows = data.slice(headerIndex + 1).flatMap((values) => {
    if (values.every((value) => cellText(value) === "")) return [];
    const row: Record<string, ImportCellValue> = {};
    headers.forEach((column, index) => {
      if (column) row[column] = (values[index] as ImportCellValue | undefined) ?? null;
    });
    return [row];
  });
  return { columns, rows };
}

async function readNamedSheet(buffer: ArrayBuffer, sheetName: string): Promise<ImportSheetData> {
  return await readSheet(buffer, sheetName, { trim: false }) as ImportSheetData;
}

async function readManifest(buffer: ArrayBuffer): Promise<ManifestSheets> {
  const entries = await Promise.all(manifestSheetNames.map(async (sheetName) => {
    try {
      return [sheetName, await readNamedSheet(buffer, sheetName)] as const;
    } catch {
      throw new Error(`Manifesti kohustuslik leht ${sheetName} puudub või pole loetav.`);
    }
  }));
  return Object.fromEntries(entries);
}

function findDuplicate(values: string[]): string | undefined {
  return values.find((value, index) => value && values.indexOf(value) !== index);
}

function rowsFor(payload: CanonicalModulePayload, sheetName: string) {
  return payload.sheets[sheetName]?.rows ?? [];
}

function validateUniqueColumn(
  modules: StagedModule[],
  sheetPattern: RegExp,
  column: string,
  code: string,
  issues: ModuleImportIssue[]
): void {
  const values = modules.flatMap((module) =>
    Object.entries(module.payload.sheets).flatMap(([sheetName, sheet]) =>
      sheetPattern.test(sheetName) ? sheet.rows.map((row) => cellText(row[column])) : []
    )
  );
  const duplicate = findDuplicate(values);
  if (duplicate) issues.push(issue(code, `${column} ${duplicate} esineb definitsioonides mitu korda.`));
}

function settingValue(payload: CanonicalModulePayload, settingId: string): ImportCellValue | undefined {
  return rowsFor(payload, "ScenarioSettings").find(
    (row) => cellText(row.SettingID) === settingId
  )?.Value;
}

export function validateStagedPackage(
  modules: StagedModule[],
  manifest: ReturnType<typeof parseModuleManifest>
): ModuleImportIssue[] {
  const issues: ModuleImportIssue[] = [];
  const exercise = modules.find((module) => module.registry.moduleType === "EXERCISE_INSTANCE");
  if (!exercise) return [issue("EXERCISE_MODULE", "Aktiivne EXERCISE_INSTANCE moodul puudub.")];

  for (const rule of manifest.sheetRules.filter(
    (item) => item.importAtRuntime && (item.requiredSheet || item.onMissing === "ABORT_IMPORT")
  )) {
    const target = modules.find((module) => module.registry.moduleId === rule.moduleId);
    if (!target?.payload.sheets[rule.sheetName]) {
      issues.push(issue(
        "REQUIRED_SHEET",
        `${rule.moduleId}: kohustuslik leht ${rule.sheetName} puudub.`
      ));
    }
  }

  for (const binding of manifest.bindings) {
    const target = modules.find((module) => module.registry.moduleId === binding.requiredModuleId);
    if (!target) {
      issues.push(issue("BINDING_MODULE", `Binding viitab puuduvale moodulile ${binding.requiredModuleId}.`));
    } else if (target.registry.moduleVersion !== binding.requiredVersion) {
      issues.push(issue("BINDING_VERSION", `${binding.requiredModuleId} versioon peab olema ${binding.requiredVersion}.`));
    } else if (binding.bindingType === "EXCLUDED" && Object.keys(target.payload.sheets).length > 0) {
      issues.push(issue("EXCLUDED_RUNTIME", `${binding.requiredModuleId} runtime-andmed peavad jääma välja.`));
    }
  }

  const patientRows = rowsFor(exercise.payload, "PatientRoster");
  const processRows = rowsFor(exercise.payload, "PatientProcessAssignments");
  const expectedPatients = Number(settingValue(exercise.payload, "PatientCountExpected"));
  const expectedPerPatient = Number(settingValue(exercise.payload, "ProcessesPerPatientExpected"));
  if (!Number.isFinite(expectedPatients) || patientRows.length !== expectedPatients) {
    issues.push(issue("PATIENT_COUNT", `Patsiente on ${patientRows.length}, oodatud ${expectedPatients}.`));
  }
  if (!Number.isFinite(expectedPerPatient) || processRows.length !== expectedPatients * expectedPerPatient) {
    issues.push(issue("PROCESS_COUNT", `PatientProcess ridu on ${processRows.length}, oodatud ${expectedPatients * expectedPerPatient}.`));
  }

  const patientIds = patientRows.map((row) => cellText(row.PatientID));
  const duplicatePatient = findDuplicate(patientIds);
  if (duplicatePatient) issues.push(issue("DUPLICATE_PATIENT", `PatientID ${duplicatePatient} esineb mitu korda.`));
  if (patientRows.some((row) => cellText(row.SourceStatus) !== "READY")) {
    issues.push(issue("PATIENT_READY", "Kõik patsiendid peavad olema READY."));
  }
  const pt012 = patientRows.find((row) => cellText(row.PatientID) === "PT-012");
  if (!pt012 || cellText(pt012.ArrivalClock) !== "13:35") {
    issues.push(issue("PT012_ARRIVAL", "PT-012 saabumisaeg peab olema 13:35."));
  }

  const processIds = processRows.map((row) => cellText(row.PatientProcessID));
  const duplicateProcess = findDuplicate(processIds);
  if (duplicateProcess) issues.push(issue("DUPLICATE_PROCESS", `PatientProcessID ${duplicateProcess} esineb mitu korda.`));
  for (const patientId of patientIds) {
    const count = processRows.filter((row) => cellText(row.PatientID) === patientId).length;
    if (count !== expectedPerPatient) {
      issues.push(issue("PROCESSES_PER_PATIENT", `${patientId} protsesside arv on ${count}, oodatud ${expectedPerPatient}.`));
    }
  }
  for (const row of processRows) {
    if (!patientIds.includes(cellText(row.PatientID))) {
      issues.push(issue("PROCESS_PATIENT_REF", `${cellText(row.PatientProcessID)} viitab puuduvale patsiendile.`));
    }
    const parent = cellText(row.ParentProcessID);
    if (parent && !processIds.includes(parent)) {
      issues.push(issue("PROCESS_PARENT_REF", `${cellText(row.PatientProcessID)} parent ${parent} puudub.`));
    }
  }

  const templateIds = modules.flatMap((module) =>
    Object.entries(module.payload.sheets).flatMap(([sheetName, sheet]) =>
      /Templates$/.test(sheetName) ? sheet.rows.map((row) => cellText(row.TemplateID)) : []
    )
  );
  const triggerIds = modules.flatMap((module) =>
    rowsFor(module.payload, "TriggerRules").map((row) => cellText(row.TriggerRuleID))
  );
  for (const row of processRows) {
    const templateId = cellText(row.TemplateID);
    const triggerId = cellText(row.TriggerRuleID);
    if (templateId && !templateIds.includes(templateId)) {
      issues.push(issue("PROCESS_TEMPLATE_REF", `${cellText(row.PatientProcessID)} template ${templateId} puudub.`));
    }
    if (triggerId && !triggerIds.includes(triggerId)) {
      issues.push(issue("PROCESS_TRIGGER_REF", `${cellText(row.PatientProcessID)} trigger ${triggerId} puudub.`));
    }
  }

  const severeHvTriggers = modules.flatMap((module) =>
    rowsFor(module.payload, "TriggerRules").filter((row) =>
      ["HV_NM_SEV"].includes(cellText(row.ChildTemplateID) || cellText(row.ChildTemplateOrEvent))
    )
  );
  if (severeHvTriggers.length === 0 || severeHvTriggers.some(
    (row) => cellText(row.ParentTransition) !== "RESOLVE_AND_REPLACE" || cellText(row.Repeatable) !== "FALSE"
  )) {
    issues.push(issue(
      "HV_CHILD_REPLACEMENT",
      "HV_NM_SEV trigger peab olema mittekorduv ja kasutama RESOLVE_AND_REPLACE üleminekut."
    ));
  }
  const hypoventilationChildTriggers = modules.flatMap((module) =>
    rowsFor(module.payload, "TriggerRules").filter((row) =>
      (cellText(row.ChildTemplateID) || cellText(row.ChildTemplateOrEvent)) === "HYP_HYPOVENT_MOD"
    )
  );
  if (hypoventilationChildTriggers.length === 0 || hypoventilationChildTriggers.some(
    (row) => cellText(row.Repeatable) !== "FALSE"
  )) {
    issues.push(issue(
      "HYPOXIA_CHILD_IDEMPOTENCY",
      "HYP_HYPOVENT_MOD child trigger peab olema mittekorduv."
    ));
  }

  validateUniqueColumn(modules, /Templates$/, "TemplateID", "DUPLICATE_TEMPLATE", issues);
  validateUniqueColumn(modules, /^TriggerRules$/, "TriggerRuleID", "DUPLICATE_TRIGGER", issues);
  validateUniqueColumn(modules, /^ExerciseEvents$/, "EventID", "DUPLICATE_EVENT", issues);
  validateUniqueColumn(modules, /^ResourcePool$/, "ResourceID", "DUPLICATE_RESOURCE", issues);

  for (const module of modules) {
    const actionIds = Object.entries(module.payload.sheets).flatMap(([sheetName, sheet]) =>
      /Actions$/.test(sheetName)
        ? sheet.rows.map((row) => cellText(row.ActionID))
        : []
    );
    const duplicateAction = findDuplicate(actionIds);
    if (duplicateAction) {
      issues.push(issue(
        "DUPLICATE_ACTION_NAMESPACE",
        `${module.registry.moduleId} ActionID ${duplicateAction} esineb mooduli nimeruumis mitu korda.`
      ));
    }
  }

  const serialized = JSON.stringify(modules.map((module) => module.payload));
  for (const forbidden of ["TRG-RESP-01", "WORK-B-PAIR"]) {
    if (serialized.includes(forbidden)) {
      issues.push(issue("DEPRECATED_REFERENCE", `${forbidden} viide on aktiivses payload'is keelatud.`));
    }
  }
  return issues;
}

async function buildStagedModules(
  files: Map<string, { buffer: ArrayBuffer }>,
  manifest: ReturnType<typeof parseModuleManifest>
): Promise<StagedModule[]> {
  const staged: StagedModule[] = [];
  for (const registry of [...manifest.modules].sort((a, b) => a.loadOrder - b.loadOrder)) {
    const sheets: Record<string, CanonicalSheet> = {};
    let contentHash: string;
    if (registry.sourceFile === "REPOSITORY_RUNTIME") {
      contentHash = sha256Text(JSON.stringify({
        moduleId: registry.moduleId,
        version: registry.moduleVersion,
        source: registry.sourceFile,
      }));
    } else {
      const file = files.get(registry.sourceFile);
      if (!file) throw new Error(`${registry.sourceFile} puudub.`);
      contentHash = sha256Hex(file.buffer);
      if (registry.loadForExercise) {
        const rules = manifest.sheetRules.filter(
          (rule) => rule.moduleId === registry.moduleId &&
            rule.importAtRuntime && runtimeClasses.has(rule.importClass)
        );
        for (const rule of rules) {
          try {
            sheets[rule.sheetName] = canonicalizeSheet(
              await readNamedSheet(file.buffer, rule.sheetName)
            );
          } catch {
            if (rule.requiredSheet || rule.onMissing === "ABORT_IMPORT") {
              throw new Error(`${registry.moduleId}: kohustuslik leht ${rule.sheetName} puudub.`);
            }
          }
        }
      }
    }
    staged.push({
      registry,
      contentHash,
      payload: {
        schemaVersion: 1,
        moduleId: registry.moduleId,
        moduleVersion: registry.moduleVersion,
        moduleType: registry.moduleType,
        sourceFile: registry.sourceFile,
        sheets,
      },
    });
  }
  return staged;
}

async function ensureAuthenticatedUser(): Promise<string> {
  if (!supabase) throw new Error("Supabase pole seadistatud.");
  let { data } = await supabase.auth.getUser();
  if (!data.user) {
    const signedIn = await supabase.auth.signInAnonymously();
    if (signedIn.error) throw signedIn.error;
    data = { user: signedIn.data.user };
  }
  if (!data.user) throw new Error("Supabase autentimine ebaõnnestus.");
  return data.user.id;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return [candidate.message, candidate.details, candidate.hint, candidate.code]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" · ") || JSON.stringify(candidate);
  }
  return String(error);
}

async function isExactActiveNoOp(
  modules: StagedModule[], exerciseId: string, exerciseVersion: string
): Promise<boolean> {
  if (!supabase) return false;
  const { data: existingModules, error: moduleError } = await supabase
    .from("module_versions")
    .select("module_id,module_version,content_hash")
    .in("module_id", modules.map((module) => module.registry.moduleId));
  if (moduleError) throw moduleError;
  const exerciseModule = modules.find((module) => module.registry.moduleType === "EXERCISE_INSTANCE")!;
  const { data: existingExercise, error: exerciseError } = await supabase
    .from("exercise_versions")
    .select("content_hash,is_active")
    .eq("exercise_id", exerciseId)
    .eq("exercise_version", exerciseVersion)
    .maybeSingle();
  if (exerciseError) throw exerciseError;
  return evaluateExactActiveNoOp(
    modules,
    existingModules ?? [],
    existingExercise,
    exerciseModule,
    exerciseId,
    exerciseVersion
  );
}

export function evaluateExactActiveNoOp(
  modules: StagedModule[],
  existingModules: { module_id: string; module_version: string; content_hash: string }[],
  existingExercise: { content_hash: string; is_active: boolean } | null,
  exerciseModule: StagedModule,
  exerciseId: string,
  exerciseVersion: string
): boolean {
  for (const module of modules) {
    const existing = existingModules.find((row) =>
      row.module_id === module.registry.moduleId && row.module_version === module.registry.moduleVersion
    );
    if (existing && existing.content_hash !== module.contentHash) {
      throw new Error(`FATAL module version content conflict for ${module.registry.moduleId}/${module.registry.moduleVersion}`);
    }
    if (!existing) return false;
  }
  if (existingExercise && existingExercise.content_hash !== exerciseModule.contentHash) {
    throw new Error(`FATAL exercise version content conflict for ${exerciseId}/${exerciseVersion}`);
  }
  return Boolean(existingExercise?.is_active);
}

async function persistStagedPackage(
  manifest: ReturnType<typeof parseModuleManifest>,
  modules: StagedModule[],
  exerciseId: string,
  exerciseVersion: string
): Promise<string> {
  if (!supabase) throw new Error("Supabase pole seadistatud.");
  const userId = await ensureAuthenticatedUser();
  const { data: run, error: runError } = await supabase
    .from("import_runs")
    .insert({ manifest_id: manifest.manifestId, manifest_version: manifest.manifestVersion, created_by: userId })
    .select("id")
    .single();
  if (runError) throw runError;
  const importRunId = run.id as string;

  try {
    const moduleIds = new Map<string, string>();
    for (const module of modules) {
      const { data, error } = await supabase.rpc("register_module_version", {
        p_import_run_id: importRunId,
        p_module_id: module.registry.moduleId,
        p_module_version: module.registry.moduleVersion,
        p_module_type: module.registry.moduleType,
        p_source_file: module.registry.sourceFile,
        p_content_hash: module.contentHash,
        p_canonical_payload: module.payload,
        p_load_order: module.registry.loadOrder,
        p_load_for_exercise: module.registry.loadForExercise,
        p_required_for_exercise: module.registry.requiredForExercise,
      });
      if (error) throw error;
      moduleIds.set(module.registry.moduleId, data as string);
    }

    const exerciseModule = modules.find((module) => module.registry.moduleType === "EXERCISE_INSTANCE")!;
    const { data: version, error: versionError } = await supabase
      .from("exercise_versions")
      .insert({
        exercise_id: exerciseId,
        exercise_version: exerciseVersion,
        content_hash: exerciseModule.contentHash,
        canonical_payload: exerciseModule.payload,
        import_run_id: importRunId,
        created_by: userId,
      })
      .select("id")
      .single();
    if (versionError) throw versionError;

    const bindingRows = manifest.bindings.map((binding) => ({
      exercise_version_id: version.id,
      module_version_id: moduleIds.get(binding.requiredModuleId),
      binding_type: binding.bindingType,
      required: binding.bindingType !== "EXCLUDED",
    }));
    if (bindingRows.some((binding) => !binding.module_version_id)) {
      throw new Error("Kõiki ExerciseBinding mooduleid ei registreeritud.");
    }
    const { error: bindingError } = await supabase
      .from("exercise_module_bindings")
      .insert(bindingRows);
    if (bindingError) throw bindingError;

    const staged = await supabase.rpc("stage_import_run", { p_import_run_id: importRunId });
    if (staged.error) throw staged.error;
    const activated = await supabase.rpc("activate_exercise_import", {
      p_import_run_id: importRunId,
      p_exercise_version_id: version.id,
    });
    if (activated.error) throw activated.error;
    return importRunId;
  } catch (error) {
    await supabase.rpc("fail_import_run", {
      p_import_run_id: importRunId,
      p_error_details: { message: formatUnknownError(error) },
    });
    throw error;
  }
}

export async function importModulePackage(
  selectedFiles: ModulePackageFile[]
): Promise<ModulePackageImportResult> {
  try {
    if (!isSupabaseConfigured || !supabase) {
      return { ok: false, issues: [issue("SUPABASE", "Moodulipaketi import vajab Supabase ühendust.")] };
    }
    const duplicateFile = findDuplicate(selectedFiles.map((file) => file.name));
    if (duplicateFile) {
      return { ok: false, issues: [issue("DUPLICATE_FILE", `${duplicateFile} valiti mitu korda.`)] };
    }
    const manifestFile = selectedFiles.find((file) => file.name === moduleManifestFileName);
    if (!manifestFile) {
      return { ok: false, issues: [issue("MANIFEST_FILE", `${moduleManifestFileName} puudub.`)] };
    }

    const fileEntries = await Promise.all(selectedFiles.map(async (file) => [
      file.name,
      { buffer: await new File(file.uri).arrayBuffer() },
    ] as const));
    const files = new Map(fileEntries);
    const manifest = parseModuleManifest(await readManifest(files.get(moduleManifestFileName)!.buffer));
    const manifestIssues = validateModuleManifest(manifest, selectedFiles.map((file) => file.name));
    if (manifestIssues.some((item) => item.severity === "FATAL")) {
      return { ok: false, issues: manifestIssues };
    }

    const modules = await buildStagedModules(files, manifest);
    const packageIssues = validateStagedPackage(modules, manifest);
    if (packageIssues.some((item) => item.severity === "FATAL")) {
      return { ok: false, issues: [...manifestIssues, ...packageIssues] };
    }

    const exercise = modules.find((module) => module.registry.moduleType === "EXERCISE_INSTANCE")!;
    const binding = manifest.bindings.find((item) => item.exerciseModuleId === exercise.registry.moduleId);
    const exerciseId = binding?.exerciseId ?? "";
    const exerciseVersion = exercise.registry.moduleVersion;
    if (!exerciseId) {
      return { ok: false, issues: [issue("EXERCISE_ID", "ExerciseBinding ei määra ExerciseID väärtust.")] };
    }
    await ensureAuthenticatedUser();
    if (await isExactActiveNoOp(modules, exerciseId, exerciseVersion)) {
      return {
        ok: true,
        exerciseId,
        exerciseVersion,
        moduleCount: modules.length,
        noOp: true,
        warnings: manifestIssues.filter((item) => item.severity === "WARNING"),
      };
    }

    const importRunId = await persistStagedPackage(manifest, modules, exerciseId, exerciseVersion);
    return {
      ok: true,
      importRunId,
      exerciseId,
      exerciseVersion,
      moduleCount: modules.length,
      noOp: false,
      warnings: manifestIssues.filter((item) => item.severity === "WARNING"),
    };
  } catch (error) {
    return { ok: false, issues: [issue("IMPORT_FAILED", formatUnknownError(error))] };
  }
}

export async function getActiveModulePackageSummary(): Promise<ActiveModulePackageSummary | undefined> {
  if (!supabase) return undefined;
  const { data, error } = await supabase
    .from("exercise_versions")
    .select("exercise_id,exercise_version")
    .eq("is_active", true)
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return undefined;
  return data ? {
    exerciseId: data.exercise_id as string,
    exerciseVersion: data.exercise_version as string,
  } : undefined;
}

export function formatModuleImportIssues(issues: ModuleImportIssue[]): string {
  const visible = issues.slice(0, 8).map((item) => `${item.code}: ${item.message}`);
  if (issues.length > visible.length) visible.push(`… ja veel ${issues.length - visible.length} viga.`);
  return visible.join("\n");
}
