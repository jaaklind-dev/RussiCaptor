import { clearTimelineEvents, getTimelineEvents } from "@/repositories/TimelineRepository";
import { MTP_REFERENCE_CONFIGURATION, WP47C_DEFAULT_DELIVERY_CONFIGURATION, type MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { activateMassiveTransfusion, bootstrapMassiveTransfusionPatientProcess, changeBloodProductDeliveryMode,
  reconcileMtpVascularAccess, startBloodProductAdministration, tickMassiveTransfusionPatientProcess } from "@/services/runtime/MassiveTransfusionPatientProcess";
import { clearInstructorRuntimeOwners, registerInstructorRuntimeOwner } from "@/services/runtime/instructor/InstructorRuntimeEventRegistry";
import { createMtpCommandId, handleMtpCommand, resetMtpCommands } from "@/services/runtime/instructor/MassiveTransfusionCommandService";

const exerciseId = "EX-MODE-SWITCH";
const patientId = "PT-MODE-SWITCH";

function running(): MassiveTransfusionPatientProcessRuntime {
  const configuration = { ...structuredClone(MTP_REFERENCE_CONFIGURATION),
    bloodProductDelivery: { ...WP47C_DEFAULT_DELIVERY_CONFIGURATION } };
  let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess(patientId, { configuration }), "ACTIVATE");
  process = reconcileMtpVascularAccess(process, [{ interventionInstanceId: "ACCESS-1", type: "PERIPHERAL_IV",
    resourceIds: ["RESOURCE-1"], establishedAt: 0 }]);
  process = startBloodProductAdministration(process, "RBC-1", "RBC", 1, "GRAVITY", "IV-1");
  return tickMassiveTransfusionPatientProcess(process, 240);
}

describe("WP-47C running delivery-mode command path", () => {
  let process: MassiveTransfusionPatientProcessRuntime;

  beforeEach(() => {
    clearInstructorRuntimeOwners(); clearTimelineEvents(); resetMtpCommands(); process = running();
    registerInstructorRuntimeOwner({ exerciseId, patientId, supportedEvents: [], execute: () => ({ ok: false, reason: "unsupported" }),
      executeMtpAction(commandId, action, _units, options) {
        if (action !== "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE") return { ok: false, reason: "unsupported" };
        const before = process.clinicalState.administrations.find(item => item.administrationId === options?.administrationId)?.deliveryMode;
        try {
          process = changeBloodProductDeliveryMode(process, commandId, String(options?.administrationId), options?.deliveryMode as "GRAVITY" | "PRESSURE_BAG" | "RAPID_INFUSER");
          return { ok: true, runtimeEventId: `MTP:${commandId}`, changed: before !== options?.deliveryMode };
        } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "failed" }; }
      } });
  });

  afterEach(() => { clearInstructorRuntimeOwners(); clearTimelineEvents(); resetMtpCommands(); });

  test("UI command boundary changes the canonical running bag and records one Estonian Timeline event", () => {
    const command = { commandId: "MODE-1", exerciseId, patientId, action: "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE" as const,
      units: 1, issuedBy: "Case Manager", deliveryMode: "PRESSURE_BAG" as const, vascularAccessLineId: "IV-1" as const,
      administrationId: "RBC-1" };
    expect(handleMtpCommand(command).ok).toBe(true);
    expect(process.clinicalState.administrations[0]).toMatchObject({ administrationId: "RBC-1", vascularAccessLineId: "IV-1",
      deliveryMode: "PRESSURE_BAG", deliveredVolumeMl: 100, expectedCompletionAtSec: 560 });
    expect(getTimelineEvents(patientId)).toHaveLength(1);
    expect(getTimelineEvents(patientId)[0]).toMatchObject({ title: "Verekomponendi manustamisviis muudetud", simulationTimeSec: 0 });
  });

  test("same command replay is idempotent and same-mode new intent emits no duplicate evidence", () => {
    const command = { commandId: "MODE-1", exerciseId, patientId, action: "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE" as const,
      issuedBy: "Case Manager", deliveryMode: "PRESSURE_BAG" as const, administrationId: "RBC-1" };
    const first = handleMtpCommand(command); const replay = handleMtpCommand(command);
    expect(replay).toEqual(first); expect(getTimelineEvents(patientId)).toHaveLength(1);
    expect(handleMtpCommand({ ...command, commandId: "MODE-SAME" }).ok).toBe(true);
    expect(getTimelineEvents(patientId)).toHaveLength(1);
    expect(process.pendingEvidence.filter(item => item.eventType === "BLOOD_PRODUCT_DELIVERY_MODE_CHANGED")).toHaveLength(1);
  });

  test("each physical user intent receives a unique monotonic command id", () => {
    const first = createMtpCommandId(exerciseId, patientId, "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE");
    const second = createMtpCommandId(exerciseId, patientId, "BLOOD_PRODUCT_DELIVERY_MODE_CHANGE");
    expect(first).not.toBe(second);
    expect(first).toContain("BLOOD_PRODUCT_DELIVERY_MODE_CHANGE-0-1");
    expect(second).toContain("BLOOD_PRODUCT_DELIVERY_MODE_CHANGE-0-2");
  });
});
