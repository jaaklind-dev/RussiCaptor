import { StyleSheet, Text, View } from 'react-native';
import { formatVitalSign, type VitalSignDisplayKey } from '../../../src/presentation/vitalSigns';
import { measurement, type DemoPatient } from './DemoDomain';
import { formatDemoDuration } from './DemoTime';

const fields: readonly [VitalSignDisplayKey, string, string, keyof ReturnType<typeof measurement>][] = [
  ['heartRate', 'Pulss', '/min', 'heartRate'], ['systolicBp', 'RR süstoolne', 'mmHg', 'systolicBloodPressure'],
  ['diastolicBp', 'RR diastoolne', 'mmHg', 'diastolicBloodPressure'], ['respiratoryRate', 'Hingamissagedus', '/min', 'respiratoryRate'],
  ['spo2', 'SpO₂', '%', 'oxygenSaturation'], ['temperature', 'Temperatuur', '°C', 'temperature'],
];
/** Demo-owned presentation adapter: canonical VitalsTab and its numerical inputs remain untouched. */
export default function DemoVitalsCard({ patient, sessionId }: Readonly<{ patient: DemoPatient; sessionId: string }>) {
  const values = measurement(patient, sessionId);
  const label = `T+${formatDemoDuration(patient.vitals.timestamp)} · Stsenaarium`;
  return <View style={styles.card}><Text style={styles.heading}>Elulised näitajad</Text><Text>{label}</Text>
    <View style={styles.grid}>{fields.map(([key, title, unit, property]) => {
      const value = formatVitalSign(key, values[property]);
      return <View key={key} style={styles.value}><Text>{title}</Text><Text style={styles.number}>{value}{value === '–' ? '' : ` ${unit}`}</Text></View>;
    })}</View><Text>GCS {values.gcs} · EtCO₂ {values.etco2} mmHg</Text>
    <Text style={styles.heading}>Mõõtmiste ajalugu</Text><Text>{label}</Text>
    <Text>RR {formatVitalSign('systolicBp', values.systolicBloodPressure)}/{formatVitalSign('diastolicBp', values.diastolicBloodPressure)} · HR {formatVitalSign('heartRate', values.heartRate)} · RR {formatVitalSign('respiratoryRate', values.respiratoryRate)} · SpO₂ {formatVitalSign('spo2', values.oxygenSaturation)}%</Text>
  </View>;
}
const styles = StyleSheet.create({ card: { padding: 18, gap: 8, backgroundColor: '#f1f5f9', borderRadius: 16 },
  heading: { fontSize: 22, fontWeight: '700' }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  value: { width: '47%', padding: 12, borderRadius: 12, backgroundColor: '#fff' }, number: { fontSize: 24, fontWeight: '700' } });
