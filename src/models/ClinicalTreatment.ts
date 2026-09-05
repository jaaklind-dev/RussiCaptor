import type { AlsMedicationCommand, AlsMedicationCommandResult, AlsMedicationId } from "@/models/AlsMedication";
import type { AnalgesicCommand, AnalgesicCommandResult, AnalgesicDrugId } from "@/models/AnalgesiaMedication";
import type { SupportedFluidTherapyCommand, SupportedFluidTherapyCommandResult, SupportedFluidType } from "@/models/FluidTherapy";
import type { MechanicalVentilationCommand, MechanicalVentilationCommandResult } from "@/models/MechanicalVentilation";
import type { NorepinephrineCommand, NorepinephrineCommandResult } from "@/models/NorepinephrineInfusion";
import type { TranexamicAcidCommand, TranexamicAcidCommandResult } from "@/models/TranexamicAcid";

export type ClinicalTreatmentId = SupportedFluidType | "TRANEXAMIC_ACID" | AnalgesicDrugId |
  "NOREPINEPHRINE" | "MECHANICAL_VENTILATION" | AlsMedicationId;

export type ClinicalTreatmentCategory = "FLUIDS" | "HEMOSTASIS" | "ANALGESIA" |
  "VASOACTIVE" | "RESPIRATORY_SUPPORT" | "ALS_MEDICATIONS";

export type ClinicalTreatmentFieldId = "mode" | "route" | "vascularAccessId" | "securedAirwayId" |
  "volumeMl" | "rateMlHour" | "dose" | "doseRate" | "respiratoryRate" | "tidalVolumeMl" |
  "fio2" | "peepCmH2O";

export type ClinicalTreatmentFieldDescriptor = Readonly<{
  fieldId: ClinicalTreatmentFieldId;
  label: string;
  kind: "NUMBER" | "SELECT";
  required: boolean;
  unit?: string;
  minimum?: number;
  maximum?: number;
  options?: readonly string[];
  initialValue?: string;
}>;

export type ClinicalTreatmentDescriptor = Readonly<{
  treatmentId: ClinicalTreatmentId;
  displayName: string;
  aliases: readonly string[];
  category: ClinicalTreatmentCategory;
  commandKind: "FLUID" | "NOREPINEPHRINE" | "TXA" | "ANALGESIC" | "VENTILATION" | "ALS";
  routes: readonly ("IV" | "IO")[];
  requiresVascularAccess: boolean;
  administrationModes: readonly string[];
  fields: readonly ClinicalTreatmentFieldDescriptor[];
  supportsStart: true;
  supportsChange: boolean;
  supportsStop: boolean;
  treatmentShape: "ONE_SHOT" | "COURSE" | "INFUSION" | "DEVICE";
  configurationVersion: string;
}>;

export type ClinicalTreatmentFormValues = Partial<Record<ClinicalTreatmentFieldId, string>>;

export type ClinicalTreatmentCommand =
  | Readonly<{ kind: "FLUID"; command: SupportedFluidTherapyCommand }>
  | Readonly<{ kind: "NOREPINEPHRINE"; command: NorepinephrineCommand }>
  | Readonly<{ kind: "TXA"; command: TranexamicAcidCommand }>
  | Readonly<{ kind: "ANALGESIC"; command: AnalgesicCommand }>
  | Readonly<{ kind: "VENTILATION"; command: MechanicalVentilationCommand }>
  | Readonly<{ kind: "ALS"; command: AlsMedicationCommand }>;

export type ClinicalTreatmentRuntimeResult = SupportedFluidTherapyCommandResult | NorepinephrineCommandResult |
  TranexamicAcidCommandResult | AnalgesicCommandResult | MechanicalVentilationCommandResult |
  AlsMedicationCommandResult;

export type ClinicalTreatmentSubmissionResult = Readonly<{
  treatmentId: ClinicalTreatmentId;
  status: ClinicalTreatmentRuntimeResult["status"] | "UNAVAILABLE";
  message: string;
  protocolClassification?: string;
  rejectionReason?: string;
  runtimeResult?: ClinicalTreatmentRuntimeResult;
}>;

export type ClinicalTreatmentBuildContext = Readonly<{
  patientId: string;
  simulationTimeSec: number;
  commandId: string;
  instanceId: string;
  action?: "START" | "CHANGE" | "STOP";
}>;

export type ActiveClinicalTreatment = Readonly<{
  treatmentId: ClinicalTreatmentId;
  instanceId: string;
  patientId: string;
  displayName: string;
  category: ClinicalTreatmentCategory;
  lifecycle: string;
  detailLines: readonly string[];
  supportsChange: boolean;
  supportsStop: boolean;
  rawProjection: Readonly<Record<string, unknown>>;
}>;
