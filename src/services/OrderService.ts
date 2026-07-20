import type { Order } from "@/models/Order";
import { setOrderStatus } from "@/repositories/OrderRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { notifySync } from "@/services/SyncService";
import { createId } from "@/utils/id";
import { processOrder } from "@/services/WorkflowService";
import { findPatientById } from "@/repositories/PatientRepository";
import { canCurrentCaseManagerEditPatient } from "@/services/AssignmentRepository";
import { currentCaseManager } from "@/services/CurrentUserService";
export function placeOrder(
  order: Order
): void {
  const patient = findPatientById(order.patientId);

  if (
    order.status !== "available" ||
    patient?.status === "Completed" ||
    !canCurrentCaseManagerEditPatient(order.patientId)
  ) {
    return;
  }

  setOrderStatus(order.patientId, order.id, "ordered");

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId: order.patientId,
    timestamp: new Date().toISOString(),
    type: "order",
    title: `${order.title} tellitud`,
    description: `Tellimus "${order.title}" esitati.`,
    author: currentCaseManager.name,
    visibility: "revealed",
  });

  processOrder(order);
  notifySync();
}
