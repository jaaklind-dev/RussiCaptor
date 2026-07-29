# WP-12 – Clinical Assessment & Protocol Engine

Staatus: **PASS**  
Kuupäev: 2026-07-29

## Arhitektuur

Assessment Engine loeb ainult olemasolevaid snapshot'e: RuntimeState, event log,
intervention log ja instance'id, ResourcePool, AirwayState, clinical effects ning
timeline. Ükski neist pole evaluatorile kirjutava teenusena kättesaadav.

```text
Immutable assessment sources
          -> data-driven rules
          -> AssessmentResult[]
          -> AssessmentEvent[] + DebriefReport
```

## Rule Engine

Reegel sisaldab `ruleId`, nime, kategooriat, severity't, condition'it, oodatud
käitumist ja valikulist applicability condition'it. Toetatud foundation-tingimused:

- sündmuse olemasolu, minimaalne arv ja deadline;
- sündmuse puudumine;
- kahe sündmuse järjekord;
- maksimaalne sündmuste arv;
- rejected intervention;
- resource conflict;
- AirwayState välja võrdlus.

Reeglid sorteeritakse `ruleId` järgi. ALS, ATLS, MASCAL ja haiglaprotokollid jäävad
väliseks andmeks ning ei vaja evaluatori muutmist.

## Debrief

Debrief sisaldab simulation summary't, lõpetatud sekkumisi, järjestatud timeline'i,
kõiki assessment finding'eid, warning'uid, failed rule'e, strengths loendit ja
improvement opportunities loendit.

## Sündmused

- AssessmentPassed;
- AssessmentWarning;
- AssessmentFailed.

Assessment results, events ja debrief osalevad replay hash'is.

## Kontrollid

| Kontroll | Tulemus |
|---|---:|
| TypeScript | PASS |
| ESLint | PASS |
| git diff --check | PASS |
| Testipakid | 26 / 26 PASS |
| Testid | 145 / 145 PASS |
| WP-12 sihttestid | 4 / 4 PASS |
| Golden regressioonid | PASS |
| Assessment replay | identne |
| Debrief replay | identne |
| Assessment events | identne |
| Replay hash | identne |

## Piirangud

- WP-12 ei sisalda veel konkreetset ALS-, ATLS-, MASCAL- ega haiglaprotokolli.
- Reeglite workbook/import-formaat jääb järgmise tööpaketi teemaks.
- Assessment kaart on arendajavaade; lõppkasutaja debrief-ekraan pole veel lisatud.
- Assessment ei muuda füsioloogiat, ResourcePool'i ega InterventionEngine'it.
