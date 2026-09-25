import { createId } from "@/utils/id";
import { submitPatientRuntimeCommand } from "@/services/runtime/commands/RuntimePatientCommandService";

/** Reader-safe command facade. Authority remains in the durable writer command consumer. */
export async function submitImagingOrder(exerciseId: string, patientId: string, definitionId: string,
  commandId = createId("IMAGING-ORDER")) {
  const result = await submitPatientRuntimeCommand({ exerciseId, patientId, commandId, commandType: "IMAGING_ORDER",
    payload: Object.freeze({ definitionId }) });
  const ok = result.status === "APPLIED" || result.status === "IDEMPOTENT";
  return Object.freeze({ ...result, ok, commandId,
    message: ok ? "Pildiuuring telliti. Oota autoritatiivset kinnitust."
      : result.status === "RECONNECT_REQUIRED" ? "Oota patsiendi andmete sünkroonimist ja proovi uuesti."
        : "Pildiuuringut ei saanud tööjärjekorda saata." });
}
