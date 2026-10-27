import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const demoKey = path.join(os.homedir(), 'Library/Application Support/RussiCaptor/signing/russicaptor-offline-demo.p12');
export const alias = 'russicaptor-offline-demo';
const service = 'com.jaaklind.RussiCaptor.offline-demo.signing-password';
export const keytool = '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool';
function privateRun(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0 || result.error) throw new Error('DEMO_SIGNING_SECURE_OPERATION_FAILED');
  return result.stdout;
}
export function loadDemoPassword() {
  return privateRun('/usr/bin/security', ['find-generic-password', '-a', 'demo', '-s', service, '-w']).trim();
}
export function signingFingerprint(password) {
  const output = privateRun(keytool, ['-list', '-v', '-keystore', demoKey, '-alias', alias, '-storepass:env', 'DEMO_KEY_PASSWORD'],
    { env: { ...process.env, DEMO_KEY_PASSWORD: password, LC_ALL: 'C' } });
  const fingerprint = /SHA256:\s*([A-Fa-f0-9:]+)/.exec(output)?.[1]?.replaceAll(':', '').toLowerCase();
  if (!fingerprint || fingerprint.length !== 64) throw new Error('DEMO_SIGNING_CERTIFICATE_UNAVAILABLE');
  return fingerprint;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    if (process.argv[2] !== '--create' || process.platform !== 'darwin') throw new Error('DEMO_SIGNING_SETUP_ARGUMENT_INVALID');
    if (fs.existsSync(demoKey)) throw new Error('DEMO_SIGNING_KEY_ALREADY_EXISTS');
    const existing = spawnSync('/usr/bin/security', ['find-generic-password', '-a', 'demo', '-s', service], { encoding: 'utf8' });
    if (existing.status !== 44) throw new Error('DEMO_SIGNING_KEYCHAIN_STATE_REQUIRES_REVIEW');
    const password = crypto.randomBytes(32).toString('hex');
    // Input pipe, not process arguments or a temporary password file. Never echo output.
    privateRun('/usr/bin/security', ['-i'], { input: `add-generic-password -a demo -s ${service} -T /usr/bin/security -w ${password}\n` });
    if (loadDemoPassword() !== password) throw new Error('DEMO_SIGNING_KEYCHAIN_VERIFICATION_FAILED');
    process.umask(0o077);
    fs.mkdirSync(path.dirname(demoKey), { recursive: true, mode: 0o700 });
    privateRun(keytool, ['-genkeypair', '-storetype', 'PKCS12', '-keystore', demoKey, '-alias', alias,
      '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=RussiCaptor Offline Demo',
      '-storepass:env', 'DEMO_KEY_PASSWORD', '-keypass:env', 'DEMO_KEY_PASSWORD'],
    { env: { ...process.env, DEMO_KEY_PASSWORD: password } });
    fs.chmodSync(demoKey, 0o600);
    console.log(JSON.stringify({ status: 'PASS', certificateSha256: signingFingerprint(password), keyLocation: demoKey,
      credentials: 'macOS Keychain; demo-only service', productionKeyAccessed: false }));
  } catch (error) {
    console.error(error instanceof Error && /^DEMO_[A-Z_]+$/.test(error.message) ? error.message : 'DEMO_SIGNING_SETUP_FAILED');
    process.exitCode = 1;
  }
}
