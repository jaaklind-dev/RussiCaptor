import { Patient } from "@/models/Patient";

export const patients: Patient[] = [
  {
    id: "PT-001",
    isikukood: "38701032343",
    name: "Jüri Kask",
    triage: "P2",
    status: "Active",
    location: "EMO triaaž",
    lastSeen: "09:22",

    mist: {
      mechanism: "Haigestus kodus, saabus EMO-sse omal jalal.",
      injuries: "Nägemishäire, nõrkus, neelamisel ebamugavus.",
      signs: "RR 138/82, HR 92, SpO₂ 97%, GCS 15.",
      treatment: "Ravi veel puudub.",
    },
  },
];