import { formatVitalSign, type VitalSignDisplayKey } from '../vitalSigns';

const integerKeys: VitalSignDisplayKey[] = ['systolicBp', 'diastolicBp', 'heartRate', 'respiratoryRate', 'spo2'];
describe('presentation-only vital precision', () => {
  test.each(integerKeys)('%s displays nearest integer without changing the number', key => {
    expect(formatVitalSign(key, 104.25)).toBe('104');
    expect(formatVitalSign(key, 95.75)).toBe('96');
    expect(formatVitalSign(key, 0)).toBe('0');
    expect(formatVitalSign(key, -0)).toBe('0');
  });
  test('temperature always has one Estonian decimal place', () => {
    expect(formatVitalSign('temperature', 36)).toBe('36,0');
    expect(formatVitalSign('temperature', 36.86)).toBe('36,9');
    expect(formatVitalSign('temperature', 0)).toBe('0,0');
  });
  test.each([...integerKeys, 'temperature'] as VitalSignDisplayKey[])('%s rejects missing, non-numeric and non-finite inputs', key => {
    for (const value of [undefined, null, NaN, Infinity, -Infinity, '95.75', {}, true]) {
      expect(formatVitalSign(key, value)).toBe('–');
    }
  });
  test('presentation preserves source precision and serialization', () => {
    const values = Object.freeze({ systolicBp: 104.25, diastolicBp: 66.25, heartRate: 95.75, temperature: 36.86 });
    const serialized = JSON.stringify(values);
    for (const key of Object.keys(values) as (keyof typeof values)[]) formatVitalSign(key, values[key]);
    expect(JSON.stringify(values)).toBe(serialized);
  });
});
