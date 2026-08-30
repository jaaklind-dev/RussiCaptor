import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('WP-NEXT-08 rehearsal preparation', () => {
  test('preflight and cleanup fail closed on missing remote evidence', () => {
    const script = read('scripts/multi-device-rehearsal-check.mjs');
    for (const gate of ['RUSSICAPTOR_REHEARSAL_MIGRATIONS', 'RUSSICAPTOR_REHEARSAL_ACCOUNTS', 'RUSSICAPTOR_REHEARSAL_ROLES', 'RUSSICAPTOR_REHEARSAL_EXERCISE', 'RUSSICAPTOR_REHEARSAL_CHECKPOINT', 'RUSSICAPTOR_REHEARSAL_LEASE', 'RUSSICAPTOR_REHEARSAL_PATIENTS']) expect(script).toContain(gate);
    expect(script).toContain("process.argv.includes('--cleanup')");
    expect(script).toContain("check.status === 'BLOCKED'");
    expect(script).not.toMatch(/service[_-]?role|password/i);
  });

  test('field documents retain the deferred physical gates', () => {
    const docs = ['docs/RUSSICAPTOR_MULTI_DEVICE_GO_NO_GO_CHECKLIST.md', 'docs/RUSSICAPTOR_MULTI_DEVICE_ACCEPTANCE_WORKSHEET.md', 'docs/RUSSICAPTOR_DRESS_REHEARSAL_OPERATOR_SCRIPT.md'].map(read).join('\n');
    expect(docs).toContain('PT-PELVIC-001');
    expect(docs).toContain('PT-PLEURAL-001');
    expect(docs).toContain('REQUIRES_2_DEVICES');
    expect(docs).toContain('STOP');
  });
});
