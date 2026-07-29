# WP-13 – Circulation & Vascular Access Framework

Staatus: **PASS**  
Kuupäev: 2026-07-29

## Arhitektuur

Circulation intervention reserveerib ressursid olemasoleva InterventionEngine'i ja
ResourcePool'i kaudu. InterventionInstance uuendab deterministlikku
CirculationState projektsiooni ja toodab ClinicalEffect'e; RuntimeState'i otsekirjutust
ei toimu.

## CirculationState

- mitu samaaegset `PERIPHERAL_IV`, `IO` või `CENTRAL_ACCESS` ligipääsu;
- aktiivsed `DIRECT_PRESSURE`, `TOURNIQUET`, `PELVIC_BINDER` kontrollid;
- running infusion instance ID-d;
- patient ID ja simulation timestamp.

## Definitsioonid

- Peripheral IV Access;
- Intraosseous Access;
- Central Venous Access foundation;
- Crystalloid Infusion;
- Blood Product Administration foundation;
- Pressure Infusion;
- Tourniquet;
- Pelvic Binder.

## Sündmused

- VascularAccessEstablished / VascularAccessRemoved;
- InfusionStarted / InfusionStopped;
- TourniquetApplied / TourniquetRemoved;
- PelvicBinderApplied / PelvicBinderRemoved.

## Kontrollid

| Kontroll | Tulemus |
|---|---:|
| TypeScript | PASS |
| ESLint | PASS |
| git diff --check | PASS |
| Testipakid | 27 / 27 PASS |
| Testid | 151 / 151 PASS |
| WP-13 sihttestid | 4 / 4 PASS |
| Golden regressioonid | PASS |
| RuntimeState replay | identne |
| ResourcePool replay | identne |
| Clinical effects replay | identne |
| Assessment replay | identne |
| Event log / replay hash | identne |

## Piirangud

- Hemorrhage PatientProcess pole veel aktiivsesse engine'isse lisatud; tourniquet'i
  effect jääb korrektselt unsupported/rejected, mitte ajutiseks RuntimeState häkiks.
- Vedelike ja vereproduktide täpset füsioloogiat ei modelleerita.
- Ravimite farmakoloogiat ja Massive Transfusion Protocol loogikat pole lisatud.
