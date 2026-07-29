# WP-15 – Medication Framework

Staatus: **PASS**  
Kuupäev: 2026-07-29

## Arhitektuur

```text
MedicationDefinition -> MedicationAdministration -> MedicationEngine
                     -> ClinicalEffect -> eligible PatientProcess -> Aggregation
```

MedicationEngine valideerib definitsiooni, route'i, administration kuju ning IV/IO
korral CirculationState'is oleva konkreetse vascular access ID. Ta ei reserveeri
ressursse ega kirjuta RuntimeState'i.

## Mudelid

- route: IV, IO, IM, PO;
- category: vasopressor, antiarrhythmic, analgesic, sedative, crystalloid,
  bloodProduct, reversalAgent, other;
- state: ACTIVE, COMPLETED, CANCELLED;
- definition: ID, nimi, route'id, kategooria, abstract effects, kestus, metadata;
- administration: medication/route/dose/unit/timestamp/administrator/access ID.

## Sündmused

- MedicationOrdered;
- MedicationStarted;
- MedicationCompleted;
- MedicationCancelled;
- MedicationRejected.

## Kontrollid

| Kontroll | Tulemus |
|---|---:|
| TypeScript / ESLint / git diff | PASS |
| Testipakid | 29 / 29 PASS |
| Testid | 159 / 159 PASS |
| WP-15 sihttestid | 4 / 4 PASS |
| Golden regressioonid | PASS |
| Medication state/effects/events/assessment/replay | identne |
| MedicationEngine line coverage | 100% |

Ühtegi ravijuhist, ravimi-spetsiifilist erandit, farmakokineetikat,
farmakodünaamikat, ALS algoritmi ega otsest vitaalimõju ei lisatud.
