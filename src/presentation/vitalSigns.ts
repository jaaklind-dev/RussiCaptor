/** Display text only. Never feed formatted values back into clinical state or persistence. */
export type VitalSignDisplayKey = 'systolicBp' | 'diastolicBp' | 'heartRate' |
  'respiratoryRate' | 'spo2' | 'temperature';

export function formatVitalSign(key: VitalSignDisplayKey, value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '–';
  return key === 'temperature' ? value.toFixed(1).replace('.', ',') : String(Math.round(value));
}
