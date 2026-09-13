import { startRuntimeWorkTrace } from "@/services/runtime/persistence/RuntimeLeaseLifecycleTrace";

// Small dependency-free SHA-256 implementation for Expo and Jest.
function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

export function sha256Hex(input: ArrayBuffer | Uint8Array): string {
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bitLength = source.length * 8;
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15], 7) ^ rotateRight(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotateRight(words[index - 2], 17) ^ rotateRight(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + upper1 + choice + constants[index] + words[index]) >>> 0;
      const upper0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (upper0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return [...hash].map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function sha256Text(value: string): string {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return sha256Hex(new Uint8Array(bytes));
}

export type Sha256AsyncOptions = Readonly<{
  /** Validation-only opaque category; never serialized into checkpoint data. */
  traceCategory?: "RUNTIME_PAYLOAD" | "FULL_CHECKPOINT" | "DELTA" | "OTHER";
  charactersPerSlice?: number;
  blocksPerSlice?: number;
  /** Maximum continuous JavaScript work before yielding, when configured. */
  maxSliceMs?: number;
  yieldControl?: () => Promise<void>;
  onSlice?: (durationMs: number) => void;
}>;

let sha256TextAsyncInvocation = 0;

function utf8Slice(value: string, start: number, end: number): Uint8Array {
  // Three bytes per UTF-16 code unit is a strict upper bound (a surrogate
  // pair uses four bytes for two units). Preserve the legacy lone-surrogate
  // encoding rather than delegating to TextEncoder replacement semantics.
  const target = new Uint8Array(Math.max(0, end - start) * 3);
  let offset = 0;
  for (let index = start; index < end; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < end) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (codePoint <= 0x7f) target[offset++] = codePoint;
    else if (codePoint <= 0x7ff) {
      target[offset++] = 0xc0 | (codePoint >>> 6);
      target[offset++] = 0x80 | (codePoint & 0x3f);
    } else if (codePoint <= 0xffff) {
      target[offset++] = 0xe0 | (codePoint >>> 12);
      target[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
      target[offset++] = 0x80 | (codePoint & 0x3f);
    } else {
      target[offset++] = 0xf0 | (codePoint >>> 18);
      target[offset++] = 0x80 | ((codePoint >>> 12) & 0x3f);
      target[offset++] = 0x80 | ((codePoint >>> 6) & 0x3f);
      target[offset++] = 0x80 | (codePoint & 0x3f);
    }
  }
  return target.slice(0, offset);
}

async function sha256HexAsync(bytesSource: Uint8Array, options: Sha256AsyncOptions): Promise<string> {
  const category = options.traceCategory ?? "OTHER";
  const bitLength = bytesSource.length * 8;
  const paddedLength = Math.ceil((bytesSource.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength); bytes.set(bytesSource); bytes[bytesSource.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const constants = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const hash = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const words = new Uint32Array(64); const blocksPerSlice = Math.max(1, options.blocksPerSlice ?? 512);
  const yieldControl = options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  let blocks = 0; let sliceStarted = performance.now();
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index=0;index<16;index+=1) words[index]=view.getUint32(offset+index*4,false);
    for (let index=16;index<64;index+=1) {
      const s0=rotateRight(words[index-15],7)^rotateRight(words[index-15],18)^(words[index-15]>>>3);
      const s1=rotateRight(words[index-2],17)^rotateRight(words[index-2],19)^(words[index-2]>>>10);
      words[index]=(words[index-16]+s0+words[index-7]+s1)>>>0;
    }
    let [a,b,c,d,e,f,g,h]=hash;
    for(let index=0;index<64;index+=1){const upper1=rotateRight(e,6)^rotateRight(e,11)^rotateRight(e,25);const choice=(e&f)^(~e&g);const temp1=(h+upper1+choice+constants[index]+words[index])>>>0;const upper0=rotateRight(a,2)^rotateRight(a,13)^rotateRight(a,22);const majority=(a&b)^(a&c)^(b&c);const temp2=(upper0+majority)>>>0;h=g;g=f;f=e;e=(d+temp1)>>>0;d=c;c=b;b=a;a=(temp1+temp2)>>>0;}
    hash[0]=(hash[0]+a)>>>0;hash[1]=(hash[1]+b)>>>0;hash[2]=(hash[2]+c)>>>0;hash[3]=(hash[3]+d)>>>0;
    hash[4]=(hash[4]+e)>>>0;hash[5]=(hash[5]+f)>>>0;hash[6]=(hash[6]+g)>>>0;hash[7]=(hash[7]+h)>>>0;
    blocks += 1;
    if (blocks % blocksPerSlice === 0 &&
      (options.maxSliceMs === undefined || performance.now() - sliceStarted >= options.maxSliceMs)) {
      options.onSlice?.(performance.now()-sliceStarted); await yieldControl(); sliceStarted=performance.now();
    }
  }
  options.onSlice?.(performance.now()-sliceStarted);
  const endDigest = startRuntimeWorkTrace("SHA_DIGEST", { category, inputBytes: bytesSource.length });
  const result = [...hash].map(value=>value.toString(16).padStart(8,"0")).join("");
  endDigest({ category, maxContiguousJsBlockMs: 0 });
  return result;
}

/** Byte-identical yielding SHA-256 for canonical JSON strings. */
export async function sha256TextAsync(
  value: string,
  options: Sha256AsyncOptions = {},
): Promise<string> {
  const category = options.traceCategory ?? "OTHER";
  sha256TextAsyncInvocation += 1;
  const invocation = sha256TextAsyncInvocation;
  const endParts = startRuntimeWorkTrace("SHA_PARTS", { category, invocation, inputCharacters: value.length });
  const charactersPerSlice = Math.max(1, options.charactersPerSlice ?? 65_536);
  const yieldControl = options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  const parts: Uint8Array[] = [];
  let sliceStarted = performance.now();
  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + charactersPerSlice);
    // Never divide a valid pair between slices. Lone surrogates retain the
    // established dependency-free encoder semantics in utf8Slice.
    if (end < value.length && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 && value.charCodeAt(end) <= 0xdfff) end += 1;
    parts.push(utf8Slice(value, start, end));
    start = end;
    options.onSlice?.(performance.now() - sliceStarted);
    await yieldControl();
    sliceStarted = performance.now();
  }
  if (!value.length) parts.push(new Uint8Array());
  options.onSlice?.(performance.now() - sliceStarted);
  endParts({ category, invocation, partCount: parts.length });
  const endReduce = startRuntimeWorkTrace("SHA_PARTS_REDUCE", { category, partCount: parts.length });
  const length = parts.reduce((total, part) => total + part.length, 0);
  endReduce({ category, totalBytes: length, maxContiguousJsBlockMs: 0 });
  const endAllocation = startRuntimeWorkTrace("SHA_FINAL_ARRAY_ALLOC", { category, totalBytes: length });
  const bytes = new Uint8Array(length);
  endAllocation({ category, maxContiguousJsBlockMs: 0 });
  const endBytesSet = startRuntimeWorkTrace("SHA_BYTES_SET", { category, partCount: parts.length, totalBytes: length });
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  endBytesSet({ category, maxContiguousJsBlockMs: 0 });
  return sha256HexAsync(bytes, options);
}
