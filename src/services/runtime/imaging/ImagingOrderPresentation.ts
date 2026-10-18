import type { Order } from "@/models/Order";
import type { ImagingWorkflowSnapshot } from "@/models/ImagingWorkflow";

// Transport receipts are not clinical state. They bridge acceptance -> canonical
// hydration and survive tab remounts; only the Runtime supplies study lifecycle.
type Receipt = Readonly<{ commandId: string }>;
const receipts = new Map<string, Receipt>();
const listeners = new Set<() => void>();
let version = 0;
const key = (exerciseId: string, patientId: string, definitionId: string) =>
  JSON.stringify([exerciseId, patientId, definitionId]);
export const subscribeToImagingOrderReceipts = (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
export const getImagingOrderReceiptVersion = () => version;
export function rememberAcceptedImagingOrder(exerciseId: string, patientId: string, definitionId: string, commandId: string) {
  receipts.set(key(exerciseId, patientId, definitionId), Object.freeze({ commandId }));
  version += 1; listeners.forEach(listener => listener());
}
export function resetImagingOrderReceipts() {
  receipts.clear(); version += 1; listeners.forEach(listener => listener());
}

/** Same exercise/patient-scoped canonical instances rendered by ImagingTab. */
export function imagingOrderPresentation(order: Order, workflow?: ImagingWorkflowSnapshot) {
  const instances = (workflow?.instances ?? []).filter(item => item.exerciseId === order.exerciseId &&
    item.patientId === order.patientId && item.definitionId === order.workflow.resultTargetId);
  const latest = instances.reduce<(typeof instances)[number] | undefined>((selected, item) =>
    !selected || item.repeatOrdinal > selected.repeatOrdinal ? item : selected, undefined);
  const receipt = receipts.get(key(order.exerciseId, order.patientId, order.workflow.resultTargetId));
  const pending = Boolean(receipt && !instances.some(item => item.orderCommandId === receipt.commandId));
  return Object.freeze({
    status: pending ? "PENDING" as const : latest?.status ?? "NOT_ORDERED" as const,
    repeat: Boolean(latest || receipt),
    pending,
    available: workflow !== undefined,
    latestCommandId: latest?.orderCommandId,
  });
}
