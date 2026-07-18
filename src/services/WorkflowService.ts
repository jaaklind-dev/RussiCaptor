import { setImagingStatus } from "@/repositories/ImagingRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { createId } from "@/utils/id";
export function processOrder(
  patientId: string,
  orderId: string
): void {
  if (orderId === "ORD-003") {
    setImagingStatus(patientId, "IMG-001", "available");

    addTimelineEvent({
      id: createId("TL"),
      exerciseId: getCurrentExercise().id,
      patientId,
      timestamp: new Date().toISOString(),
      type: "imaging",
      title: "KT pea valmis",
      description: "Tellitud KT pea uuring muutus kättesaadavaks.",
      author: "System",
      visibility: "revealed",
    });
  }

  if (orderId === "ORD-004") {
    setImagingStatus(patientId, "IMG-002", "processing");

    addTimelineEvent({
      id: createId("TL"),
      exerciseId: getCurrentExercise().id,
      patientId,
      timestamp: new Date().toISOString(),
      type: "imaging",
      title: "Rindkere röntgen töös",
      description: "Tellitud rindkere röntgen suunati töösse.",
      author: "System",
      visibility: "revealed",
    });
  }
}
