# WP-11 – Airway Management Framework

Staatus: **PASS**  
Kuupäev: 2026-07-29

## Arhitektuur

```text
InterventionEngine + ResourcePool + WP-9B conflict planner
                         |
                         v
              InterventionInstance
                  |             |
                  v             v
             AirwayState   ClinicalEffect
                                  |
                                  v
                           PatientProcess
                                  |
                                  v
                OwnershipResolver -> Aggregation
```

PatientProcess ei reserveeri ressursse ja intervention ei kirjuta RuntimeState'i.
AirwayState on deterministlik projektsioon, mitte teine füsioloogiline state.

## AirwayState

- airway: NONE, MANUAL, OPA, NPA, SUPRAGLOTTIC, ENDOTRACHEAL;
- ventilation: NONE, BVM, MECHANICAL;
- active oxygen delivery;
- confirmation;
- patient ID ja simulation timestamp.

## Definitsioonid

- Oxygen Therapy;
- Oropharyngeal Airway;
- Nasopharyngeal Airway;
- Supraglottic Airway – i-gel realisatsioon;
- Supraglottic Airway – LMA realisatsioon;
- Bag-Valve-Mask Ventilation;
- Endotracheal Intubation;
- Mechanical Ventilation.

Supraglottiline hingamistee on üldine kategooria; i-gel ja LMA on eraldi
ressursirealisatsioonid.

## Sündmused

- AirwayInserted;
- AirwayRemoved;
- VentilationStarted;
- VentilationStopped;
- AirwayConfirmed.

Kõik sündmused osalevad ScenarioEngine'i deterministlikus järjestuses ja replay
hash'is.

## Testitulemused

| Kontroll | Tulemus |
|---|---:|
| TypeScript | PASS |
| ESLint | PASS |
| git diff --check | PASS |
| Testipakid | 25 / 25 PASS |
| Testid | 141 / 141 PASS |
| Golden regressioonid | PASS |
| Replay AirwayState | identne |
| Replay ResourcePool | identne |
| Replay event log | identne |
| Replay hash | identne |

## Piirangud

- Golden Packi ei muudetud ja selles pole veel eraldi WP-11 airway assertion'eid.
- Ventilatsioonifüsioloogiat, keerukat gaasivahetust ega ravimimootorit ei lisatud.
- ET definitsiooni foundation-rada kasutab direct laryngoscope ressurssi; video
  laryngoscope on ressursimudelis olemas ja saab järgmise definitsioonivariandina
  lisanduda ilma frameworki muutmata.
