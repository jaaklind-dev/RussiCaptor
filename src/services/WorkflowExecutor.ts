import { ScenarioEvent } from "@/models/ScenarioEvent";

import { setImagingStatus } from "@/repositories/ImagingRepository";

import { addTimelineEvent } from "@/repositories/TimelineRepository";

import { getCurrentExercise } from "@/repositories/ExerciseRepository";

import { createId } from "@/utils/id";

export function executeScenarioEvent(event: ScenarioEvent): void {

  switch (event.action) {

    case "imaging.available":

      setImagingStatus(event.patientId, event.targetId, "available");

      addTimelineEvent({

        id: createId("TL"),

        exerciseId: getCurrentExercise().id,

        patientId: event.patientId,

        timestamp: new Date().toISOString(),

        type: "imaging",

        title: event.title,

        description: event.description,

        author: "System",

        visibility: "revealed",

      });

      break;

    case "imaging.processing":

      setImagingStatus(event.patientId, event.targetId, "processing");

      break;

    case "lab.available":

      break;

    default:

      break;

  }

}