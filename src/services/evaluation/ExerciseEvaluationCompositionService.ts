import type { EvaluationProfileProvenance, EvaluationProfileReference } from "@/models/evaluation/ExerciseEvaluation";
import type { ExerciseDefinition } from "@/models/exercise/ExerciseDefinition";
import { deepFreeze } from "@/utils/immutable";
import type { ProtocolConfigurationRegistry } from "@/services/protocol/ProtocolConfigurationRegistry";
import type { ExerciseEvaluationProfileRegistry } from "./ExerciseEvaluationProfileRegistry";
import { ExerciseEvaluationProfileValidator } from "./ExerciseEvaluationProfileValidator";

export class ExerciseEvaluationCompositionService {
  private readonly validator = new ExerciseEvaluationProfileValidator();
  constructor(private readonly profiles: ExerciseEvaluationProfileRegistry, private readonly protocols: ProtocolConfigurationRegistry) {}
  compose(definition: ExerciseDefinition, reference: EvaluationProfileReference): ExerciseDefinition {
    if (!definition.protocolProvenance) throw new Error("EVALUATION_PROFILE_REQUIRES_PROTOCOL");
    const profile = this.profiles.require(reference); const protocol = this.protocols.require({ protocolId: definition.protocolProvenance.protocolId, version: definition.protocolProvenance.version });
    this.validator.assertValid(profile, protocol);
    const provenance: EvaluationProfileProvenance = deepFreeze({ profileId: profile.profileId, version: profile.version, profileHash: profile.evaluationProfileHash, title: profile.title, protocolId: protocol.protocolId, protocolVersion: protocol.version }) as EvaluationProfileProvenance;
    return deepFreeze({ ...structuredClone(definition), evaluationProfileProvenance: provenance }) as ExerciseDefinition;
  }
}
