import { MTP_REFERENCE_CONFIGURATION, UNLIMITED_BLOOD_PRODUCT_INVENTORY } from "@/models/MassiveTransfusion";
import { activateMassiveTransfusion, bootstrapMassiveTransfusionPatientProcess,
  startBloodProductAdministration } from "@/services/runtime/MassiveTransfusionPatientProcess";

const unlimitedConfiguration = () => ({ ...structuredClone(MTP_REFERENCE_CONFIGURATION),
  initialInventory: { RBC: UNLIMITED_BLOOD_PRODUCT_INVENTORY,
    PLASMA: UNLIMITED_BLOOD_PRODUCT_INVENTORY, PLATELETS: 0 } });

describe("generic unlimited transfusion inventory", () => {
  test("preserves the existing finite initialization, depletion and exhaustion contract", () => {
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT", {
      configuration: MTP_REFERENCE_CONFIGURATION }), "ACT");
    process = startBloodProductAdministration(process, "RBC-1", "RBC", 1);
    expect(process.clinicalState.inventory).toEqual({ RBC: 5, PLASMA: 6, PLATELETS: 1 });
    expect(() => startBloodProductAdministration(process, "PLATELETS-2", "PLATELETS", 2))
      .toThrow("BLOOD_PRODUCT_UNAVAILABLE");
  });

  test("allows repeated distinct administrations without fabricating or depleting a balance", () => {
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT", {
      configuration: unlimitedConfiguration() }), "ACT");
    for (let index = 0; index < 25; index += 1) {
      process = startBloodProductAdministration(process, `RBC-${index}`, "RBC", 1);
      process = startBloodProductAdministration(process, `PLASMA-${index}`, "PLASMA", 1);
    }
    expect(process.clinicalState.inventory).toEqual({ RBC: { mode: "UNLIMITED" },
      PLASMA: { mode: "UNLIMITED" }, PLATELETS: 0 });
    expect(process.clinicalState.administrations).toHaveLength(50);
    expect(process.pendingEvidence.filter(item => item.eventType === "BLOOD_PRODUCT_ADMINISTRATION_STARTED"))
      .toHaveLength(50);
  });

  test("keeps mixed inventory independent and rejects finite zero platelets", () => {
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT", {
      configuration: unlimitedConfiguration() }), "ACT");
    process = startBloodProductAdministration(process, "RBC", "RBC", 1);
    process = startBloodProductAdministration(process, "PLASMA", "PLASMA", 1);
    expect(() => startBloodProductAdministration(process, "PLATELETS", "PLATELETS", 1))
      .toThrow("BLOOD_PRODUCT_UNAVAILABLE");
    expect(process.clinicalState.inventory).toEqual({ RBC: { mode: "UNLIMITED" },
      PLASMA: { mode: "UNLIMITED" }, PLATELETS: 0 });
  });

  test("retains unlimited state and command idempotency across a checkpoint-shaped round trip", () => {
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT", {
      configuration: unlimitedConfiguration() }), "ACT");
    process = startBloodProductAdministration(process, "RBC", "RBC", 1);
    expect(startBloodProductAdministration(process, "RBC", "RBC", 1)).toEqual(process);
    const restored = structuredClone(process);
    expect(restored.clinicalState.inventory).toEqual({ RBC: { mode: "UNLIMITED" },
      PLASMA: { mode: "UNLIMITED" }, PLATELETS: 0 });
    expect(startBloodProductAdministration(restored, "RBC-2", "RBC", 1).clinicalState.inventory.RBC)
      .toEqual({ mode: "UNLIMITED" });
  });

  test.each([-1, 1.5, { mode: "UNKNOWN" }, { mode: "UNLIMITED", quantity: 10 }])(
    "rejects malformed inventory value %p", value => {
    const configuration = { ...structuredClone(MTP_REFERENCE_CONFIGURATION),
      initialInventory: { ...MTP_REFERENCE_CONFIGURATION.initialInventory, RBC: value } };
    expect(() => bootstrapMassiveTransfusionPatientProcess("PT", { configuration }))
      .toThrow("MTP_INVENTORY_CONFIGURATION_INVALID");
    });
});
