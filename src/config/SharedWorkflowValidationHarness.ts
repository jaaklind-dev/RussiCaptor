/**
 * The multi-device race controls exist solely in signed validation artifacts.
 * Canonical field releases never receive the enabling build variable.
 */
export function isSharedWorkflowValidationHarnessEnabled(environment: Readonly<{
  releaseEnvironment?: string;
  enabled?: string;
}> = {
  releaseEnvironment: process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT,
  enabled: process.env.EXPO_PUBLIC_SHARED_WORKFLOW_VALIDATION_HARNESS,
}): boolean {
  return environment.releaseEnvironment === "production" && environment.enabled === "1";
}
