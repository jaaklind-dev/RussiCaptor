import { compareAssessmentTimeline } from "../ClinicalAssessmentEngine";
import { cooperativeDetachedCopy, cooperativeStableSort } from "../CooperativeAssessmentSnapshot";

describe("cooperative assessment snapshot primitives", () => {
  test("large detached copy yields, preserves order and nested isolation", async () => {
    const source = Array.from({ length: 2_000 }, (_, index) => ({ index, details: { value: `V-${index}` } }));
    const yieldControl = jest.fn(async () => Promise.resolve());
    const result = await cooperativeDetachedCopy(source, yieldControl, 64, Number.POSITIVE_INFINITY);
    expect(result.value).toEqual(source);
    expect(result.metrics.yieldCount).toBeGreaterThan(0);
    expect(result.value[0]).not.toBe(source[0]);
    expect(result.value[0].details).not.toBe(source[0].details);
    result.value[0].details.value = "changed";
    expect(source[0].details.value).toBe("V-0");
  });

  test.each(["sorted", "reverse", "ties"] as const)("stable merge sort matches native stable sort: %s", async shape => {
    const source = Array.from({ length: 1_000 }, (_, index) => ({
      key: shape === "sorted" ? index : shape === "reverse" ? 1_000 - index : index % 7,
      originalIndex: index,
    }));
    const comparator = (left: typeof source[number], right: typeof source[number]) => left.key - right.key;
    const expected = [...source].sort(comparator);
    const actual = await cooperativeStableSort(source, comparator, async () => Promise.resolve(), Number.POSITIVE_INFINITY);
    expect(actual.value).toEqual(expected);
  });

  test("timeline ordering matches the legacy comparator for missing keys, duplicate IDs and exact ties", async () => {
    const source = [
      { eventId: "DUPLICATE", eventType: "missing-both" },
      { eventId: "DUPLICATE", eventType: "zero-explicit", simulationTime: 0, sequence: 0 },
      { eventId: "LATE", eventType: "later-sequence", simulationTime: 0, sequence: 2 },
      { eventId: "TIE", eventType: "tie-first", simulationTime: 10, sequence: 4 },
      { eventId: "TIE", eventType: "tie-second", simulationTime: 10, sequence: 4 },
      { eventId: "EARLY", eventType: "earlier-sequence", simulationTime: 0, sequence: 1 },
    ];
    const expected = [...source].sort(compareAssessmentTimeline);
    const actual = await cooperativeStableSort(source, compareAssessmentTimeline, async () => Promise.resolve());
    expect(actual.value).toEqual(expected);
    expect(actual.value.filter(item => item.eventId === "TIE").map(item => item.eventType))
      .toEqual(["tie-first", "tie-second"]);
  });
});
