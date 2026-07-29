# WP-16 – Vital Sign Engine

## Architecture

The Vital Sign Engine consumes configured baselines and typed contributors, then
publishes one read-only monitor state. It never writes to PatientProcess state and
does not read UI, ResourcePool, InterventionEngine, or AssessmentEngine.

Resolution order is `baseline -> permanent -> process -> medication -> temporary
-> limits/change-per-tick -> rounding`. Contributors are sorted deterministically.
Existing RuntimeAggregationPipeline target resolution is retained; its monitor
projection is now produced by VitalSignEngine rather than hard-wired smoothing.

## Models

- Vitals: HR, SBP, DBP, RR, SpO2, EtCO2, temperature, GCS and derived AVPU.
- Each reading: current, target, tick trend, direction and stability.
- Derived: MAP, shock index and pulse pressure.
- Monitor quality: VALID, UNRELIABLE, LOST or OFFLINE.
- Events: VitalSignChanged, TrendChanged and MonitorStateChanged.
- Configuration: baseline, minimum, maximum, maximum change per tick, response
  factor, rounding precision and instability threshold for every vital.

HV now contributes EtCO2 and Hypoxia contributes SpO2 through the generic
PatientProcess contributor contract. The same contract accepts medication-layer
contributors without embedding medication rules in the engine.

## Assessment and UI

Generic data-driven rules cover improving/deteriorating/stable trends and monitor
quality. Dashboard and patient developer cards display current values, baselines,
trends, contributors, quality, and derived values. Both views are read-only.

## Verification

| Check | Result |
|---|---|
| Baseline and configuration | PASS |
| Single/multiple process contribution | PASS |
| Medication contribution ordering | PASS |
| Limits and max change per tick | PASS |
| Derived values and trends | PASS |
| Monitor quality and events | PASS |
| Runtime, assessment, events and replay hash | PASS |
| HV P0 Golden suite | 7/7 PASS |
| WP-5 vertical slice | 3/3 PASS |
| HV + Hypoxia integration | 4/4 PASS |
| Hemorrhage regression | 4/4 PASS |
| VitalSignEngine coverage | 89.58% statements, 80.48% branches, 100% functions, 91.89% lines |

The canonical Golden workbook and existing assertions/comparators were not changed.
