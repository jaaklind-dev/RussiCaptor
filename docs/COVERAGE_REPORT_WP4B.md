# RussiCaptor coverage report

Raporti kuupäev: 2026-07-27  
Baaskommit: `53b4014`  
Fookus: WP-3 import, WP-3B runtime aggregation, WP-4B Golden runner ja engine adapter mapping.

## Kokkuvõte

| Mõõdik | Tulemus |
|---|---:|
| Testipakid | 14 / 14 PASS |
| Automaattestid | 85 / 85 PASS |
| Kogu `src` statement coverage | 60.41% (1822 / 3016) |
| Kogu `src` branch coverage | 48.60% (923 / 1899) |
| Kogu `src` function coverage | 58.78% (562 / 956) |
| Kogu `src` line coverage | 61.36% (1658 / 2702) |
| 0% line coverage failid | 50 |

Coverage mõõdeti käsuga, mis kaasab kõik `src/**/*.{ts,tsx}` failid. Seetõttu sisaldab
tulemus ka ekraane ja UI-komponente, mida tavapärane Jest run ei lae. Ainult testide
käigus laaditud failide statement coverage oleks 76.57%, kuid see pole kogu repo kate.

## Golden Pack coverage

| Kiht | Kaetud | Staatus |
|---|---:|---|
| Workbooki leping | 50 / 50 testi | PASS – päris workbook laaditi |
| Assertion'ite leping | 176 / 176 | PASS – ID-d, testiviited ja comparator'id valideeriti |
| P0 assertion'id | 148 | 2 PASS; ülejäänud ootavad engine'i võimekust |
| P1 assertion'id | 28 | Runneris toetatud, päris engine'i vastu käivitamata |
| Comparator'id | 176 / 176 | EQ, NEAR, COUNT_EQ, SET_EQ, LIST_EQ ja IN toetatud |
| Expected process tree read | 16 / 16 rida | PASS |
| Tegelik kliiniline Golden execution | 2 / 176 | HV-001 kaks assertion'it PASS |

Assertion'ite jaotus:

| Assertion type | Arv |
|---|---:|
| SNAPSHOT | 85 |
| EVENT | 28 |
| PROCESS_TREE | 24 |
| IMPORT | 13 |
| OWNERSHIP | 7 |
| RESOURCE | 5 |
| ACTION | 4 |
| PROCESS | 3 |
| REPLAY | 2 |
| INVARIANT | 2 |
| ENCOUNTER | 1 |
| IDEMPOTENCY | 1 |
| ROLLBACK | 1 |

Comparator'ite jaotus:

| Comparator | Arv |
|---|---:|
| EQ | 82 |
| COUNT_EQ | 63 |
| NEAR | 28 |
| IN | 1 |
| LIST_EQ | 1 |
| SET_EQ | 1 |

Oluline eristus: 176/176 tähendab runneri lepingu ja comparator'ite tuge. Kliiniline
simulatsioon on päriselt läbinud HV-001 kaks assertion'it; ülejäänud protsessi-,
resource- ja patsiendistsenaariumide mootorivõimed tuleb lisada järgmiste vertikaallõigetena.

## WP-3B ja WP-4B komponentide code coverage

| Komponent | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| GoldenEngineAdapter | 91.11% | 77.61% | 87.50% | 95.77% |
| GoldenComparators | 82.82% | 63.56% | 85.18% | 86.41% |
| GoldenReportWriter | 92.72% | 69.23% | 100% | 100% |
| GoldenTestExecutor | 72.00% | 43.24% | 61.90% | 75.38% |
| GoldenWorkbookLoader | 77.00% | 58.33% | 88.57% | 85.50% |
| OwnershipResolver | 91.11% | 86.53% | 100% | 94.73% |
| RuntimeAggregationPipeline | 91.05% | 77.96% | 90.14% | 92.23% |

WP-3B runtime'i ja engine adapteri põhitee kate on hea. Kõige suurem runneri sisemine
lünk on `GoldenTestExecutor` branch coverage, eelkõige erinevad BLOCKED/NOT_RUN/fail-fast
ja raporti veaharud.

## Suurimad katmata riskikohad

| Ala | Line coverage | Risk |
|---|---:|---|
| WorkbookImportService | 5.26% | Reaalse faili installi ja vigade käsitlemise regressioon |
| ModuleImportService | 41.99% | Failide lugemine, staging/Supabase commit ja rollback harud |
| ClockService | 41.66% | Pause/run ja simulatsiooniaja käitumine |
| ScenarioControlService | 42.85% | EXCON sündmuste nihutamine ja kohene käivitamine |
| StatePersistenceService | 47.05% | Taaste, lokaalne salvestus ja lifecycle |
| GoldenTestExecutor | 75.38% | P0 fail-fast ja veaaruande harud |

50 faili line coverage on 0%. Enamik neist on React Native ekraanid ja UI-komponendid;
lisaks on täiesti katmata `OneDriveProvider`, `CloudSyncService`, `LabService` ja mõned
väikesed utility-failid. UI 0% ei blokeeri engine'i tööd, kuid tähendab, et kasutaja
töövood vajavad hiljem component/E2E teste.

## Coverage hinnang

- WP-3B runtime aggregation: testikate on praeguse ulatuse jaoks piisav.
- WP-4B runner ja adapter mapping: infrastruktuuri kate on piisav engine'i ühendamise alustamiseks.
- Mooduliimport: puhta valideerimisloogika stressitestid on olemas, kuid päris faili/Supabase
  staging ja atomaarne commit vajavad integratsiooniteste.
- Golden clinical coverage: esimene test HV-001 läbib; ülejäänud P0 testid vajavad
  järgmisi PatientProcess/Hypoxia/resource vertikaallõikeid.

## Järgmine minimaalne samm

Laiendada olemasolevat `GoldenEngineHarness` vertikaallõiget järgmisele HV testile:

1. lisada üks action (`OXYGEN_HIGH_FLOW` või `INTUBATION`);
2. säilitada sama HV progressioon ja ownership;
3. kontrollida event log'i ning topelt-replay'd;
4. käivitada vastav kanooniline HV P0 test.

HV-001 vertikaallõige on valmis; järgmine lõige saab sama protsessiruntime'i taaskasutada.
