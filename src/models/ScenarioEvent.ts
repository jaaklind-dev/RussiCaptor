export type ScenarioAction =

  | "lab.available"

  | "imaging.available"

  | "imaging.processing"

  | "order.completed"

  | "note.available";

export type ScenarioEvent = {

  id: string;

  exerciseId: string;

  patientId: string;

  triggerMinute: number;

  action: ScenarioAction;

  targetId: string;

  orderId?: string;

  title: string;

  description: string;

  executed: boolean;

  cancelled?: boolean;

  resolvedAtMinute?: number;

};
