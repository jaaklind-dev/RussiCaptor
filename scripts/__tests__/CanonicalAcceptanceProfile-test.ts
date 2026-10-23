import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { supabase } from '@/services/SupabaseService';
import { supabaseSharedWorkflowGateway as original, type SharedWorkflowMutationRequest } from '@/services/sharedWorkflow/SharedWorkflowMutationService';
import { supabaseSharedWorkflowGateway as canonical } from '../../release/canonical-profile/SharedWorkflowMutationService';

jest.mock('@/services/SupabaseService', () => ({ supabase: { auth: { getSession: jest.fn() }, rpc: jest.fn() } }));
const profile = require('../canonical-acceptance-profile.cjs');
const root = process.cwd();
const policy = JSON.parse(fs.readFileSync(path.join(root, 'release/canonical-acceptance-profile.json'), 'utf8'));
const request: SharedWorkflowMutationRequest = { exerciseId: 'EX-TEST', patientId: 'PT', commandId: 'CMD', kind: 'MUTABLE', expectedRevision: 7, state: {} };
describe('canonical build-time acceptance exclusion', () => {
  test('all exact pinned sources transform; validation returns byte-identical source', () => {
    expect(profile.verifySources(root, true)).toHaveLength(policy.sources.length);
    for (const item of policy.sources) {
      const source = fs.readFileSync(path.join(root, item.path), 'utf8');
      expect(profile.transformSource(root, path.join(root, item.path), source, false)).toBe(source);
      expect(() => profile.transformSource(root, path.join(root, item.path), source + '\n', true)).toThrow('source hash changed');
    }
  });
  test('canonical exclusion preserves every historical-quarantine assertion', () => {
    const name = 'src/services/StatePersistenceService.ts';
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const result = profile.transformSource(root, path.join(root, name), source, true);
    expect(result).toContain('HistoricalExerciseQuarantine');
    expect((result.match(/assertExerciseNotHistoricallyQuarantined\(/g) ?? []).length)
      .toBe((source.match(/assertExerciseNotHistoricallyQuarantined\(/g) ?? []).length);
    expect(result).toContain('assertExerciseNotHistoricallyQuarantined(checkpoint.exerciseId)');
  });
  test('canonical RPC body is the exact accepted APK182 baseline, not a rewritten security policy', () => {
    const expected = execFileSync('git', ['show', policy.canonicalRpc.origin], { encoding: 'utf8' });
    expect(fs.readFileSync(path.join(root, policy.canonicalRpc.path), 'utf8')).toBe(expected);
  });
  test('unknown dependency, reachable harness module and contradictory build modes fail closed', () => {
    expect(() => profile.transformSource(root, path.join(root, 'src/unknown.ts'), 'import x from "./PhysicalValidationHarnessCore";', true)).toThrow('unaudited');
    expect(() => profile.transformSource(root, path.join(root, 'src/services/sharedWorkflow/PhysicalValidationHarnessCore.ts'), '', true)).toThrow('forbidden module');
    expect(() => profile.canonicalMode({ RUSSICAPTOR_RELEASE_VARIANT: 'canonical', RUSSICAPTOR_ENABLE_SHARED_WORKFLOW_VALIDATION_HARNESS: '1' })).toThrow();
    expect(() => profile.canonicalMode({ RUSSICAPTOR_RELEASE_VARIANT: 'unknown' })).toThrow();
    expect(profile.canonicalMode({ RUSSICAPTOR_RELEASE_VARIANT: 'upgrade-validation' })).toBe(false);
    expect(profile.canonicalMode({ RUSSICAPTOR_RELEASE_VARIANT: 'canonical' })).toBe(true);
  });
  test('actual UI, trace collectors and fault-injection imports/controls are removed before Metro dependency collection', () => {
    for (const name of ['src/app/dashboard.tsx', 'src/app/excon/diagnostics.tsx', 'src/services/RuntimeCheckpointSyncService.ts']) {
      const result = profile.transformSource(root, path.join(root, name), fs.readFileSync(name, 'utf8'), true);
      expect(result).not.toMatch(/from ["'][^"']*(?:SharedWorkflowValidation|RuntimeLeaseLifecycleTrace|RuntimeCheckpointPublicationValidationHarness)/);
      expect(result).not.toMatch(/validation-renew|MANUAL_RENEW_INVOKED|manualRenewLeaseForValidation|simuleeri vastuse kadu/);
    }
    expect(profile.transformSource(root, path.join(root, 'src/app/excon/diagnostics.tsx'), fs.readFileSync('src/app/excon/diagnostics.tsx', 'utf8'), true)).toContain('takeOverRuntimeWriter');
  });
  test('bundle check rejects a single injected acceptance marker', () => {
    expect(profile.verifyBundle(Buffer.from('normal production'), 'canonical').status).toBe('PASS');
    expect(() => profile.verifyBundle(Buffer.from('normal NEGATIVE_TEST'), 'canonical')).toThrow('acceptance marker');
  });
  test('removing disabled trace evaluation preserves argument side effects and the result callback', () => {
    const code = profile.rewrite('import {traceCmOwnership} from "./CmOwnershipDiagnosticsService"; traceCmOwnership("x", sideEffect());', '/fixture.ts');
    expect(code).toContain('sideEffect()'); expect(code).not.toContain('CmOwnershipDiagnosticsService');
  });
  test.each(['APPLIED', 'IDEMPOTENT', 'STALE_VERSION', 'OWNERSHIP_CHANGED', 'NOT_OWNER', 'EXERCISE_COMPLETED'] as const)('canonical RPC semantics match validated source without acceptance arguments: %s', async status => {
    jest.mocked(supabase!.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'CM', is_anonymous: false } } }, error: null } as never);
    jest.mocked(supabase!.rpc).mockResolvedValue({ data: [{ status, revision: 8, owner_user_id: 'CM', state: {} }], error: null, status: 200 } as never);
    expect(await canonical.submit(request)).toEqual(await original.submit(request));
    const calls = jest.mocked(supabase!.rpc).mock.calls;
    expect(calls.at(-1)).toEqual(calls.at(-2));
  });
});
