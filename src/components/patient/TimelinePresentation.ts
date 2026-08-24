import { timelineEventDescriptionLabel, timelineEventTitleLabel } from "@/localization/dataDrivenEt";
import { formatSimulationTime } from "@/localization/simulationTimeEt";
import type { TimelineEvent } from "@/models/TimelineEvent";

export function patientHistoryTimeLabel(event: Pick<TimelineEvent, "simulationTimeSec" | "timestamp">): string {
  if (Number.isFinite(event.simulationTimeSec)) return `T+${formatSimulationTime(event.simulationTimeSec!)}`;
  const instant = new Date(event.timestamp);
  return Number.isNaN(instant.getTime()) ? event.timestamp : instant.toLocaleTimeString("et-EE");
}

export function patientHistoryTitleLabel(event: Pick<TimelineEvent, "type" | "title">): string {
  return timelineEventTitleLabel(event);
}

export function patientHistoryDescriptionLabel(description: string): string {
  return timelineEventDescriptionLabel(description) ?? description;
}
