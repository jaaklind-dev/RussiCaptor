import { execFileSync } from 'node:child_process';
import path from 'node:path';
test('installed Expo SQLiteStorage: real SQL transaction rollback, restart and CAS', () => {
  const output = execFileSync(process.execPath, [path.join(process.cwd(), 'offline-demo/__tests__/builder-sqlite-integration.cjs')], { encoding: 'utf8' });
  expect(JSON.parse(output)).toMatchObject({ status: 'PASS', installedExpoAdapter: true, actualSQLite: true, nativeAndroidTested: false });
});
