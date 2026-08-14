function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonicalize(nested)]));
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export type StableJsonAsyncOptions = Readonly<{
  yieldEvery?: number;
  yieldControl?: () => Promise<void>;
  onSlice?: (durationMs: number) => void;
}>;

/**
 * Byte-equivalent yielding form of stableJson. It emits canonical JSON
 * directly instead of allocating a second canonical object tree. Work is
 * sliced by visited values; the final string remains identical to the legacy
 * canonicalize + JSON.stringify contract.
 */
export async function stableJsonAsync(
  value: unknown,
  options: StableJsonAsyncOptions = {},
): Promise<string> {
  const chunks: string[] = [];
  const yieldEvery = Math.max(1, options.yieldEvery ?? 4_096);
  const yieldControl = options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  let visited = 0;
  let sliceStarted = performance.now();

  const checkpoint = async (): Promise<void> => {
    visited += 1;
    if (visited % yieldEvery !== 0) return;
    options.onSlice?.(performance.now() - sliceStarted);
    await yieldControl();
    sliceStarted = performance.now();
  };

  const append = async (current: unknown, inArray: boolean): Promise<boolean> => {
    await checkpoint();
    if (current === undefined || typeof current === "function" || typeof current === "symbol") {
      if (inArray) chunks.push("null");
      return inArray;
    }
    if (current === null || typeof current !== "object") {
      const serialized = JSON.stringify(current);
      if (serialized === undefined) {
        if (inArray) chunks.push("null");
        return inArray;
      }
      chunks.push(serialized);
      return true;
    }
    if (Array.isArray(current)) {
      chunks.push("[");
      for (let index = 0; index < current.length; index += 1) {
        if (index) chunks.push(",");
        await append(current[index], true);
      }
      chunks.push("]");
      return true;
    }
    chunks.push("{");
    let emitted = 0;
    const record = current as Record<string, unknown>;
    for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
      const nested = record[key];
      if (nested === undefined || typeof nested === "function" || typeof nested === "symbol") continue;
      if (emitted) chunks.push(",");
      chunks.push(JSON.stringify(key), ":");
      await append(nested, false);
      emitted += 1;
    }
    chunks.push("}");
    return true;
  };

  await append(value, false);
  options.onSlice?.(performance.now() - sliceStarted);
  await yieldControl();
  return chunks.join("");
}
