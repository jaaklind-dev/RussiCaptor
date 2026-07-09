import { ScenarioEvent } from "@/models/ScenarioEvent";

export const scenarioEvents: ScenarioEvent[] = [
  {
    id: "SE-001",
    exerciseId: "demo",
    patientId: "PT-001",

    triggerAt: "+2m",

    action: "imaging.available",
    targetId: "IMG-001",

    title: "KT pea valmis",
    description: "KT pea uuring on nüüd kättesaadav.",

    executed: false,
  },
];