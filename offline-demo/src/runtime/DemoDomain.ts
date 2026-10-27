import { bootstrapHemorrhagePatientProcess, setHemorrhageEffects, tickHemorrhagePatientProcess } from '../../../src/services/runtime/HemorrhagePatientProcess';
import { bootstrapPleuralInjuryPatientProcess, tickPleuralInjuryPatientProcess } from '../../../src/services/runtime/PleuralInjuryPatientProcess';
import { bootstrapRespiratoryFailurePatientProcess, tickRespiratoryFailurePatientProcess } from '../../../src/services/runtime/RespiratoryFailurePatientProcess';
import { defaultVitalSignConfiguration, VitalSignEngine } from '../../../src/services/runtime/vitals/VitalSignEngine';
import { projectVitalSignState } from '../../../src/services/runtime/vitals/VitalSignProjection';
import type { VitalSignContributor, VitalSignState } from '../../../src/models/VitalSign';

export const DEMO_FIXTURE = 'russicaptor.demo-trauma-pair@1.0.0';
export const DEMO_MAX_SECONDS = 900;
export const DEMO_PATIENTS = Object.freeze([
  Object.freeze({ id: 'DEMO-PT-A', name: 'Sünteetiline patsient A', triage: 'P1', presentation: 'Vaagnatrauma pärast sünteetilist kõrguselt kukkumist. Võimalik vaagnapiirkonna verejooks.' }),
  Object.freeze({ id: 'DEMO-PT-B', name: 'Sünteetiline patsient B', triage: 'P1', presentation: 'Rindkeretrauma. Sünteetiline hemopneumotooraks ja süvenev hingamispuudulikkus.' }),
] as const);
// Separate synthetic fixture. Values reproduce PELVIC_HEMORRHAGE_REFERENCE_CONFIGURATION;
// only B's source rate follows the existing default pleural blood accumulation rate.
// This composition is NOT a clinically validated exercise package.
const hemorrhageConfiguration = {
  baselineBleedingRateMlMin: 140, tourniquetEfficiency: 0, binderEfficiency: 0.6,
  infusionOffsetMlMin: 0, bloodProductOffsetMlMin: 0, severityThresholdsMl: [300, 700, 1200, 1800],
  perfusionThresholdsMl: [600, 1100, 1700], compensationThresholdsMl: [900, 1600],
  trendThresholdsMlMin: { worsening: 80, improving: 30 },
  vitalResponsePer1000Ml: { heartRateDelta: 35, systolicBpDelta: -35, diastolicBpDelta: -20, crtDelta: 2 },
};
type Hemorrhage = ReturnType<typeof bootstrapHemorrhagePatientProcess>;
type Pleural = ReturnType<typeof bootstrapPleuralInjuryPatientProcess>;
type Respiration = ReturnType<typeof bootstrapRespiratoryFailurePatientProcess>;
export type DemoPatient = { id: string; hemorrhage: Hemorrhage; pleural?: Pleural; respiration?: Respiration; vitals: VitalSignState };
function vitals(time: number, hemorrhage: Hemorrhage, respiration?: Respiration, previous?: VitalSignState): VitalSignState {
  const contributors: VitalSignContributor[] = [hemorrhage.outputs, ...(respiration ? [respiration.outputs] : [])].flatMap(output =>
    (output.vitalContributions ?? []).map((value, index) => ({ ...value, contributorId: `${output.processId}:${index}`,
      sourceId: output.processId, sourceType: 'PATIENT_PROCESS' as const, layer: 'PROCESS' as const })));
  return new VitalSignEngine().resolve({ timestamp: time, configuration: defaultVitalSignConfiguration, previous, contributors }).state;
}
export function initialPatients(): DemoPatient[] {
  const patients = DEMO_PATIENTS.map(({ id }, index) => {
    const pleural = index === 1 ? bootstrapPleuralInjuryPatientProcess(id, {}) : undefined;
    const hemorrhage = bootstrapHemorrhagePatientProcess(id, { sourceType: index === 0 ? 'PELVIC' : 'THORACIC',
      estimatedBloodLossMl: pleural?.clinicalState.bloodBurdenMl ?? 0,
      configuration: { ...hemorrhageConfiguration, baselineBleedingRateMlMin: pleural?.configuration.bloodAccumulationPerMin ?? 140 } });
    const respiration = index === 1 ? bootstrapRespiratoryFailurePatientProcess({ fixtureId: 'DEMO-THORACIC-V1', patientId: id }, { phenotype: 'HYPOXAEMIC' }) : undefined;
    return { id, hemorrhage, ...(pleural ? { pleural } : {}), ...(respiration ? { respiration } : {}), vitals: vitals(0, hemorrhage, respiration) };
  });
  // The local persistence representation is JSON, including its signed-zero normalization.
  return JSON.parse(JSON.stringify(patients)) as DemoPatient[];
}
export function advancePatients(patients: readonly DemoPatient[], time: number): DemoPatient[] {
  return patients.map(patient => {
    if (patient.vitals.timestamp !== time - 1) throw new Error('DEMO_CLOCK_INCOHERENT');
    const hemorrhage = tickHemorrhagePatientProcess(patient.hemorrhage, 1, patient.vitals.readings.systolicBp.current).process;
    const pleural = patient.pleural ? tickPleuralInjuryPatientProcess(patient.pleural, 1) : undefined;
    const respiration = patient.respiration ? tickRespiratoryFailurePatientProcess(patient.respiration, 1,
      Number(pleural?.outputs.runtimeContributions?.respiratoryImpairmentMultiplier ?? 1)) : undefined;
    return { id: patient.id, hemorrhage, ...(pleural ? { pleural } : {}), ...(respiration ? { respiration } : {}),
      vitals: vitals(time, hemorrhage, respiration, patient.vitals) };
  });
}
export function applyBinder(patients: readonly DemoPatient[], commandId: string, time: number): DemoPatient[] {
  return patients.map(patient => patient.id !== 'DEMO-PT-A' ? patient : { ...patient,
    hemorrhage: setHemorrhageEffects(patient.hemorrhage, [{ effectId: commandId, effectType: 'PELVIC_STABILIZATION',
      encounterId: patient.id, patientId: patient.id, timestamp: time, sourceInterventionInstanceId: commandId, parameters: { position: 'CORRECT' } }]) });
}
export function measurement(patient: DemoPatient, sessionId: string) {
  const projection = projectVitalSignState(patient.vitals).displayedVitals;
  return { id: `DEMO-MEASUREMENT-${patient.id}`, exerciseId: sessionId, patientId: patient.id,
    exerciseMinute: patient.vitals.timestamp / 60, source: 'scenario' as const,
    heartRate: projection.hr, systolicBloodPressure: projection.sbp, diastolicBloodPressure: projection.dbp,
    respiratoryRate: projection.rr, oxygenSaturation: projection.spo2, temperature: projection.temperature,
    gcs: patient.vitals.readings.gcs.current, etco2: patient.vitals.readings.etco2.current };
}
