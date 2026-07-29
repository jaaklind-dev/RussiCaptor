import type {
  AssessmentCondition,
  AssessmentEvent,
  AssessmentResult,
  AssessmentResultStatus,
  AssessmentRule,
  AssessmentSnapshot,
  AssessmentSourceSnapshot,
  DebriefReport,
} from "@/models/ClinicalAssessment";

type Evaluation = { passed: boolean; evidence: string[] };

function eventRows(source: AssessmentSourceSnapshot): { eventType: string; timestamp: number; sequence: number; evidence: string }[] {
  const mergedRuntime = [...source.eventLog, ...source.timeline];
  const uniqueRuntime = [...new Map(mergedRuntime.map((event, index) => [
    `${event.eventType}\u0000${event.simulationTime ?? 0}\u0000${event.sequence ?? index}`, event,
  ])).values()];
  const runtime = uniqueRuntime.map((event, index) => ({
    eventType: event.eventType,
    timestamp: Number(event.simulationTime ?? 0),
    sequence: Number(event.sequence ?? index),
    evidence: `runtime:${event.eventType}:${event.sequence ?? index}`,
  }));
  const interventions = source.interventionLog.map((event, index) => ({
    eventType: event.eventType,
    timestamp: event.timestamp,
    sequence: index,
    evidence: `intervention:${event.eventType}:${event.interventionId ?? index}`,
  }));
  return [...runtime, ...interventions].sort((a, b) =>
    a.timestamp - b.timestamp || a.sequence - b.sequence ||
    a.eventType.localeCompare(b.eventType) || a.evidence.localeCompare(b.evidence)
  );
}

function evaluateCondition(condition: AssessmentCondition, source: AssessmentSourceSnapshot): Evaluation {
  const events = eventRows(source);
  if (condition.type === "EVENT_PRESENT") {
    const matching = events.filter(event => event.eventType === condition.eventType &&
      (condition.deadlineSec === undefined || event.timestamp <= condition.deadlineSec));
    return { passed: matching.length >= (condition.minCount ?? 1), evidence: matching.map(item => item.evidence) };
  }
  if (condition.type === "EVENT_ABSENT") {
    const matching = events.filter(event => event.eventType === condition.eventType);
    return { passed: matching.length === 0, evidence: matching.map(item => item.evidence) };
  }
  if (condition.type === "EVENT_ORDER") {
    const beforeIndex = events.findIndex(event => event.eventType === condition.beforeEventType);
    const afterIndex = events.findIndex(event => event.eventType === condition.afterEventType);
    const before = beforeIndex >= 0 ? events[beforeIndex] : undefined;
    const after = afterIndex >= 0 ? events[afterIndex] : undefined;
    return {
      passed: beforeIndex >= 0 && afterIndex > beforeIndex,
      evidence: [before?.evidence, after?.evidence].filter((item): item is string => Boolean(item)),
    };
  }
  if (condition.type === "EVENT_COUNT_MAX") {
    const matching = events.filter(event => event.eventType === condition.eventType);
    return { passed: matching.length <= condition.maxCount, evidence: matching.map(item => item.evidence) };
  }
  if (condition.type === "INTERVENTION_REJECTED") {
    const rejected = source.interventionLog.filter(event => event.eventType === "InterventionRejected" &&
      (!condition.reasonCode || event.reasonCode === condition.reasonCode));
    return { passed: (rejected.length > 0) === condition.expected, evidence: rejected.map(event =>
      `intervention:${event.interventionId ?? event.resourceId}:${event.reasonCode ?? "REJECTED"}`) };
  }
  if (condition.type === "RESOURCE_CONFLICT") {
    const conflicts = source.interventionLog.filter(event => event.eventType === "InterventionRejected" &&
      (event.reasonCode === "EXCLUSIVE_GROUP_CONFLICT" || event.reasonCode === "RESOURCE_ALREADY_RESERVED"));
    return { passed: (conflicts.length > 0) === condition.expected, evidence: conflicts.map(event =>
      `resource:${event.resourceId}:${event.reasonCode}`) };
  }
  const actual = source.airwayState[condition.field];
  return { passed: actual === condition.equals, evidence: [`airway:${condition.field}:${String(actual)}`] };
}

function statusFor(rule: AssessmentRule, passed: boolean): AssessmentResultStatus {
  if (passed) return rule.severity === "INFO" ? "INFO" : "PASS";
  return rule.severity;
}

export class ClinicalAssessmentEngine {
  evaluate(rules: AssessmentRule[], source: AssessmentSourceSnapshot): AssessmentSnapshot {
    const orderedRules = [...rules].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    const results: AssessmentResult[] = orderedRules.map(rule => {
      if (rule.applicability && !evaluateCondition(rule.applicability, source).passed) {
        return {
          ruleId: rule.ruleId, name: rule.name, category: rule.category, severity: rule.severity,
          status: "NOT_APPLICABLE", expectedBehaviour: rule.expectedBehaviour,
          evaluatedAt: source.timestamp, evidence: [],
        };
      }
      const evaluation = evaluateCondition(rule.condition, source);
      return {
        ruleId: rule.ruleId, name: rule.name, category: rule.category, severity: rule.severity,
        status: statusFor(rule, evaluation.passed), expectedBehaviour: rule.expectedBehaviour,
        evaluatedAt: source.timestamp, evidence: evaluation.evidence,
      };
    });
    const events = results.flatMap(result => this.resultEvent(result));
    return { results, events, debrief: this.debrief(source, results) };
  }

  private resultEvent(result: AssessmentResult): AssessmentEvent[] {
    const eventType = result.status === "PASS" ? "AssessmentPassed"
      : result.status === "WARNING" ? "AssessmentWarning"
        : result.status === "FAIL" ? "AssessmentFailed" : undefined;
    return eventType ? [{
      eventType, timestamp: result.evaluatedAt, ruleId: result.ruleId,
      category: result.category, status: result.status, evidence: structuredClone(result.evidence),
    }] : [];
  }

  private debrief(source: AssessmentSourceSnapshot, results: AssessmentResult[]): DebriefReport {
    const warnings = results.filter(item => item.status === "WARNING");
    const failedRules = results.filter(item => item.status === "FAIL");
    return {
      generatedAt: source.timestamp,
      simulationSummary: {
        encounterId: source.runtimeState.encounterId,
        globalStatus: source.runtimeState.globalStatus,
        durationSec: source.runtimeState.exerciseTimeSec,
      },
      completedInterventions: source.interventionInstances.filter(item =>
        item.status === "COMPLETED" || item.status === "CANCELLED"
      ).sort((a, b) => a.startedAt - b.startedAt || a.instanceId.localeCompare(b.instanceId)).map(item => structuredClone(item)),
      timeline: [...source.timeline].sort((a, b) =>
        Number(a.simulationTime ?? 0) - Number(b.simulationTime ?? 0) ||
        Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
      ).map(item => structuredClone(item)),
      assessmentFindings: structuredClone(results), warnings: structuredClone(warnings),
      failedRules: structuredClone(failedRules),
      strengths: results.filter(item => item.status === "PASS").map(item => item.name),
      improvementOpportunities: [...warnings, ...failedRules].map(item => item.expectedBehaviour),
    };
  }
}
