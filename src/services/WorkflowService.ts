import type { Order } from "@/models/Order";
import { getExerciseSession } from "@/repositories/ExerciseSessionRepository";
import { setImagingStatus } from "@/repositories/ImagingRepository";
import { setLabPanelStatus } from "@/repositories/LabRepository";
import { setOrderStatus } from "@/repositories/OrderRepository";
import { addScenarioEvent } from "@/repositories/ScenarioRepository";
import { addTimelineEvent } from "@/repositories/TimelineRepository";
import { getCurrentExercise } from "@/repositories/ExerciseRepository";
import { createId } from "@/utils/id";
export function processOrder(
  order: Order
): void {
  const workflow = order.workflow;

  setOrderStatus(order.patientId, order.id, "processing");

  if (workflow.resultAction === "imaging.available") {
    setImagingStatus(
      order.patientId,
      workflow.resultTargetId,
      "processing"
    );
  } else {
    setLabPanelStatus(
      order.patientId,
      workflow.resultTargetId,
      "processing"
    );
  }

  const currentMinute = getExerciseSession().currentMinute;

  addScenarioEvent({
    id: createId("SE"),
    exerciseId: getCurrentExercise().id,
    patientId: order.patientId,
    triggerMinute: currentMinute + workflow.delayMinutes,
    action: workflow.resultAction,
    targetId: workflow.resultTargetId,
    orderId: order.id,
    title: workflow.resultTitle,
    description: workflow.resultDescription,
    executed: false,
  });

  addTimelineEvent({
    id: createId("TL"),
    exerciseId: getCurrentExercise().id,
    patientId: order.patientId,
    timestamp: new Date().toISOString(),
    type: "order",
    title: `${order.title} täitmisel`,
    description: `Tellimuse "${order.title}" töötlemine algas.`,
    author: "System",
    visibility: "revealed",
  });
}
