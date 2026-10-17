import { getRuntimeCommandReadinessDiagnostics, recordRuntimeCommandReadinessDiagnostic,
  type RuntimeCommandReadinessDiagnostic } from '../RuntimeCommandReadinessDiagnostics';

const safe: RuntimeCommandReadinessDiagnostic = { readerPhase: 'SYNCHRONIZING', exerciseIdentityMatch: true,
  revisionConvergence: 'PENDING', simulationClockMatch: false, failureCategory: 'CHECKPOINT_PENDING', gatewaySubmitCalled: false };
let log: jest.SpyInstance;
beforeEach(() => { log = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { log.mockRestore(); });
test('only fixed primitive fields survive; identifiers, exceptions and credentials cannot leak', () => {
  const secret = 'secret-token-patient-exercise';
  recordRuntimeCommandReadinessDiagnostic({ ...safe, readerPhase: secret, failureCategory: secret,
    revisionConvergence: secret, gatewaySubmitCalled: true, patientId: secret, token: secret,
    error: new Error(secret) } as unknown as RuntimeCommandReadinessDiagnostic);
  const record = getRuntimeCommandReadinessDiagnostics().at(-1)!;
  expect(Object.keys(record).sort()).toEqual(Object.keys(safe).sort());
  expect(JSON.stringify(record)).not.toContain(secret); expect(record.gatewaySubmitCalled).toBe(false);
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret); expect(Object.isFrozen(record)).toBe(true);
});
test('diagnostics coalesce unchanged state and retain at most sixteen observations', () => {
  for (let i = 0; i < 40; i++) recordRuntimeCommandReadinessDiagnostic({ ...safe, exerciseIdentityMatch: i % 2 === 0 });
  const calls = log.mock.calls.length;
  recordRuntimeCommandReadinessDiagnostic({ ...safe, exerciseIdentityMatch: false });
  expect(log).toHaveBeenCalledTimes(calls); expect(getRuntimeCommandReadinessDiagnostics()).toHaveLength(16);
});
test('logger failure cannot change command safety or propagate raw exceptions', () => {
  log.mockImplementation(() => { throw new Error('PRIVATE'); });
  expect(() => recordRuntimeCommandReadinessDiagnostic({ ...safe, failureCategory: 'CLOCK_MISMATCH' })).not.toThrow();
});
