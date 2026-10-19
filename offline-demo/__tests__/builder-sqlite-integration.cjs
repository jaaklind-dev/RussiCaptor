// Runs the installed Expo SQLiteStorage implementation against actual SQLite SQL.
// Only its Android native transport is replaced by node:sqlite; this is not physical acceptance.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite'), ts = require('typescript'), assert = require('node:assert/strict');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-builder-sqlite-'));
const file = path.join(directory, 'builder.db');
const handles = [];
let interrupt = false, transactions = 0;
function openDatabaseSync() {
  const database = new DatabaseSync(file); handles.push(database);
  return {
    getFirstSync: (sql, ...params) => database.prepare(sql).get(...params),
    runSync: (sql, ...params) => { const result = database.prepare(sql).run(...params); if (interrupt && sql.startsWith('INSERT')) throw Error('INTERRUPTED'); return result; },
    execSync: sql => database.exec(sql),
    withTransactionSync: fn => { transactions++; database.exec('BEGIN IMMEDIATE'); try { fn(); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; } },
  };
}
const storageFile = path.join(process.cwd(), 'node_modules/expo-sqlite/src/Storage.ts');
const code = ts.transpileModule(fs.readFileSync(storageFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleObject = { exports: {} };
new Function('require', 'module', 'exports', code)(id => {
  if (id === './index') return { openDatabaseSync };
  if (id === './paramUtils') return { normalizeStorageIndex: n => n };
  if (id === 'await-lock') return class AwaitLock {};
  throw Error('Unexpected installed adapter dependency: ' + id);
}, moduleObject, moduleObject.exports);
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true },
}).outputText, filename);
const { DemoBuilderStore, BUILDER_KEY } = require('../src/builder/DemoBuilderStore.ts');
const { SQLiteStorage } = moduleObject.exports;
try {
  const storage = new SQLiteStorage('builder.db');
  const store = new DemoBuilderStore(storage); const created = store.create();
  const next = { ...created, name: 'SQLite päris SQL' };
  const saved = store.save(next, 0); assert.equal(saved.revision, 1);
  const restarted = new DemoBuilderStore(new SQLiteStorage('builder.db')); assert.deepEqual(restarted.list(), [saved]);
  assert.throws(() => restarted.save(next, 0), /REVISION_CONFLICT/);
  const original = storage.getItemSync(BUILDER_KEY); interrupt = true;
  assert.throws(() => store.save({ ...saved, name: 'not committed' }, 1), /STORAGE_UNAVAILABLE/);
  interrupt = false; assert.equal(storage.getItemSync(BUILDER_KEY), original);
  store.delete(saved.draftId, 1); assert.equal(restarted.list().length, 0);
  storage.setItemSync(BUILDER_KEY, JSON.stringify({ schemaVersion: 99, drafts: [] }));
  assert.throws(() => store.create(), /SCHEMA_INVALID/);
  assert.equal(JSON.parse(storage.getItemSync(BUILDER_KEY)).schemaVersion, 99);
  assert.ok(transactions >= 7); console.log(JSON.stringify({ status: 'PASS', installedExpoAdapter: true, actualSQLite: true, transactions, nativeAndroidTested: false }));
} finally { handles.forEach(handle => handle.close()); fs.unlinkSync(file); fs.rmdirSync(directory); }
