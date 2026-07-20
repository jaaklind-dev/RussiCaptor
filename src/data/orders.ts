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
    workflow: {
      resultAction: "lab.available",
      resultTargetId: "ABG",
      delayMinutes: 2,
      resultTitle: "Veregaasid valmis",
      resultDescription: "Veregaaside tulemused on nüüd kättesaadavad.",
    },
  },

  {
    id: "ORD-002",
    exerciseId: "demo",
    patientId: "PT-001",

    category: "lab",
    title: "Täisvere analüüs",

    status: "available",
    visibility: "revealed",
    workflow: {
      resultAction: "lab.available",
      resultTargetId: "CBC",
      delayMinutes: 5,
      resultTitle: "Täisvere analüüs valmis",
      resultDescription: "Täisvere analüüsi tulemused on nüüd kättesaadavad.",
    },
  },

  {
    id: "ORD-003",
    exerciseId: "demo",
    patientId: "PT-001",

    category: "imaging",
    title: "KT pea",

    status: "available",
    visibility: "revealed",
    workflow: {
      resultAction: "imaging.available",
      resultTargetId: "IMG-001",
      delayMinutes: 3,
      resultTitle: "KT pea valmis",
      resultDescription: "KT pea uuring on nüüd kättesaadav.",
    },
  },

  {
    id: "ORD-004",
    exerciseId: "demo",
    patientId: "PT-001",

    category: "imaging",
    title: "Rindkere röntgen",

    status: "available",
    visibility: "revealed",
    workflow: {
      resultAction: "imaging.available",
      resultTargetId: "IMG-002",
      delayMinutes: 4,
      resultTitle: "Rindkere röntgen valmis",
      resultDescription: "Rindkere röntgenuuring on nüüd kättesaadav.",
    },
  },
];
