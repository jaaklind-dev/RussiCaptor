import type { RuntimeCheckpointEnvelope } from "@/models/RuntimeCheckpointAuthority";
import type { SharedExerciseState } from "@/models/SharedExerciseState";

export type ProjectionPackageAuthority = Readonly<{
  exerciseId: string;
  lifecycle: string;
  packageId?: string;
  packageVersion?: string;
}>;

/** An authored reference may never silently become the demo package. */
export function referencedPackageAvailable(
  reference: SharedExerciseState["exercisePackageReference"],
  lookup: (packageId: string, packageVersion: string) => unknown,
): boolean {
  return !reference || Boolean(lookup(reference.packageId, reference.packageVersion));
}

function lifecycleOf(state: SharedExerciseState): string {
  const session = state.exerciseSession;
  return "lifecycleState" in session ? session.lifecycleState
    : session.state === "running" ? "RUNNING" : session.state === "paused" ? "PAUSED" : "READY";
}

export function projectionPackageAuthority(state: SharedExerciseState): ProjectionPackageAuthority {
  return Object.freeze({
    exerciseId: state.exerciseSession.exerciseId,
    lifecycle: lifecycleOf(state),
    ...(state.exercisePackageReference?.packageId ? { packageId: state.exercisePackageReference.packageId } : {}),
    ...(state.exercisePackageReference?.packageVersion ? { packageVersion: state.exercisePackageReference.packageVersion } : {}),
  });
}

function samePackage(a: ProjectionPackageAuthority, b: ProjectionPackageAuthority): boolean {
  return Boolean(a.packageId && a.packageVersion &&
    a.packageId === b.packageId && a.packageVersion === b.packageVersion);
}

/**
 * A projection may never introduce a package identity that disagrees with an
 * already-discovered active projection or a validated local checkpoint for
 * the same exercise. New READY exercises without either authority remain
 * publishable through the existing EXCON creation path.
 */
export function canPublishProjectionWithPackageAuthority(
  candidate: SharedExerciseState,
  discovered: ProjectionPackageAuthority | undefined,
  checkpoint: RuntimeCheckpointEnvelope<SharedExerciseState> | undefined,
): boolean {
  const identity = projectionPackageAuthority(candidate);
  if (discovered?.exerciseId === identity.exerciseId &&
    (discovered.lifecycle === "RUNNING" || discovered.lifecycle === "PAUSED") &&
    !samePackage(identity, discovered)) return false;
  if (checkpoint?.exerciseId === identity.exerciseId) {
    const checkpointIdentity = projectionPackageAuthority(checkpoint.payload);
    if (!samePackage(identity, checkpointIdentity)) return false;
  }
  return true;
}
