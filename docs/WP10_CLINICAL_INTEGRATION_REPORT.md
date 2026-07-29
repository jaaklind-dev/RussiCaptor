# WP-10 – Clinical Integration Framework

Staatus: **PASS**  
Kuupäev: 2026-07-29

## Rakendatud

- typed `ClinicalIntegrationInput` ja `ClinicalEffect` lepingud;
- deterministlik `ClinicalProcessRegistry`;
- idempotentne ja atomaarse rejection'iga `ClinicalIntegrationFramework`;
- versioneeritud `InterventionDefinition`;
- patsiendipõhine `InterventionInstance` elutsükliga RUNNING, COMPLETED,
  CANCELLED ja FAILED;
- required resources, parameters, duration ja preconditions foundation;
- `InterventionRuntime`, mis ei kirjuta RuntimeState'i ega PatientProcess'i otse;
- Oxygen Therapy definitsioon parameetriga `flowRateLMin`;
- inspired-oxygen clinical effect;
- HV ja Hypoxia process handlerid;
- ScenarioEngine'i ACTION ja resource-intervention teede ühendamine sama effect
  pipeline'iga;
- patsiendikaardi read-only Active interventions projektsioon;
- intervention instance'i ja clinical integration state'i kaasamine replay hash'i.

## Kliiniline voog

```text
Oxygen Therapy 15 L/min
        |
        v
InterventionInstance (RUNNING)
        |
        v
INSPIRED_OXYGEN_INCREASED
        |
        v
HypoxiaPatientProcess
        |
        v
ProcessOutput
        |
        v
OwnershipResolver -> RuntimeAggregationPipeline -> RuntimeState
```

Maski reserveerimine ei kirjuta SpO2 väärtust. SpO2 muutub ainult Hypoxia protsessi
progressiooni kaudu. Oxygen Therapy lõpetamisel emiteeritakse oxygen-removed effect
ja edasised tick'id ei kasuta enam hapnikutoetust.

## Tagasiühilduvus

- Golden workbook: muutmata;
- Golden assertion'id ja comparator'id: muutmata;
- OwnershipResolver: ümber kirjutamata;
- RuntimeAggregationPipeline: ümber kirjutamata;
- GoldenRunner: ümber kirjutamata;
- varasemad ACTION sisendid: toetatud sama effect pipeline'i kaudu;
- kõik olemasolevad testid: PASS.

## Kontrollid

| Kontroll | Tulemus |
|---|---:|
| TypeScript | PASS |
| ESLint | PASS |
| `git diff --check` | PASS |
| Jest testipakid | 24 / 24 PASS |
| Jest testid | 131 / 131 PASS |
| Golden regressioonid | PASS |
| Deterministlik replay | PASS |

## Foundation-piirangud

- Concrete definition on praegu ainult Oxygen Therapy jaoks.
- Monitor, IV access, BVM ja ventilator vajavad järgmistes tööpakettides oma
  definitsioone ning mehhanismipõhiseid effect'e.
- Täielikku kliinilist sobivusmaatriksit ega ravi soovitusloogikat pole lisatud.
- Oxygen Therapy ei modelleeri veel lekkimist, high-flow süsteeme, toksilisust ega
  patsiendipõhist hapniku dissotsiatsiooni.
