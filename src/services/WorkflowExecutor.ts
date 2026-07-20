import { ScenarioEvent } from "@/models/ScenarioEvent";
import { setImagingStatus } from "@/repositories/ImagingRepository";
import { setLabPanelStatus } from "@/repositories/LabRepository";
import { setOrderStatus } from "@/repositories/OrderRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { createId } from "@/utils/id";

export function executeScenarioEvent(event: ScenarioEvent): boolean {
  let timelineType: "imaging" | "lab" | null = null;

  switch (event.action) {
    case "imaging.available":
      setImagingStatus(event.patientId, event.targetId, "available");
      timelineType = "imaging";
      break;

    case "imaging.processing":
      setImagingStatus(event.patientId, event.targetId, "processing");
      return true;

    case "lab.available":
      setLabPanelStatus(event.patientId, event.targetId, "available");
      timelineType = "lab";
      break;

    default:
      break;
  }

  if (!timelineType) {
    return false;
  }

  if (event.orderId) {
    setOrderStatus(event.patientId, event.orderId, "completed");
  }

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId: event.patientId,
    timestamp: new Date().toISOString(),
    type: timelineType,
    title: event.title,
    description: event.description,
    author: "System",
    visibility: "revealed",
  });

  return true;
}
