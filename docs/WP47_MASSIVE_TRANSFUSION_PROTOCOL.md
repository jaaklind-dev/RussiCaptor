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
| Calcium | PROTOCOL SUPPORT | WP-47B records a configurable replacement obligation and administration evidence; detailed calcium/citrate physiology remains deferred. |
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

## WP-47B calcium replacement workflow

Calcium is an MTP protocol intervention, not a second medication framework. During active MTP the configurable calcium action is always available and documentable. The reference configuration recommends calcium after every three canonically completed RBC units since the last calcium administration and specifies calcium chloride 1 g IV by default. Started, failed and duplicate RBC commands do not increment the counter.

Only one calcium recommendation can be current. If additional RBC units complete while calcium is recommended, the same recommendation remains active and the exact counter continues increasing. Every successful calcium administration—including an early or repeated dose—is atomic in v1, records one canonical event, resets the since-calcium counter to zero from that administration point and starts the next recommendation cycle. It does not alter vitals. An outstanding recommendation never blocks exercise completion; Debrief presents omission after the threshold as a protocol miss and lists every actual administration factually. The process state, including counters, recommendation flag, last-administration time and administration history, follows the existing Runtime checkpoint and rehydration path. No separate calcium inventory is introduced; exercise-specific stock is deferred to package configuration work.

## Deferred capabilities

## WP-47C delivery capacity

WP-47C extends the same canonical MTP process with up to three deterministic vascular-access slots (`IV-1`–`IV-3`). A configured administration reserves the lowest-index compatible free line and decrements inventory only after a successful start. A rejected request consumes no inventory. Cancelled or failed bags remain historically consumed under the existing start-time accounting policy but release their line. There is no UI-only queue: capacity failures return `NO_FREE_VASCULAR_ACCESS` or `DELIVERY_DEVICE_CAPACITY_FULL`, and the responder retries after capacity becomes available.

Configured per-bag durations are 720 seconds for gravity, 480 seconds for a pressure bag and 180 seconds for a rapid infuser. One rapid infuser accepts at most two simultaneous bags and never overrides vascular-line capacity. Each bag retains its own mode, line, start time and expected completion. Volume enters continuously at `configured bag volume / configured duration`; completion, line release and RBC/calcium counting use only the canonical simulation clock. Packages without `bloodProductDelivery` retain the prior rate and concurrency behavior, preserving historical replay.

Detailed dilutional coagulopathy, fibrinogen/cryoprecipitate, ionized calcium, citrate toxicity, hypothermia, laboratory Hb/Hct and transfusion reactions require later explicit clinical extensions. Protocol recording of calcium replacement does not imply those physiological effects.
