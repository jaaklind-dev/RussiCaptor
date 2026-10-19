import { BUILDER_CAPABILITIES as C } from './DemoBuilderCapabilities';
import { builderId, type DemoBuilderDraft } from './DemoBuilderDraft';
import { exactKeys, validateBuilderDraft, type BuilderIssue } from './DemoBuilderValidation';
export const BUILDER_DATABASE = 'russicaptor-offline-demo-builder-v1.db';
export const BUILDER_KEY = 'russicaptor.offline-demo.builder.collection.v1';
export type BuilderStorage = { getItemSync(key: string): string | null; setItemSync(key: string, update: (previous: string | null) => string): void };
type Collection = { schemaVersion: 1; drafts: DemoBuilderDraft[] };
export class DemoBuilderError extends Error {
  constructor(readonly category: BuilderIssue['category'] | 'STORAGE_UNAVAILABLE', readonly issues: BuilderIssue[] = []) { super(category); }
}
function parse(raw: string | null): Collection {
  if (raw === null) return { schemaVersion: 1, drafts: [] };
  if (raw.length > C.maxStoreChars) throw new DemoBuilderError('SCHEMA_INVALID');
  let value: unknown; try { value = JSON.parse(raw); } catch { throw new DemoBuilderError('SCHEMA_INVALID'); }
  if (!exactKeys(value, 'schemaVersion,drafts') || value.schemaVersion !== 1 || !Array.isArray(value.drafts) || value.drafts.length > C.maxDrafts) throw new DemoBuilderError('SCHEMA_INVALID');
  const ids = new Set<string>();
  for (const d of value.drafts) {
    const issues = validateBuilderDraft(d, false);
    if (issues.length) throw new DemoBuilderError(issues[0].category, issues);
    if (d.validationReceipt && validateBuilderDraft(d).length) throw new DemoBuilderError('SCHEMA_INVALID');
    if (ids.has(d.draftId)) throw new DemoBuilderError('SCHEMA_INVALID'); ids.add(d.draftId);
  }
  return value as unknown as Collection;
}
/** SQLiteStorage's updater executes read/CAS/write in one synchronous transaction.
 * No async work may enter this callback. No other database or key is accessible here. */
export class DemoBuilderStore {
  constructor(private readonly storage: BuilderStorage, private readonly clock = () => new Date().toISOString(), private readonly ids = () => builderId('DEMO-DRAFT')) {}
  list(): DemoBuilderDraft[] { return structuredClone(parse(this.storage.getItemSync(BUILDER_KEY)).drafts); }
  private commit(change: (state: Collection) => void) {
    let expected: string | undefined;
    try {
      this.storage.setItemSync(BUILDER_KEY, previous => {
        const state = parse(previous); change(state); expected = JSON.stringify(state); parse(expected); return expected;
      });
    } catch (error) {
      if (error instanceof DemoBuilderError) throw error;
      // A lost response is accepted only after exact readback of this transaction's value.
      if (expected === undefined || this.storage.getItemSync(BUILDER_KEY) !== expected) throw new DemoBuilderError('STORAGE_UNAVAILABLE');
    }
    if (expected === undefined || this.storage.getItemSync(BUILDER_KEY) !== expected) throw new DemoBuilderError('STORAGE_UNAVAILABLE');
  }
  create(): DemoBuilderDraft {
    let created!: DemoBuilderDraft;
    this.commit(state => {
      if (state.drafts.length >= C.maxDrafts) throw new DemoBuilderError('UNSUPPORTED_CAPABILITY');
      const draftId = this.ids(); if (state.drafts.some(d => d.draftId === draftId)) throw new DemoBuilderError('REVISION_CONFLICT');
      const time = this.clock(); created = { schemaVersion: 1, capabilityVersion: C.version, draftId, revision: 0,
        name: '', description: '', createdAt: time, modifiedAt: time, patients: [], validationReceipt: null };
      state.drafts.push(created);
    }); return structuredClone(created);
  }
  save(input: DemoBuilderDraft, expectedRevision: number, validate = false): DemoBuilderDraft {
    // Validate the original graph before a clone can normalize its prototype.
    const inputIssues = validateBuilderDraft(input, false);
    if (inputIssues.length) throw new DemoBuilderError(inputIssues[0].category, inputIssues);
    let saved!: DemoBuilderDraft;
    this.commit(state => {
      const index = state.drafts.findIndex(d => d.draftId === input.draftId), current = state.drafts[index];
      if (!current || current.revision !== expectedRevision || input.revision !== expectedRevision || input.createdAt !== current.createdAt) throw new DemoBuilderError('REVISION_CONFLICT');
      saved = { ...structuredClone(input), revision: current.revision + 1, modifiedAt: this.clock(), validationReceipt: null };
      const issues = validateBuilderDraft(saved, validate); if (issues.length) throw new DemoBuilderError(issues[0].category, issues);
      if (validate) saved.validationReceipt = { validatorVersion: 'MVP1-V1', validatedRevision: saved.revision };
      state.drafts[index] = saved;
    }); return structuredClone(saved);
  }
  delete(id: string, revision: number) {
    this.commit(state => {
      const index = state.drafts.findIndex(d => d.draftId === id);
      if (index < 0 || state.drafts[index].revision !== revision) throw new DemoBuilderError('REVISION_CONFLICT');
      state.drafts.splice(index, 1);
    });
  }
}
