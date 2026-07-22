import { readQrCode } from "@/services/QrCodeService";

describe("QR code parsing", () => {
  test("keeps existing plain patient and location codes working", () => {
    expect(readQrCode(" 38701032343 ", "patient")).toEqual({
      status: "valid",
      value: "38701032343",
    });
    expect(readQrCode(" LOC-ICU-2 ", "location")).toEqual({
      status: "valid",
      value: "LOC-ICU-2",
    });
  });

  test("reads typed prefix, URI and JSON payloads", () => {
    expect(readQrCode("PATIENT:38701032343", "patient")).toEqual({
      status: "valid",
      value: "38701032343",
    });
    expect(
      readQrCode("russicaptor://location/LOC-ICU-2", "location")
    ).toEqual({ status: "valid", value: "LOC-ICU-2" });
    expect(
      readQrCode(
        JSON.stringify({ type: "patient", nationalId: "38701032343" }),
        "patient"
      )
    ).toEqual({ status: "valid", value: "38701032343" });
  });

  test("rejects a QR code intended for the other scanner", () => {
    expect(readQrCode("LOCATION:LOC-ICU-2", "patient")).toEqual({
      status: "wrong-type",
      actualType: "location",
    });
    expect(readQrCode("PATIENT:38701032343", "location")).toEqual({
      status: "wrong-type",
      actualType: "patient",
    });
  });

  test("rejects empty and malformed structured payloads", () => {
    expect(readQrCode("   ", "patient")).toEqual({ status: "invalid" });
    expect(readQrCode("PATIENT:", "patient")).toEqual({ status: "invalid" });
    expect(readQrCode("{not-json", "patient")).toEqual({ status: "invalid" });
    expect(readQrCode("russicaptor://patient/%ZZ", "patient")).toEqual({
      status: "invalid",
    });
  });
});
