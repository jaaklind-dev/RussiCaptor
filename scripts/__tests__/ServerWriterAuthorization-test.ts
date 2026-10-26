import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const migration = '20261019171013_runtime_writer_controller_authorization.sql';

describe('server runtime controller authorization', () => {
  test('CLI machine-output parser rejects ambiguous success and verifies independent database state', () => {
    const result=spawnSync(process.execPath,[path.join(root,'scripts/test-qualification-cli-output.mjs')],{cwd:root,encoding:'utf8',timeout:10000});
    expect({status:result.status,stderr:result.stderr}).toEqual({status:0,stderr:''});
    expect(JSON.parse(result.stdout.trim()).passed).toBe(13);
  });
  test('native qualification configuration fails closed without production configuration', () => {
    const result=spawnSync(process.execPath,[path.join(root,'scripts/test-native-qualification-project.mjs')],{
      cwd:root,encoding:'utf8',timeout:10000,
    });
    expect({status:result.status,stderr:result.stderr}).toEqual({status:0,stderr:''});
    const summary=JSON.parse(result.stdout.trim());
    expect(summary.passed).toBe(12);
  });
  test('accepted56 migration baseline rejects inventory, ordering, hash and staging substitutions', () => {
    const result=spawnSync(process.execPath,[path.join(root,'scripts/test-qualification-migration-baseline.mjs')],{
      cwd:root,encoding:'utf8',timeout:10000,
    });
    expect({status:result.status,stderr:result.stderr}).toEqual({status:0,stderr:''});
    expect(JSON.parse(result.stdout.trim()).passed).toBe(14);
  });
  test('security suite is mandatory without extending the historical A-Z catalog', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'test/runtime-regression-guardrails.manifest.json'), 'utf8'));
    expect(manifest.guardrails.map((item: { id: string }) => item.id))
      .toEqual(Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)));
    expect(manifest.groups.runtime).toContain('scripts/__tests__/ServerWriterAuthorization-test.ts');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:writer-authorization'])
      .toBe('jest --runInBand --runTestsByPath scripts/__tests__/ServerWriterAuthorization-test.ts');
    for (const file of ['server-writer-authorization.yml', 'android-field-release.yml']) {
      const workflow = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
      expect(workflow).toContain('run: npm run test:writer-authorization');
      expect(workflow).not.toContain('continue-on-error: true');
    }
  });
  test('real isolated PostgreSQL applies the complete chain and enforces writer contracts', () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/test-writer-authorization.mjs')], {
      cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    });
    console.log(result.stdout);
    expect({ error: result.error?.message, stderr: result.stderr, status: result.status }).toEqual({
      error: undefined, stderr: '', status: 0,
    });
    const summary = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    expect(summary.passed).toBeGreaterThanOrEqual(35);
    expect(summary.results.every((item: { status: string }) => item.status === 'PASS')).toBe(true);
  }, 125_000);

  test('additive migration changes writer guard and ledger guard, not CAS, RLS or clinical behavior', () => {
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8');
    expect(sql.match(/create or replace function/gi)).toHaveLength(2);
    expect(sql).toContain("has_authorization_permission('EXCON_EXERCISE_CONTROL', v_exercise_id)");
    expect(sql).not.toContain('CM_WORKFLOW_WRITE');
    expect(sql).toContain('security invoker');
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('from public, anon, authenticated');
    expect(sql).not.toMatch(/\b(?:drop|disable)\s+trigger|\b(?:create|alter|drop)\s+policy|disable\s+row\s+level/i);
  });

  test('migration55 is exactly three finite revocations; no DML, defaults, functions or RLS changes', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('_runtime_critical_table_privileges.sql'));
    expect(files).toHaveLength(1);
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations', files[0]), 'utf8').replace(/--[^\n]*/g, '');
    expect(sql.trim().split(';').filter(s => s.trim())).toEqual([
      'revoke truncate, trigger on table public.runtime_writer_leases from public, anon, authenticated',
      '\nrevoke truncate, trigger on table public.runtime_checkpoints from public, anon, authenticated',
      '\nrevoke truncate, trigger on table public.exercise_states from public, anon, authenticated',
    ]);
  });
});
