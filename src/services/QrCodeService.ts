export type QrCodeType = "patient" | "location";

export type QrCodeResult =
  | { status: "valid"; value: string }
  | { status: "invalid" }
  | { status: "wrong-type"; actualType: QrCodeType };

type DecodedQrCode = {
  type?: QrCodeType;
  value: string;
};

function normalizeType(value: unknown): QrCodeType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "patient" || normalized === "location"
    ? normalized
    : undefined;
}

function decodeJsonQrCode(raw: string): DecodedQrCode | undefined {
  if (!raw.startsWith("{")) {
    return undefined;
  }

  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const type = normalizeType(payload.type);
    const candidate = payload.value ?? payload.code ?? payload.nationalId;

    if (typeof candidate !== "string") {
      return { type, value: "" };
    }

    return { type, value: candidate.trim() };
  } catch {
    return { value: "" };
  }
}

function decodeUriValue(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

function decodeQrCode(rawValue: string): DecodedQrCode {
  const raw = rawValue.trim();
  const jsonPayload = decodeJsonQrCode(raw);

  if (jsonPayload) {
    return jsonPayload;
  }

  const uriMatch = raw.match(/^russicaptor:\/\/(patient|location)\/(.+)$/i);
  if (uriMatch) {
    return {
      type: normalizeType(uriMatch[1]),
      value: decodeUriValue(uriMatch[2]),
    };
  }

  const prefixMatch = raw.match(/^(patient|location)\s*:\s*(.*)$/i);
  if (prefixMatch) {
    return {
      type: normalizeType(prefixMatch[1]),
      value: prefixMatch[2].trim(),
    };
  }

  return { value: raw };
}

export function readQrCode(
  rawValue: string,
  expectedType: QrCodeType
): QrCodeResult {
  const decoded = decodeQrCode(rawValue);

  if (!decoded.value) {
    return { status: "invalid" };
  }

  if (decoded.type && decoded.type !== expectedType) {
    return { status: "wrong-type", actualType: decoded.type };
  }

  return { status: "valid", value: decoded.value };
}
