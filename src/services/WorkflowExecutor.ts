import { ScenarioEvent } from "@/models/ScenarioEvent";
import { setImagingStatus } from "@/repositories/ImagingRepository";
import { setLabPanelStatus } from "@/repositories/LabRepository";
import { setOrderStatus } from "@/repositories/OrderRepository";
import { addNote } from "@/repositories/NoteRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { createId } from "@/utils/id";

export function executeScenarioEvent(event: ScenarioEvent): boolean {
  let timelineType: "imaging" | "lab" | "note" | "order";
  const timestamp = new Date().toISOString();
  let completesOriginatingOrder = false;

  switch (event.action) {
    case "imaging.available":
      setImagingStatus(event.patientId, event.targetId, "available");
      timelineType = "imaging";
      completesOriginatingOrder = true;
      break;

    case "imaging.processing":
      setImagingStatus(event.patientId, event.targetId, "processing");
      timelineType = "imaging";
      break;

    case "lab.available":
      setLabPanelStatus(event.patientId, event.targetId, "available");
      timelineType = "lab";
      completesOriginatingOrder = true;
      break;

    case "order.completed":
      setOrderStatus(event.patientId, event.targetId, "completed");
      timelineType = "order";
      break;

    case "note.available":
      addNote({
        id: event.targetId,
        exerciseId: getCurrentExercise().id,
        patientId: event.patientId,
        text: event.description,
        author: "System",
        createdAt: timestamp,
      });
      timelineType = "note";
      break;

    default:
      return false;
  }

  if (completesOriginatingOrder && event.orderId) {
    setOrderStatus(event.patientId, event.orderId, "completed");
  }

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId: event.patientId,
    timestamp,
    type: timelineType,
    title: event.title,
    description: event.description,
    author: "System",
    visibility: "revealed",
  });

  return true;
}
