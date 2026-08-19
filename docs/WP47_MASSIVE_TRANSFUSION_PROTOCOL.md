# WP-47 — Massive transfusion protocol v1

## Architecture gate

| Capability | Assessment | Decision |
|---|---|---|
| Blood volume model | EXTENSION_REQUIRED | Hemorrhage owns historical loss; MTP owns replacement volume. |
| Hemorrhage integration | EXTENSION_REQUIRED | Independent PatientProcess contributors compose in the Vital Sign Engine. MTP never changes bleeding rate. |
| Existing fluid/transfusion intervention | EXTENSION_REQUIRED | The legacy generic blood-product effect is not a finite, typed or progressive product model. |
| Blood-product resource model | ABSENT | MTP owns configured finite RBC, plasma and platelet inventory. |
| Oxygen-carrying capacity | ABSENT | v1 adds normalized RBC capacity, not a falsely precise Hb/Hct equation. |
| Coagulation | ABSENT | v1 records normalized plasma/platelet support; detailed coagulopathy is deferred. |
| Calcium | ABSENT | Deferred; MTP activation does not administer calcium. |
| Temperature | ABSENT | Deferred; v1 does not claim lethal-diamond modelling. |
| Persistence | EXTENSION_REQUIRED | The process is a canonical lifecycle process and is serialized by existing WP-44A/WP-44B process persistence. |
| ADR required | NO | This uses frozen PatientProcess, contributor, module and persistence extension points; no Runtime layer changes. |

TXA is not coupled to MTP. No canonical Hb/Hct exists. Existing crystalloid and generic infusion support remains independent.

## Canonical flow

```text
MTP_ACTIVATION (no physiological effect)
        ↓
typed product administration command (stable ID)
        ↓
finite inventory reservation/consumption
        ↓
MASSIVE_TRANSFUSION PatientProcess progresses over simulation time
        ↓
replacement volume + RBC capacity + recorded coagulation support
        ↓
PatientVitalContributor deltas
        ↓
Vital Sign Engine and canonical Runtime Snapshot
```

Hemorrhage continues independently. Cumulative blood loss is never decremented. Consequently uncontrolled outflow can exceed transfusion inflow, source control can reduce new loss, and replacement can then progressively offset—but never erase—the historical deficit contribution.

## Reference constants

The configurable reference pack is 6 RBC units, 6 plasma units and 1 adult platelet dose. RBC is 300 mL/unit, plasma 250 mL/unit, and platelets 300 mL/dose. Reference administration rate is 100 mL/min. One RBC unit contributes 1 normalized oxygen-capacity unit; plasma and platelets contribute coagulation-support units but no RBC capacity. These are deterministic training constants, not laboratory-precision pharmacokinetics.

RBC and plasma are the core WP-47 MTP capabilities. Platelet administration is availability-dependent: zero platelet inventory does not block MTP activation, RBC/plasma administration, Runtime continuation, exercise completion, Timeline, or Debrief. When platelets are available their finite inventory, administration, persistence, idempotency, and factual evidence follow the same canonical product path. Absence or non-administration is factual context rather than a critical clinical failure, and must not by itself produce a future `NOT_MET` assessment. Detailed coagulation physiology remains outside WP-47 v1.

The architecture supports a configurable balanced cycle without representing it as an opaque bolus. Product identities and quantities remain individually observable and persistable.

## Deferred capabilities

Detailed dilutional coagulopathy, fibrinogen/cryoprecipitate, ionized calcium, citrate toxicity, hypothermia, laboratory Hb/Hct and transfusion reactions require later explicit clinical extensions. v1 does not imply those effects.
