import { ImagingWorkflowCore } from '../../../src/services/runtime/imaging/ImagingWorkflowCore';
import type { ImagingAssetReference } from '../../../src/models/ImagingAsset';
import type { ImagingWorkflowSnapshot, ImagingOrderDefinitionSnapshot } from '../../../src/models/ImagingWorkflow';
import manifest from '../../assets/imaging/manifest.json';

export const DEMO_IMAGING_DELAY_SEC = 30;
export const DEMO_IMAGING_PACKAGE = manifest.fixtureVersion;
export const DEMO_IMAGING_ASSETS = manifest.assets;
export type DemoImagingCommand = Readonly<{id: string; sessionId: string; generation: number; time: number;
  patientId: 'DEMO-PT-A' | 'DEMO-PT-B'; type: 'IMAGING_ORDER'; examinationId: string}>;

/** Structural equality only. No canonical serializer, tracing, hashing service or singleton is imported. */
export function imagingEqual(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key =>
      [key, normalize((value as Record<string, unknown>)[key])])) : value;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
export function demoImagingDefinition(patientId: string) {
  const definition = DEMO_IMAGING_ASSETS.find(asset => asset.patientId === patientId);
  if (!definition) throw new Error('DEMO_IMAGING_PATIENT_INVALID');
  return definition;
}
export function demoImagingAsset(patientId: string): ImagingAssetReference {
  const d = demoImagingDefinition(patientId);
  return { assetId: d.assetId, sourceKind: 'BUNDLED_LOCAL', resolverKey: d.file, sha256: d.sha256,
    mediaType: d.format, width: d.width, height: d.height, role: 'PRIMARY_DIAGNOSTIC_IMAGE',
    packageId: DEMO_IMAGING_PACKAGE, packageVersion: d.version, patientId: d.patientId, definitionId: d.examinationId,
    provenance: { attribution: d.attribution, contributor: d.creator, licenseId: d.license,
      ...(d.licenseUrl ? {licenseUrl: d.licenseUrl, sourceUrl: d.source} : {}), modificationNote: d.modification } };
}
export function validateDemoImagingAsset(asset: ImagingAssetReference) {
  if (!DEMO_IMAGING_ASSETS.some(d => imagingEqual(asset, demoImagingAsset(d.patientId)))) throw new Error('DEMO_IMAGING_ASSET_INVALID');
}
// These reviewed digest values are generated at source preparation and checked against real SHA-256 in tests/build verification.
// Only the two closed authored reports are accepted. No untrusted report or remote lookup is supported.
export const DEMO_REPORT_HASHES: Readonly<Record<string, string>> = Object.freeze({
  'DEMO-PELVIS-REPORT-v1': '4bf21a988fa880ca134a2d8189e2e2e0b0996f1cba6c236af7a4de434c51acb0',
  'DEMO-CHEST-REPORT-v1': '411cb9a4b1744b480644f6844d4d1eb199216d733ffe6049aec3e5263478d606',
});
function runtime() {
  return new ImagingWorkflowCore({
    hashReport: text => {
      const d = DEMO_IMAGING_ASSETS.find(asset => asset.report === text);
      const hash = d && DEMO_REPORT_HASHES[d.reportId];
      if (!hash) throw new Error('DEMO_IMAGING_REPORT_INVALID');
      return hash;
    }, equal: imagingEqual, validateAsset: validateDemoImagingAsset,
    adaptLegacy: () => { throw new Error('DEMO_IMAGING_LEGACY_IMPORT_FORBIDDEN'); },
  });
}
export const emptyDemoImaging = (): ImagingWorkflowSnapshot => runtime().snapshot();
export function demoImagingCommandId(sessionId: string, patientId: string, examinationId: string) {
  return `DEMO-CMD-${sessionId}:imaging:${patientId}:${examinationId}`;
}
export function orderDemoImaging(state: ImagingWorkflowSnapshot, c: DemoImagingCommand): ImagingWorkflowSnapshot {
  const d = demoImagingDefinition(c.patientId);
  if (c.examinationId !== d.examinationId) throw new Error('DEMO_IMAGING_SCOPE_INVALID');
  if (state.instances.some(i => i.patientId === c.patientId)) throw new Error('DEMO_IMAGING_REPEAT_UNAVAILABLE');
  const engine = runtime(); engine.restore(state);
  const definition: ImagingOrderDefinitionSnapshot = {definitionId: d.examinationId, patientId: d.patientId,
    title: d.patientId === 'DEMO-PT-A' ? 'Vaagna röntgen' : 'Rindkere röntgen', modality: 'XR',
    reportSource: d.report, asset: demoImagingAsset(d.patientId), delaySeconds: DEMO_IMAGING_DELAY_SEC,
    packageId: DEMO_IMAGING_PACKAGE, packageVersion: d.version, packageHash: DEMO_REPORT_HASHES[d.reportId]};
  engine.order({commandId:c.id,exerciseId:c.sessionId,patientId:c.patientId,orderedBy:'OFFLINE_DEMO_LOCAL_CM',
    orderedAtSimulationTimeSec:c.time,definition});
  return engine.snapshot();
}
export function advanceDemoImaging(state: ImagingWorkflowSnapshot, time: number) {
  const engine=runtime();engine.restore(state);
  const completed=engine.advanceTo(time).filter(instance=>instance.status==='RESULTED').map(instance=>instance.orderCommandId);
  return {state:engine.snapshot(),completed};
}
