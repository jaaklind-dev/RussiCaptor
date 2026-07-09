import { setOrderStatus } from "@/repositories/OrderRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { processOrder } from "@/services/WorkflowService";
export function placeOrder(
  patientId: string,
  orderId: string,
  title: string
): void {
  setOrderStatus(patientId, orderId, "ordered");

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId,
    timestamp: new Date().toISOString(),
    type: "order",
    title: `${title} tellitud`,
    description: `Tellimus "${title}" esitati.`,
    author: "CM",
    visibility: "revealed",
  });
processOrder(patientId, orderId);
  notifySync();
}