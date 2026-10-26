/** CP-DIAG186: bounded metadata logging only; no timers, I/O files or runtime controls. */
type Detail = Readonly<Record<string, unknown>>;
let sequence = 0;
let workSequence = 0;
const LIMIT = 24000;
const keys = new Set(['exerciseId','generation','checkpointRevision','expectedRevision','remoteRevision','revision','localRevision','simulationTimeSec','lifecycleState','persistedRuntimeCount','prepared','eligibilityReason','priority','intentGeneration','activePublicationPriority','rpcSubmitted','outcome','state','code','reason','result','trigger','errorPresent','responseRows','rpcName','deltaOperationCount','durationMs','capturedAtSimulationTimeSec','canonicalClockSec','deltaSec','runtimeCount','phase','stopped','inFlight','writer','leasePresent','writerGeneration','queued','dirty','delayMs','source','accepted','reconciledRevision','preparedGeneration','publicationGeneration','active','desiredGeneration','completedGeneration','operationId','errorCode','fromRevision','toRevision','category','invocation','inputCharacters','stage']);
const mono = (): number => typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
export function checkpointDiagnostic(event: string, detail: Detail = {}): void {
  try {
    if (sequence >= LIMIT) return;
    const safe: Record<string,string|number|boolean> = {};
    for (const [key,value] of Object.entries(detail)) {
      if (!keys.has(key)) continue;
      if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') safe[key] = value;
      else if (typeof value === 'string' && !/eyJ|Bearer\s|https?:|@|password|token=/i.test(value)) safe[key] = value.slice(0,120);
    }
    const seq = ++sequence;
    console.info('CPDIAG186', JSON.stringify({seq,wall:new Date().toISOString(),monoMs:mono(),event:event.replace(/[^A-Z0-9_]/g,'_').slice(0,96),...safe,...(seq===LIMIT?{limitReached:true}:{})}));
  } catch { /* Observability cannot alter publication or throw into a guard. */ }
}
export function checkpointDiagnosticWork(operation:string, detail:Detail={}):(result?:Detail)=>void {
  const operationId=++workSequence,started=mono();
  checkpointDiagnostic(operation+'_BEGIN',{...detail,operationId});
  return result=>checkpointDiagnostic(operation+'_END',{...detail,...result,operationId,durationMs:mono()-started});
}
export function checkpointDiagnosticError(error:unknown):Readonly<{errorCode:string}> {
  try {
    const code=error && typeof error==='object' && 'code' in error ? String(error.code) : '';
    const message=error instanceof Error ? error.message : '';
    const safe=/^[A-Z0-9_]{3,80}$/.test(code)?code:message.match(/\b[A-Z][A-Z0-9_]{4,79}\b/)?.[0];
    return {errorCode:safe??'UNCLASSIFIED_ERROR'};
  } catch { return {errorCode:'UNCLASSIFIED_ERROR'}; }
}
