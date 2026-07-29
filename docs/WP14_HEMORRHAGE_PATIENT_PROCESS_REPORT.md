# WP-14 – Hemorrhage PatientProcess

Staatus: **PASS**  
Kuupäev: 2026-07-29

## Arhitektuur ja effect resolution

```text
Intervention -> active ClinicalEffect set -> Hemorrhage PatientProcess
             -> ProcessOutput -> OwnershipResolver -> Aggregation
```

Igal tick'il effect'id filtreeritakse ja järjestatakse effect type'i ning source
instance ID järgi. STOP võidab reduction'i; reduction'itest kasutatakse tugevaimat;
infusiooni ja vereprodukti konfigureeritud offset'id summeeritakse. Ükski
intervention ei kirjuta RuntimeState'i.

## Konfiguratsioon

- baseline bleeding rate;
- tourniquet ja binder efficiency;
- infusion ja blood-product offset;
- severity, perfusion, compensation ja trend thresholds.

Kõik väärtused tulevad fixture/process konfiguratsioonist; puudulik konfiguratsioon
lükatakse tagasi.

## Mudelid ja sündmused

- Hemorrhage: NONE, MINOR, MODERATE, SEVERE, CATASTROPHIC;
- Perfusion: NORMAL, COMPENSATED, DECOMPENSATED, CRITICAL;
- Compensation: COMPENSATED, FAILING, FAILED;
- HemorrhageStarted, HemorrhageReduced, HemorrhageStopped;
- PerfusionChanged, CompensationChanged.

## Kontrollid

| Kontroll | Tulemus |
|---|---:|
| TypeScript / ESLint / git diff | PASS |
| Testipakid | 28 / 28 PASS |
| Testid | 155 / 155 PASS |
| WP-14 sihttestid | 4 / 4 PASS |
| Golden regressioonid | PASS |
| Process/effects/events/assessment/replay hash | identne |
| Hemorrhage line coverage | 100% |

Golden Packi, InterventionEngine'i, ResourcePool'i, Assessment Engine'i ega
AggregationPipeline'i ei muudetud. Ravimeid, ATLS klassifikatsiooni ja Massive
Transfusion Protocol loogikat ei lisatud.
