import type { DemoBuilderDraft } from './DemoBuilderDraft';
/** Future contract ONLY. No implementation, runtime import, route or Start control. */
export type DemoFrozenDefinitionCandidate = Readonly<{ definitionSchemaVersion: number; definitionId: string;
  sourceDraftId: string; sourceRevision: number; canonicalContent: string; contentDigest: string }>;
export interface FutureDemoDraftActivation {
  prepare(draft: Readonly<DemoBuilderDraft>): DemoFrozenDefinitionCandidate;
  activate(candidate: DemoFrozenDefinitionCandidate, expectedSession: Readonly<{ sessionId: string; generation: number }>): void;
}
