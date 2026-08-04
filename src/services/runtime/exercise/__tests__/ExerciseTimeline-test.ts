import type { ExerciseControlAuditEntry } from "@/models/exercise/ExerciseControlCommand";
import type { ExerciseTimelineEvent } from "@/models/exercise/ExerciseTimelineEvent";
import type { InstructorCommandAuditEntry } from "@/models/InstructorCommand";
import type { TimelineEvent } from "@/models/TimelineEvent";
import { aggregateExerciseTimeline } from "../ExerciseTimelineAggregator";
import { filterExerciseTimeline, groupExerciseTimeline, newestExerciseTimelineFirst } from "../../selectors/ExerciseTimelineSelector";
import { sha256Text } from "@/utils/sha256";
import { stableJson } from "@/utils/stableJson";

const controls: ExerciseControlAuditEntry[] = [{ commandId: "START-1", exerciseId: "demo", issuer: "Exercise Controller", commandType: "START_EXERCISE", simulationTimeSec: 0, previousState: "READY", resultingState: "RUNNING", previousSpeed: 1, resultingSpeed: 1, outcome: "ACCEPTED", eventType: "ExerciseStarted" }, { commandId: "BAD-1", exerciseId: "demo", issuer: "CM", commandType: "PAUSE_EXERCISE", simulationTimeSec: 15, previousState: "RUNNING", previousSpeed: 1, outcome: "REJECTED", rejectionCode: "UNAUTHORIZED" }];
const commands: InstructorCommandAuditEntry[] = [{ commandId: "INJ-1", exerciseId: "demo", patientId: "PT-003", eventType: "RESPIRATORY_DETERIORATION", issuedBy: "Jaak", simulationTime: 10, outcome: "ACCEPTED" }];
const patientEvents: TimelineEvent[] = [{ id: "RANDOM-ID-IGNORED", exerciseId: "demo", patientId: "PT-003", timestamp: "2099-01-01T00:00:00Z", type: "transfer", title: "Transfer completed", description: "Jaak → Mari", author: "Jaak", visibility: "revealed", simulationTimeSec: 10, sequenceNumber: 7 }];
const timeline = () => aggregateExerciseTimeline({ exerciseId: "demo", controls, commands, patientEvents });

describe("WP-23 canonical exercise timeline", () => {
  test("orders only by simulation time and deterministic sequence", () => {
    const events = timeline(); expect(events.map(event => event.simulationTimeSec)).toEqual([0, 10, 10, 15]);
    expect(events.map(event => event.id)).toEqual(["EXERCISE-CONTROL:START-1", "INSTRUCTOR-COMMAND:INJ-1", "PATIENT-EVENT:demo:7", "EXERCISE-CONTROL:BAD-1"]);
    expect(newestExerciseTimelineFirst(events).map(event => event.id)[0]).toBe("EXERCISE-CONTROL:BAD-1");
  });
  test("filters categories, severity, patient, case manager and free text without mutating canonical input", () => {
    const events = timeline(); const before = stableJson(events);
    expect(filterExerciseTimeline(events, { categories: ["COMMAND"], severities: [], patientId: "PT-003", caseManager: "Jaak", search: "respiratory" })).toHaveLength(1);
    expect(filterExerciseTimeline(events, { categories: [], severities: ["WARNING"], search: "rejected" })).toHaveLength(1);
    expect(stableJson(events)).toBe(before); expect(Object.isFrozen(events)).toBe(true); expect(events.every(Object.isFrozen)).toBe(true);
  });
  test("groups as a presentation-only operation", () => {
    expect(groupExerciseTimeline(timeline(), "SIMULATION_MINUTE").map(group => group.key)).toEqual(["0"]);
    expect(groupExerciseTimeline(timeline(), "PATIENT").map(group => group.key)).toEqual(["EXERCISE", "PT-003"]);
    expect(groupExerciseTimeline(timeline(), "CATEGORY").map(group => group.key)).toEqual(["EXERCISE", "COMMAND", "AUDIT"]);
    expect(groupExerciseTimeline(timeline(), "TODAY")[0].title).toBe("Today");
  });
  test("reconstructs identical IDs, order, metadata and replay hash", () => {
    const first = timeline(); const second = timeline(); expect(second).toEqual(first);
    expect(sha256Text(stableJson(second))).toBe(sha256Text(stableJson(first)));
  });
  test("filters 1000 events linearly within a conservative budget", () => {
    const events: ExerciseTimelineEvent[] = Array.from({ length: 1000 }, (_, index) => ({ id: `E-${index}`, exerciseId: "demo", simulationTimeSec: index, sequenceNumber: index + 1, category: "PATIENT", type: "STATUS", severity: "INFO", patientId: `PT-${index % 100}`, issuedBy: "Jaak", title: `Patient state ${index}` }));
    const started = Date.now(); const result = filterExerciseTimeline(events, { categories: ["PATIENT"], severities: ["INFO"], patientId: "PT-42", search: "state" });
    expect(result).toHaveLength(10); expect(Date.now() - started).toBeLessThan(500);
  });
});
