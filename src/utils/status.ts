import { t } from "@/locales";

export function getStatusLabel(
  status: "processing" | "available" | "viewed"
) {
  switch (status) {
    case "processing":
      return t.lab.status.processing;

    case "available":
      return t.lab.status.available;

    case "viewed":
      return t.lab.status.viewed;
  }
}