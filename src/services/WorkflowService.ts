import { setImagingStatus } from "@/repositories/ImagingRepository";

export function processOrder(
  patientId: string,
  orderId: string
): void {
  if (orderId === "ORD-003") {
    setImagingStatus(patientId, "IMG-001", "available");
  }

  if (orderId === "ORD-004") {
    setImagingStatus(patientId, "IMG-002", "processing");
  }
}