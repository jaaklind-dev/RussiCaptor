import type { InstructorEventDefinition, InstructorEventType } from "@/models/InstructorCommand";
export const instructorEventCatalogue: readonly InstructorEventDefinition[] = [
  { eventType: "RESPIRATORY_DETERIORATION", label: "Respiratory deterioration", description: "Progress the active respiratory process.", targetProcessType: "HYPOVENTILATION_HYPERCAPNIA", confirmationRequired: true },
  { eventType: "AIRWAY_OBSTRUCTION", label: "Airway obstruction", description: "Activate an airway obstruction process.", confirmationRequired: true },
  { eventType: "VOMITING", label: "Vomiting", description: "Create a vomiting and aspiration-risk event.", confirmationRequired: true },
  { eventType: "HYPOTENSION", label: "Hypotension", description: "Progress a process capable of producing hypotension.", confirmationRequired: true },
  { eventType: "REDUCED_CONSCIOUSNESS", label: "Reduced consciousness", description: "Progress a process affecting consciousness.", confirmationRequired: true },
  { eventType: "RECOVERY_TRIGGER", label: "Recovery trigger", description: "Request recovery from an active process.", confirmationRequired: true },
];
export function findInstructorEventDefinition(eventType: InstructorEventType): InstructorEventDefinition { return instructorEventCatalogue.find(item => item.eventType === eventType)!; }
