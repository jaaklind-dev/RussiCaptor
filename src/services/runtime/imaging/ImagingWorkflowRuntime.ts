import { ImagingWorkflowCore } from "./ImagingWorkflowCore";
import { stableJson } from "@/utils/stableJson";
import { sha256Text } from "@/utils/sha256";
import { adaptLegacyImagingAttachment, validateImagingAssetReference } from "@/services/imaging/ImagingAssetRegistry";

/** Canonical API, authority callback and integrity behavior are unchanged. */
export class ImagingWorkflowRuntime extends ImagingWorkflowCore {
  constructor(mutationAllowed: () => boolean = () => true) {
    super({ hashReport: sha256Text, equal: (left, right) => stableJson(left) === stableJson(right),
      validateAsset: validateImagingAssetReference, adaptLegacy: adaptLegacyImagingAttachment }, mutationAllowed);
  }
}
