import { presetById } from './DemoBuilderCapabilities';

export type DemoBuilderPatient = {
  patientId: string; displayName: string; age: number; sex: 'F' | 'M' | 'OTHER' | 'UNKNOWN';
  triage: 'P1' | 'P2' | 'P3' | 'P4'; initialLocation: string; clinicalPresetId: string; presetVersion: string;
  initialInputs: { configurationId: string };
  laboratory: { panelId: string; delaySeconds: number };
  imaging: { examinationId: string; assetId: string; reportId: string; sha256: string; delaySeconds: number }[];
};
export type DemoBuilderDraft = { schemaVersion: 1; capabilityVersion: string; revision: number; draftId: string;
  name: string; description: string; createdAt: string; modifiedAt: string; patients: DemoBuilderPatient[];
  validationReceipt: null | { validatorVersion: 'MVP1-V1'; validatedRevision: number } };
let counter = 0;
export function builderId(prefix: 'DEMO-DRAFT' | 'DEMO-PATIENT'): string {
  return `${prefix}-${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
export function withPreset(patient: DemoBuilderPatient, id: string): DemoBuilderPatient {
  const p = presetById(id); if (!p) throw new Error('UNSUPPORTED_CAPABILITY');
  return { ...patient, clinicalPresetId: p.id, presetVersion: p.version, initialInputs: { configurationId: p.configurationId },
    laboratory: { panelId: 'DEMO_TRAUMA_BASIC_V1', delaySeconds: 30 },
    imaging: [{ examinationId: p.asset.examinationId, assetId: p.asset.assetId, reportId: p.asset.reportId,
      sha256: p.asset.sha256, delaySeconds: 30 }] };
}
export function newBuilderPatient(id = builderId('DEMO-PATIENT'), preset = 'PELVIC'): DemoBuilderPatient {
  return withPreset({ patientId: id, displayName: 'Sünteetiline patsient', age: 35, sex: 'UNKNOWN', triage: 'P1',
    initialLocation: 'DEMO_ED' } as DemoBuilderPatient, preset);
}
/** A mutation always invalidates the previous receipt; saving owns the next revision. */
export function editBuilderDraft(draft: DemoBuilderDraft, update: Partial<Pick<DemoBuilderDraft, 'name' | 'description' | 'patients'>>): DemoBuilderDraft {
  return { ...draft, ...structuredClone(update), validationReceipt: null };
}
