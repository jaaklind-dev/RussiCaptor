# RussiCaptor coverage report

Raporti kuupäev: 2026-07-27  
Baaskommit: `53b4014`  
Fookus: WP-3 import, WP-3B runtime aggregation, WP-4B Golden runner ja engine adapter mapping.

## Kokkuvõte

| Mõõdik | Tulemus |
|---|---:|
| Testipakid | 15 / 15 PASS |
| Automaattestid | 92 / 92 PASS |
| Kogu `src` statement coverage | 62.94% (2037 / 3236) |
| Kogu `src` branch coverage | 53.50% (1145 / 2140) |
| Kogu `src` function coverage | 60.86% (608 / 999) |
| Kogu `src` line coverage | 63.82% (1851 / 2900) |
| 0% line coverage failid | 50 |

Coverage mõõdeti käsuga, mis kaasab kõik `src/**/*.{ts,tsx}` failid. Seetõttu sisaldab
tulemus ka ekraane ja UI-komponente, mida tavapärane Jest run ei lae. Ainult testide
käigus laaditud failide statement coverage oleks 76.57%, kuid see pole kogu repo kate.

## Golden Pack coverage

| Kiht | Kaetud | Staatus |
|---|---:|---|
| Workbooki leping | 50 / 50 testi | PASS – päris workbook laaditi |
| Assertion'ite leping | 176 / 176 | PASS – ID-d, testiviited ja comparator'id valideeriti |
| P0 assertion'id | 148 | 25 PASS; ülejäänud ootavad järgmisi engine'i lõikeid |
| P1 assertion'id | 28 | Runneris toetatud, päris engine'i vastu käivitamata |
| Comparator'id | 176 / 176 | EQ, NEAR, COUNT_EQ, SET_EQ, LIST_EQ ja IN toetatud |
| Expected process tree read | 16 / 16 rida | PASS |
| Tegelik kliiniline Golden execution | 25 / 176 | Kõik 7 HV P0 testi PASS |

## HV P0 staatus – WP-6

| HV P0 test | Staatus | Märkus |
|---|---|---|
| HV-001 | PASS | Ravimata 1 min: reserve 48.2, CO₂ 42.0 |
| HV-002 | PASS | Hapnik ei muuda HV reserve'i ega CO₂ progressiooni |
| HV-003 | PASS | Intubatsioon kaitseb hingamisteed, ventilatsiooniefekt puudub |
| HV-004 | PASS | BVM: reserve 53.62, CO₂ 34.4 |
| HV-005 | PASS | Mehaaniline ventilatsioon: reserve 54.0, CO₂ 33.5, protsess Controlled |
| HV-007 | PASS | CO₂ narkoos tekib 60 s lävel korrektse HV omistusega |
| HV-008 | PASS | Respiratoorne seiskus puudub 59 s ja tekib 60 s lävel |

HV-006 on P1 test ja ei kuulu WP-6 HV P0 komplekti. BLOCKED HV P0 teste ei ole.

## WP-7 HV + Hypoxia integreeritud runtime

| Testigrupp | PASS | BLOCKED | Märkus |
|---|---:|---:|---|
| HV P0 | 7 | 0 | Kõik WP-6 testid jäid PASS-i |
| HV P1 | 1 | 0 | HV-006 oxygen masking PASS |
| Hypoxia P0 | 0 | 0 | Golden Packis pole eraldiseisvaid Hypoxia teste |
| HV + Hypoxia | 2 | 0 | XMOD-001 ja XMOD-002 PASS |
| Botulismist sõltuvad XMOD testid | 0 | 4 | XMOD-003…006 vajavad Botulism PatientProcess runtime'i |

WP-7 päris Golden run: 10 PASS ja 4 põhjendatud BLOCKED. XMOD-003 ja XMOD-004
kasutavad `FX-PT007` Botulismi juurprotsessi; XMOD-005 kasutab Botulismi/patsiendi
koondfixture'it `FX-PT001-60`, kus HV bootstrapile vajalikud väljad ei asu juurtasemel;
XMOD-006 kasutab `FX-PT009` Botulismi juurprotsessi. Nende realiseerimine tähendaks
Botulism PatientProcess runtime'i lisamist ja jääb WP-7 HV + Hypoxia ulatusest välja.

Mitme protsessi runtime käivitab HV ja Hypoxia protsessid deterministlikus järjekorras,
aggregeerib nende väljundid ühe pipeline'i kutsega ning hoiab protsesside elapsedTime'i,
outputs'i, instanceKey'd ja sündmuste omistuse eraldi. SpO₂ tuleb ainult Hypoxia
protsessilt; ventilatsioon, CO₂ ja CO₂ trend jäävad HV omandisse. Kordusreplay annab
identse RuntimeState'i, PatientProcess-loendi, process tree, event log'i ja hashid.

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
simulatsioon on päriselt läbinud kõik 25 HV P0 assertion'it; ülejäänud protsessi-,
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
- Golden clinical coverage: kõik HV P0 testid läbivad; järgmised P0 rühmad vajavad
  Botulism/Hypoxia/PatientProcess/resource vertikaallõikeid.

## Järgmine minimaalne samm

Laiendada olemasolevat `GoldenEngineHarness` vertikaallõiget järgmisele P0 rühmale:

1. lisada minimaalne Botulism PatientProcess bootstrap `FX-PT007`, `FX-PT001-60` ja
   `FX-PT009` fixture-kujude jaoks;
2. juhtida Botulismi parent-protsessist olemasolevaid HV ja Hypoxia lapsprotsesse;
3. käivitada XMOD-003…006 sama deterministliku pipeline'i ja replay kontrolliga.

HV ja Hypoxia integreeritud lõige on valmis; järgmine piir on Botulismi juurprotsess.

## WP-8 minimaalne Botulism Root runtime

| XMOD test | Staatus | Märkus |
|---|---|---|
| XMOD-001 | PASS | HV käivitab ühe Hypoxia child'i |
| XMOD-002 | PASS | Korduv hindamine ei dubleeri child'i |
| XMOD-003 | PASS | Botulism respiratory → HV → Hypoxia; SpO₂ owner on Hypoxia |
| XMOD-004 | PASS | Ventilatsioon kontrollib HV-d, Botulismi cranial/motor jäävad aktiivseks |
| XMOD-005 | PASS | Teadvusseisundi langus omistatakse HV moodulile |
| XMOD-006 | PASS | Aspiratsioon loob HYP_ASP_MOD child'i ja jätab 5 Botulismi protsessi aktiivseks |

Kõik kuus XMOD testi ning nende 24 assertion'it läbivad päris Golden Packi vastu.
BLOCKED teste ei ole. Botulism Root bootstrap loeb protsessid fixture'i
`processAssignments` või `botulismProcesses` loendist, säilitab parent-child seosed ja
orkestreerib ainult Golden testides vajalikud HV ning Hypoxia child'id. Root'i enda
`runtimeContributions` on tühi: kliinilised muudatused lähevad jätkuvalt child output'ide,
OwnershipResolver'i ja RuntimeAggregationPipeline'i kaudu.
