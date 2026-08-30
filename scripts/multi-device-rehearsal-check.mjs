import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--cleanup') ? 'CLEANUP' : 'PREFLIGHT';
const checks = [];
const add = (name, status, detail) => checks.push({ name, status, detail });
const run = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; } };
const required = (name, envName, detail) => add(name, process.env[envName] === 'PASS' ? 'READY' : 'BLOCKED', process.env[envName] === 'PASS' ? detail : `${envName}=PASS evidence required`);

const head = run('git', ['rev-parse', 'HEAD']);
const remote = run('git', ['rev-parse', 'origin/main']);
add('SOURCE_ALIGNMENT', head && head === remote ? 'READY' : 'BLOCKED', head && remote ? `${head} / ${remote}` : 'Git source unavailable');

const manifestPath = path.join(root, 'dist/field-release/release-manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
const apkPath = manifest ? path.join(root, 'dist/field-release', manifest.artifactFilename) : '';
add('CANONICAL_RELEASE', manifest?.distributable === true && manifest?.sourceDirty === false && fs.existsSync(apkPath) ? 'READY' : 'BLOCKED', manifest ? `${manifest.artifactFilename} @ ${manifest.gitSha}` : 'Release manifest unavailable');
const supabaseHttp = run('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', 'https://fimcsrivizpliiuoqopv.supabase.co/rest/v1/']);
add('SUPABASE_REACHABLE', /^\d{3}$/.test(supabaseHttp) && supabaseHttp !== '000' ? 'READY' : 'BLOCKED', `Production Data API HTTP ${supabaseHttp || 'unreachable'}`);

const devices = run('adb', ['devices']).split('\n').slice(1).filter(line => /\tdevice$/.test(line));
add('ADB_DEVICES', devices.length >= 2 ? 'READY' : devices.length === 1 ? 'WARN' : 'BLOCKED', `${devices.length} connected`);

required('REMOTE_MIGRATIONS', 'RUSSICAPTOR_REHEARSAL_MIGRATIONS', 'Required migration ledger verified');
required('TECHNICAL_ACCOUNTS', 'RUSSICAPTOR_REHEARSAL_ACCOUNTS', 'CM-A, CM-B and EXCON exist; credentials held outside repository');
required('ROLE_CLEAN_STATE', 'RUSSICAPTOR_REHEARSAL_ROLES', mode === 'CLEANUP' ? 'Temporary assignments revoked' : 'No stale active assignments');
required('EXERCISE_STATE', 'RUSSICAPTOR_REHEARSAL_EXERCISE', mode === 'CLEANUP' ? 'Exercise terminal' : 'Clean runtime-continuity fixture ready');
required('CHECKPOINT_STATE', 'RUSSICAPTOR_REHEARSAL_CHECKPOINT', mode === 'CLEANUP' ? 'Terminal checkpoint/archive verified' : 'Durable checkpoint and metadata/hash alignment verified');
required('LEASE_STATE', 'RUSSICAPTOR_REHEARSAL_LEASE', 'No active or stale Runtime lease');
required('PATIENT_STATE', 'RUSSICAPTOR_REHEARSAL_PATIENTS', mode === 'CLEANUP' ? 'Patient ownership cleared' : 'Both rehearsal patients exist and are unowned');

for (const check of checks) console.log(`${check.status} ${check.name} — ${check.detail}`);
// Device count is a deliberately deferred physical gate. A warning is visible,
// but remote-environment readiness remains READY when every blocking gate passes.
const final = checks.some(check => check.status === 'BLOCKED') ? 'BLOCKED' : 'READY';
console.log(`${mode}_${final}`);
process.exitCode = final === 'BLOCKED' ? 2 : 0;
