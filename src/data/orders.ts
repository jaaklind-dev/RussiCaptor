import { Order } from "@/models/Order";

export const orders: Order[] = [
  {
    id: "ORD-001",
    exerciseId: "demo",
    patientId: "PT-001",

    category: "lab",
    title: "Veregaasid",

    status: "available",
    visibility: "revealed",
  },

  {
    id: "ORD-002",
    exerciseId: "demo",
    patientId: "PT-001",

    category: "lab",
    title: "Täisvere analüüs",

    status: "available",
    visibility: "revealed",
  },

  {
    id: "ORD-003",
    exerciseId: "demo",
    patientId: "PT-001",

    category: "imaging",
    title: "KT pea",

    status: "available",
    visibility: "revealed",
  },

  {
    id: "ORD-004",
    exerciseId: "demo",
    patientId: "PT-001",

    category: "imaging",
    title: "Rindkere röntgen",

    status: "available",
    visibility: "revealed",
  },
];