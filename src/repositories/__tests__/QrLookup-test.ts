import { findLocationZoneByCode } from "@/repositories/LocationRepository";
import { findPatientByNationalId } from "@/repositories/PatientRepository";

describe("QR lookup aliases", () => {
  test("finds a patient by both NationalId and PatientId", () => {
    expect(findPatientByNationalId("38701032343")?.id).toBe("PT-001");
    expect(findPatientByNationalId("pt-001")?.id).toBe("PT-001");
  });

  test("finds a location by both Code and LocationId", () => {
    expect(findLocationZoneByCode("LOC-EMO-TRIAGE")?.id).toBe("LOC-001");
    expect(findLocationZoneByCode("loc-001")?.id).toBe("LOC-001");
  });
});
