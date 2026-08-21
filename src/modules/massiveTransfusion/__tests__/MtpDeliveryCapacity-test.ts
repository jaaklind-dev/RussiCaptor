import { MTP_REFERENCE_CONFIGURATION, WP47C_DEFAULT_DELIVERY_CONFIGURATION, type BloodProductDeliveryMode,
  type MassiveTransfusionConfiguration, type MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";
import { activateMassiveTransfusion, bootstrapMassiveTransfusionPatientProcess, setMtpVascularAccessCount,
  startBloodProductAdministration, terminateBloodProductAdministration, tickMassiveTransfusionPatientProcess } from "@/services/runtime/MassiveTransfusionPatientProcess";

const configuration = (initialVascularAccessCount: number): MassiveTransfusionConfiguration => ({
  ...structuredClone(MTP_REFERENCE_CONFIGURATION),
  bloodProductDelivery: { ...WP47C_DEFAULT_DELIVERY_CONFIGURATION, initialVascularAccessCount },
});
const fresh = (lines: number) => activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("PT-WP47C", {
  configuration: configuration(lines),
}), "ACTIVATE");
const start = (process: MassiveTransfusionPatientProcessRuntime, id: string, product: "RBC" | "PLASMA" | "PLATELETS",
  mode: BloodProductDeliveryMode = "GRAVITY", line?: "IV-1" | "IV-2" | "IV-3") =>
  startBloodProductAdministration(process, id, product, 1, mode, line);

describe("WP-47C delivery rate and vascular access capacity", () => {
  test("zero lines rejects blood product start without consuming inventory", () => {
    const process = fresh(0);
    expect(() => start(process, "R1", "RBC")).toThrow("NO_FREE_VASCULAR_ACCESS");
    expect(process.clinicalState.inventory.RBC).toBe(6);
  });

  test("one line permits one bag and blocks same-line overlap", () => {
    const first = start(fresh(1), "R1", "RBC", "GRAVITY", "IV-1");
    expect(first.clinicalState.vascularAccessLines[0]).toMatchObject({ lineId: "IV-1", status: "OCCUPIED", administrationId: "R1" });
    expect(() => start(first, "P1", "PLASMA", "GRAVITY", "IV-1")).toThrow("NO_FREE_VASCULAR_ACCESS");
    expect(first.clinicalState.inventory.PLASMA).toBe(6);
  });

  test("two lines permit two products and reject a third bag", () => {
    let process = start(fresh(2), "R1", "RBC", "GRAVITY");
    process = start(process, "P1", "PLASMA", "PRESSURE_BAG");
    expect(process.clinicalState.administrations.find(item => item.administrationId === "R1")?.vascularAccessLineId).toBe("IV-1");
    expect(process.clinicalState.administrations.find(item => item.administrationId === "P1")?.vascularAccessLineId).toBe("IV-2");
    expect(() => start(process, "T1", "PLATELETS")).toThrow("NO_FREE_VASCULAR_ACCESS");
  });

  test("three gravity bags run concurrently on deterministic distinct lines", () => {
    let process = start(fresh(3), "R1", "RBC"); process = start(process, "P1", "PLASMA"); process = start(process, "T1", "PLATELETS");
    expect(process.clinicalState.administrations.map(item => item.vascularAccessLineId).sort()).toEqual(["IV-1", "IV-2", "IV-3"]);
  });

  test("rapid infuser limits three lines to two rapid bags", () => {
    let process = start(fresh(3), "R1", "RBC", "RAPID_INFUSER"); process = start(process, "P1", "PLASMA", "RAPID_INFUSER");
    expect(() => start(process, "T1", "PLATELETS", "RAPID_INFUSER")).toThrow("DELIVERY_DEVICE_CAPACITY_FULL");
    expect(process.clinicalState.inventory.PLATELETS).toBe(1);
  });

  test("two rapid bags and one gravity bag coexist on three lines", () => {
    let process = start(fresh(3), "R1", "RBC", "RAPID_INFUSER"); process = start(process, "P1", "PLASMA", "RAPID_INFUSER");
    process = start(process, "T1", "PLATELETS", "GRAVITY");
    expect(process.clinicalState.administrations.filter(item => item.state === "RUNNING")).toHaveLength(3);
  });

  test.each([["GRAVITY", 720], ["PRESSURE_BAG", 480], ["RAPID_INFUSER", 180]] as const)("%s completes exactly at %s seconds", (mode, duration) => {
    let process = start(fresh(1), "R1", "RBC", mode);
    process = tickMassiveTransfusionPatientProcess(process, duration - 1);
    expect(process.clinicalState.administrations[0].state).toBe("RUNNING");
    expect(process.clinicalState.completedRbcUnitsTotal).toBe(0);
    process = tickMassiveTransfusionPatientProcess(process, 1);
    expect(process.clinicalState.administrations[0]).toMatchObject({ state: "COMPLETED", deliveredVolumeMl: 300 });
    expect(process.clinicalState.vascularAccessLines[0].status).toBe("FREE");
  });

  test("continuous configured rate follows actual bag volume divided by duration", () => {
    const gravity = tickMassiveTransfusionPatientProcess(start(fresh(1), "R1", "RBC", "GRAVITY"), 60);
    const rapid = tickMassiveTransfusionPatientProcess(start(fresh(1), "R2", "RBC", "RAPID_INFUSER"), 60);
    expect(gravity.clinicalState.transfusedVolumeMl).toBe(25);
    expect(rapid.clinicalState.transfusedVolumeMl).toBe(100);
  });

  test("completion releases a line for a new deterministic start", () => {
    let process = tickMassiveTransfusionPatientProcess(start(fresh(1), "R1", "RBC"), 720);
    process = start(process, "P1", "PLASMA");
    expect(process.clinicalState.administrations.find(item => item.administrationId === "P1")).toMatchObject({ vascularAccessLineId: "IV-1", state: "RUNNING" });
  });

  test.each(["CANCELLED", "FAILED"] as const)("%s administration releases its line", terminal => {
    const running = start(fresh(1), "R1", "RBC");
    const stopped = terminateBloodProductAdministration(running, "R1", terminal);
    expect(stopped.clinicalState.vascularAccessLines[0].status).toBe("FREE");
    expect(start(stopped, "P1", "PLASMA").clinicalState.administrations.at(-1)?.vascularAccessLineId).toBe("IV-1");
  });

  test("three parallel RBC bags count calcium only at canonical completion", () => {
    let process = start(fresh(3), "R1", "RBC", "GRAVITY"); process = start(process, "R2", "RBC", "GRAVITY"); process = start(process, "R3", "RBC", "GRAVITY");
    process = tickMassiveTransfusionPatientProcess(process, 719);
    expect(process.clinicalState).toMatchObject({ completedRbcUnitsTotal: 0, calciumRecommended: false });
    process = tickMassiveTransfusionPatientProcess(process, 1);
    expect(process.clinicalState).toMatchObject({ completedRbcUnitsTotal: 3, completedRbcUnitsSinceLastCalcium: 3, calciumRecommended: true });
  });

  test("restart and takeover preserve occupancy, modes and completion times", () => {
    let process = start(fresh(3), "R1", "RBC", "GRAVITY"); process = start(process, "P1", "PLASMA", "PRESSURE_BAG");
    process = tickMassiveTransfusionPatientProcess(process, 120);
    const takenOver = structuredClone(structuredClone(process));
    expect(takenOver.clinicalState.vascularAccessLines).toEqual(process.clinicalState.vascularAccessLines);
    expect(takenOver.clinicalState.administrations).toEqual(process.clinicalState.administrations);
    expect(tickMassiveTransfusionPatientProcess(takenOver, 360)).toEqual(tickMassiveTransfusionPatientProcess(process, 360));
  });

  test("duplicate command neither consumes inventory nor occupies another line", () => {
    const first = start(fresh(2), "R1", "RBC"); const duplicate = start(first, "R1", "RBC");
    expect(duplicate).toEqual(first); expect(duplicate.clinicalState.inventory.RBC).toBe(5);
    expect(duplicate.clinicalState.vascularAccessLines.filter(line => line.status === "OCCUPIED")).toHaveLength(1);
  });

  test("access count is canonical, bounded and cannot remove an occupied line", () => {
    let process = setMtpVascularAccessCount(fresh(0), 3); expect(process.clinicalState.vascularAccessLines.map(line => line.lineId)).toEqual(["IV-1", "IV-2", "IV-3"]);
    process = start(process, "R1", "RBC", "GRAVITY", "IV-3");
    expect(() => setMtpVascularAccessCount(process, 2)).toThrow("VASCULAR_ACCESS_OCCUPIED");
    expect(() => setMtpVascularAccessCount(process, 4)).toThrow("INVALID_VASCULAR_ACCESS_COUNT");
  });

  test("legacy configuration retains historical rate and unrestricted concurrency", () => {
    let process = activateMassiveTransfusion(bootstrapMassiveTransfusionPatientProcess("LEGACY", { configuration: MTP_REFERENCE_CONFIGURATION }), "ACT");
    process = startBloodProductAdministration(process, "R1", "RBC", 1); process = startBloodProductAdministration(process, "P1", "PLASMA", 1);
    process = tickMassiveTransfusionPatientProcess(process, 60);
    expect(process.clinicalState).toMatchObject({ transfusedVolumeMl: 200, vascularAccessCount: 0 });
  });
});
