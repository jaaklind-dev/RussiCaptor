import { Order } from "@/models/Order";
import { clinicalDataProvider } from "@/providers/ProviderFactory";

export function getOrders(patientId: string): Order[] {
  return clinicalDataProvider.getOrders()
    .filter(
      (order) =>
        order.patientId === patientId &&
        order.visibility === "revealed"
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function setOrderStatus(
  patientId: string,
  orderId: string,
  status: Order["status"]
): void {
  const order = clinicalDataProvider.getOrders().find(
    (order) =>
      order.patientId === patientId &&
      order.id === orderId
  );

  if (order) {
    order.status = status;
  }
}

export function resetOrders(): void {
  clinicalDataProvider.resetOrders();
}
