import type { ImportCellValue, ModuleImportIssue } from "@/models/ModuleImport";
import type { PackageSpecificValidator } from "./PackageSpecificValidator";

const text = (value: ImportCellValue | undefined) => value === null || value === undefined ? "" : String(value).trim();
const fatal = (code: string, message: string): ModuleImportIssue => ({ severity: "FATAL", code, message });

export const botulismPackageValidator: PackageSpecificValidator = {
  validatorId: "russicaptor.botulism.v1",
  applies: ({ modules }) => modules.some((module) => module.registry.moduleId === "BOTULISM_V1"),
  validate: ({ modules, exercise }) => {
    const issues: ModuleImportIssue[] = [];
    const patients = exercise.payload.sheets.PatientRoster?.rows ?? [];
    const processes = exercise.payload.sheets.PatientProcessAssignments?.rows ?? [];
    const settings = exercise.payload.sheets.ScenarioSettings?.rows ?? [];
    const expectedPatients = Number(settings.find((row) => text(row.SettingID) === "PatientCountExpected")?.Value);
    const expectedPerPatient = Number(settings.find((row) => text(row.SettingID) === "ProcessesPerPatientExpected")?.Value);
    if (!Number.isFinite(expectedPatients) || patients.length !== expectedPatients) {
      issues.push(fatal("PATIENT_COUNT", `Patsiente on ${patients.length}, oodatud ${expectedPatients}.`));
    }
    if (!Number.isFinite(expectedPerPatient) || processes.length !== expectedPatients * expectedPerPatient) {
      issues.push(fatal("PROCESS_COUNT", `PatientProcess ridu on ${processes.length}, oodatud ${expectedPatients * expectedPerPatient}.`));
    }
    for (const patientId of patients.map((row) => text(row.PatientID))) {
      const count = processes.filter((row) => text(row.PatientID) === patientId).length;
      if (count !== expectedPerPatient) issues.push(fatal("PROCESSES_PER_PATIENT", `${patientId} protsesside arv on ${count}, oodatud ${expectedPerPatient}.`));
    }
    const pt012 = patients.find((row) => text(row.PatientID) === "PT-012");
    if (!pt012 || text(pt012.ArrivalClock) !== "13:35") {
      issues.push(fatal("PT012_ARRIVAL", "PT-012 saabumisaeg peab olema 13:35."));
    }
    const triggers = modules.flatMap((module) => module.payload.sheets.TriggerRules?.rows ?? []);
    const severe = triggers.filter((row) => [text(row.ChildTemplateID), text(row.ChildTemplateOrEvent)].includes("HV_NM_SEV"));
    if (!severe.length || severe.some((row) => text(row.ParentTransition) !== "RESOLVE_AND_REPLACE" || text(row.Repeatable) !== "FALSE")) {
      issues.push(fatal("HV_CHILD_REPLACEMENT", "HV_NM_SEV trigger peab olema mittekorduv ja kasutama RESOLVE_AND_REPLACE üleminekut."));
    }
    const hypoxia = triggers.filter((row) => [text(row.ChildTemplateID), text(row.ChildTemplateOrEvent)].includes("HYP_HYPOVENT_MOD"));
    if (!hypoxia.length || hypoxia.some((row) => text(row.Repeatable) !== "FALSE")) {
      issues.push(fatal("HYPOXIA_CHILD_IDEMPOTENCY", "HYP_HYPOVENT_MOD child trigger peab olema mittekorduv."));
    }
    const serialized = JSON.stringify(modules.map((module) => module.payload));
    for (const forbidden of ["TRG-RESP-01", "WORK-B-PAIR"]) if (serialized.includes(forbidden)) {
      issues.push(fatal("DEPRECATED_REFERENCE", `${forbidden} viide on aktiivses payload'is keelatud.`));
    }
    return issues;
  },
};

