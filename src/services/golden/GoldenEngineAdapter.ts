import type {
  GoldenActualEvent,
  GoldenActualProcess,
  GoldenAssertion,
  GoldenExecutionOutput,
  GoldenFixture,
  GoldenInputEvent,
} from "@/models/GoldenTest";
import type { GoldenRunnerAdapter } from "@/services/golden/GoldenTestExecutor";

export type GoldenEngineCheckpoint = {
  state: Record<string, unknown>;
  values?: Record<string, unknown>;
  processTree?: Omit<GoldenActualProcess, "checkpointSec">[];
  stateHash?: string;
  processTreeHash?: string;
};

export type GoldenEngineHashes = {
  stateHash?: string;
  eventLogHash?: string;
  processTreeHash?: string;
};

export type GoldenEngineHarness = {
  reset(fixture: GoldenFixture): Promise<void> | void;
  advanceTo(simulationTimeSec: number): Promise<void> | void;
  dispatch(event: GoldenInputEvent): Promise<void> | void;
  checkpoint(simulationTimeSec: number): Promise<GoldenEngineCheckpoint> | GoldenEngineCheckpoint;
  readEvents(): Promise<GoldenActualEvent[]> | GoldenActualEvent[];
  readHashes?(): Promise<GoldenEngineHashes> | GoldenEngineHashes;
};

export type GoldenEngineAdapterOptions = {
  strictMapping?: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function lookup(source: unknown, key: string): unknown {
  const object = record(source);
  if (!object) return undefined;
  if (Object.hasOwn(object, key)) return object[key];
  const actualKey = Object.keys(object).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return actualKey ? object[actualKey] : undefined;
}

function selectorPart(part: string): { field: string; filters: Record<string, string>; key?: string } {
  const match = part.match(/^([^\[]+)\[([^\]]+)\]$/);
  if (!match) return { field: part, filters: {} };
  if (!match[2].includes("=")) return { field: match[1], filters: {}, key: match[2].trim() };
  return {
    field: match[1],
    filters: Object.fromEntries(match[2].split(";").flatMap((filter) => {
      const index = filter.indexOf("=");
      return index < 0 ? [] : [[filter.slice(0, index).trim(), filter.slice(index + 1).trim()]];
    })),
  };
}

function traverse(source: unknown, path: string[]): unknown {
  let current = source;
  for (const rawPart of path) {
    const { field, filters, key } = selectorPart(rawPart);
    current = lookup(current, field);
    if (key) {
      if (Array.isArray(current)) {
        current = current.filter((item) =>
          String(item) === key || Object.values(record(item) ?? {}).some((value) => String(value) === key)
        );
      } else {
        current = lookup(current, key);
      }
    } else if (Object.keys(filters).length > 0) {
      if (!Array.isArray(current)) return undefined;
      current = current.filter((item) => Object.entries(filters).every(([key, expected]) =>
        String(lookup(item, key) ?? "") === expected
      ));
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function resolveColonQuery(query: string, state: Record<string, unknown>): unknown {
  const parts = query.split("::");
  if (parts.length < 2) return undefined;
  const [entity, ...rawPath] = parts;
  const path = rawPath.flatMap((part) => part.split("."));
  if (entity === "*") {
    return traverse(state, path) ?? traverse(lookup(state, "global"), path);
  }
  const entities = lookup(state, "entities") ?? lookup(state, "patients") ?? state;
  return traverse(lookup(entities, entity), path);
}

export function resolveGoldenQuery(
  query: string,
  checkpoint: GoldenEngineCheckpoint
): unknown {
  if (checkpoint.values && Object.hasOwn(checkpoint.values, query)) return checkpoint.values[query];
  if (query.includes("::")) return resolveColonQuery(query, checkpoint.state);
  return traverse(checkpoint.state, query.split("."));
}

function requiresMappedValue(assertion: GoldenAssertion): boolean {
  return assertion.assertionType !== "EVENT" && assertion.assertionType !== "PROCESS_TREE";
}

export function createGoldenEngineAdapter(
  harness: GoldenEngineHarness,
  options: GoldenEngineAdapterOptions = {}
): GoldenRunnerAdapter {
  const strictMapping = options.strictMapping !== false;
  return {
    async execute({ fixture, events, checkpoints, assertions }): Promise<GoldenExecutionOutput> {
      await harness.reset(structuredClone(fixture));
      const values: Record<string, unknown> = {};
      const checkpointValues: Record<string, Record<string, unknown>> = {};
      const snapshots: Record<string, unknown> = {};
      const processTree: GoldenActualProcess[] = [];
      const timeline = [...new Set([...events.map((event) => event.offsetSec), ...checkpoints])]
        .sort((left, right) => left - right);
      for (const simulationTimeSec of timeline) {
        await harness.advanceTo(simulationTimeSec);
        for (const event of events.filter((item) => item.offsetSec === simulationTimeSec)
          .sort((left, right) => left.step - right.step)) {
          await harness.dispatch(structuredClone(event));
        }
        if (!checkpoints.includes(simulationTimeSec)) continue;
        const snapshot = await harness.checkpoint(simulationTimeSec);
        checkpointValues[String(simulationTimeSec)] = {};
        for (const assertion of assertions.filter((item) => item.checkpointSec === simulationTimeSec)) {
          if (!requiresMappedValue(assertion)) continue;
          const actual = resolveGoldenQuery(assertion.queryOrField, snapshot);
          if (actual !== undefined) {
            values[assertion.queryOrField] = actual;
            checkpointValues[String(simulationTimeSec)][assertion.queryOrField] = actual;
            snapshots[assertion.queryOrField] = actual;
          }
        }
        processTree.push(...(snapshot.processTree ?? []).map((node) => ({
          ...node,
          checkpointSec: simulationTimeSec,
        })));
      }
      const missing = assertions.filter(requiresMappedValue)
        .filter((assertion) => !Object.hasOwn(
          checkpointValues[String(assertion.checkpointSec)] ?? {}, assertion.queryOrField
        ));
      if (strictMapping && missing.length > 0) {
        throw new Error(`ENGINE_ADAPTER_MAPPING_MISSING: ${missing.map((item) =>
          `${item.assertionId}=${item.queryOrField}@${item.checkpointSec}`
        ).join(", ")}`);
      }
      const hashes = await harness.readHashes?.() ?? {};
      return {
        values,
        checkpointValues,
        snapshots,
        events: await harness.readEvents(),
        processTree,
        stateHash: hashes.stateHash,
        eventLogHash: hashes.eventLogHash,
        processTreeHash: hashes.processTreeHash,
      };
    },
  };
}
