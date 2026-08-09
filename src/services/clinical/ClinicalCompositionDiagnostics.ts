export type ModuleCompositionDiagnosticSeverity = "INFO" | "WARNING" | "ERROR";

export type ModuleCompositionDiagnosticCode =
  | "COMPOSITION_COMPLETE"
  | "INVALID_DEPENDENCY_VERSION"
  | "MISSING_DEPENDENCY"
  | "VERSION_MISMATCH"
  | "DUPLICATE_MODULE_ID"
  | "CYCLIC_DEPENDENCY"
  | "INCOMPATIBLE_MODULE"
  | "DUPLICATE_PATIENT_PROCESS"
  | "DUPLICATE_CLINICAL_EFFECT"
  | "DUPLICATE_INTERVENTION"
  | "DUPLICATE_MEDICATION"
  | "DUPLICATE_ASSESSMENT_RULE"
  | "DUPLICATE_ANALYTICS_PROVIDER"
  | "DUPLICATE_METRIC_PROVIDER"
  | "DUPLICATE_CAPABILITY"
  | "DUPLICATE_OBJECTIVE"
  | "DUPLICATE_VALIDATION_RULE";

export type ModuleCompositionDiagnostic = Readonly<{
  severity: ModuleCompositionDiagnosticSeverity;
  code: ModuleCompositionDiagnosticCode;
  moduleId?: string;
  message: string;
}>;

export const diagnostic = (
  severity: ModuleCompositionDiagnosticSeverity,
  code: ModuleCompositionDiagnosticCode,
  message: string,
  moduleId?: string,
): ModuleCompositionDiagnostic => Object.freeze({ severity, code, moduleId, message });

export const sortCompositionDiagnostics = (values: readonly ModuleCompositionDiagnostic[]): readonly ModuleCompositionDiagnostic[] => Object.freeze(
  [...values].sort((left, right) => left.severity.localeCompare(right.severity)
    || left.code.localeCompare(right.code)
    || (left.moduleId ?? "").localeCompare(right.moduleId ?? "")
    || left.message.localeCompare(right.message)),
);
