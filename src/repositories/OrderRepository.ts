import { Order } from "@/models/Order";
import { orders } from "@/data/orders";

export function getOrders(patientId: string): Order[] {
  return orders
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
  const order = orders.find(
    (order) =>
      order.patientId === patientId &&
      order.id === orderId
  );

  if (order) {
    order.status = status;
  }
}