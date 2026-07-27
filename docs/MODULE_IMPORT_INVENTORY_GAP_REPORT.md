# Moodulipõhise impordi inventuur ja gap report

Kuupäev: 2026-07-27  
Ulatus: `RussiCaptor_Works_Implementation_Prompt.txt` kohustusliku tööjärjekorra punktid 1 (INVENTUUR) ja 2 (GAP REPORT).  
Seis: inventuur fikseerib enne 2026-07-27 importer foundation migratsiooni kehtinud lähteolukorra. Punktide 1–2 analüüsi ajal rakenduse koodi, Supabase skeemi ega aktiivseid õppuseandmeid ei muudetud.

## Kokkuvõttev otsus

Inventuuri alguses toetas RussiCaptor ühe fikseeritud formaadiga Exceli töövihiku paigaldamist rakenduse mällu ning kogu õppuse oleku sünkroniseerimist ühe Supabase JSONB-dokumendina. Manifestis kirjeldatud mooduliregistrit, sõltuvuste lahendamist, staging'ut, aatomilist aktiveerimist, sisuhäshi, impordijooksu ega versiooniviita ei olnud.

Olemasolevat arhitektuuri saab minimaalselt laiendada, kuid manifesti kogu püsivusleping ei mahu praegusesse Supabase skeemi ilma migratsioonita. Turvaline järgmine samm ei ole kogu kliinilise domeeni normaliseerimine, vaid väike impordi juhtkiht olemasoleva snapshot-mudeli ümber: impordijooksud, versioonitud moodulipayload'id ja õppuse aktiivse versiooni viit. Seda ei ole käesolevas töös rakendatud.

Manifest ise vajab enne rakendamist ühe vastuolu lahendamist: `Validation` leht kuvab kolm FATAL tulemust `FAIL` (`VAL-02`, `VAL-05`, `VAL-09`), kuigi registri- ja binding-lehed kirjeldavad viit laaditavat moodulit ja kümmet vajalikku sõltuvust. Importer peab kas arvutama need kontrollid ise või töövihik tuleb salvestada korrektsete arvutatud väärtustega; FATAL kontrolli ei tohi ignoreerida.

## 1. Inventuur

### 1.1 Olemasolev import

- `src/services/WorkbookImportService.ts` loeb töövihiku failist ja paigaldab tulemuse otse in-memory provider'itesse. Paigaldus peatab kella ning nullib sessiooni, assignment'id, timeline'i, CM asukohad ja aktiivse CM-i.
- `src/providers/excel/WorkbookFileParser.ts` tunneb täpselt 12 legacy-lehte: `Patients`, `Locations`, `InterventionOptions`, `Interventions`, `MedicationOptions`, `MedicationAdministrations`, `Vitals`, `Questions`, `Labs`, `Imaging`, `Notes`, `Orders`. Kõik on kohustuslikud.
- `src/providers/excel/WorkbookDataMapper.ts` teisendab need lehed praegusteks patsiendi-, kliiniliste andmete ja lokatsiooniobjektideks.
- Import ei loe manifesti `ModuleRegistry`, `DependencyEdges`, `SheetImportRules`, `ImportUnits`, `OwnershipMap`, `DuplicatePolicies` ega `DeprecatedInputs` lehti.
- Import toimub kohe aktiivsesse rakenduse olekusse. Staging'ut, transaktsioonilist commit'i, ImportRunID-d, rollback'i, content hash'i ega idempotentset mooduliversiooni kontrolli ei ole.

### 1.2 Püsivus ja remote sync

- `src/services/StatePersistenceService.ts` salvestab lokaalselt ühe versiooniga JSON-snapshot'i (`russicaptor-state.json`). Jagatud olekus on sessioon, patsiendid, assignment'id/üleandmised, kliinilised kirjed, sündmused, sekkumised, ravimid, elulised näitajad, CM asukohad ja paigaldatud legacy-töövihik.
- `src/services/CloudSyncService.ts` loeb ja kirjutab kogu `SharedExerciseState` objekti ühe Supabase reana. Konfliktikontroll põhineb kliendi suurendatud `revision` väärtusel ja `updated_at` ajatemplil; DB-poolset compare-and-swap kontrolli ei ole.
- Realtime kuulab kogu `exercise_states` tabelit. Eraldi protsessi-, ownership'i-, sündmuse- ega ressursivoogu ei ole.

### 1.3 Inventuuri hetkel kehtinud Supabase skeem

Kontrollitud 2026-07-27 otse projektist `fimcsrivizpliiuoqopv` read-only SQL päringuga.

| Objekt | Tegelik seis |
|---|---|
| Tabelid | Ainult `public.exercise_states` |
| Veerud | `exercise_id text NOT NULL`, `revision bigint NOT NULL DEFAULT 1`, `state jsonb NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by uuid NOT NULL` |
| Primary key | `exercise_states_pkey (exercise_id)` |
| Foreign key | `updated_by -> auth.users(id)` |
| Indexid | Ainult primary key unikaalindeks |
| RLS | Lubatud autentitud kasutajate SELECT; INSERT/UPDATE kontrollib ainult `updated_by = auth.uid()` |
| Triggerid | Puuduvad |
| Public funktsioonid | Puuduvad |
| Public enum'id | Puuduvad |
| Realtime | `exercise_states` on `supabase_realtime` publikatsioonis |
| Migratsioonid repos | Puuduvad; olemas ainult `supabase/schema.sql` |

Paigaldatud laiendused: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`.

### 1.4 Nõutud domeeniobjektide tegelik rakendus

| Nõutud objekt/võimekus | Tegelik repo/Supabase vaste | Hinnang |
|---|---|---|
| PatientProcess | Eraldi mudel, repository ja DB-objekt puuduvad | Puudub |
| RuntimeState | Ainult kogu õppuse `SharedExerciseState` JSON-snapshot; spetsifikatsiooni protsessipõhist runtime state'i pole | Osaline, semantiliselt ebapiisav |
| Event | `ScenarioEvent` ja `TimelineEvent` rakenduses, snapshot'i sees | Osaline; immutable/event-log garantii puudub |
| ActiveEffect | Eraldi objekt puudub | Puudub |
| Exercise | Rakenduses exercise/session objekt; Supabases ainult `exercise_id` snapshot'i võtmena | Osaline |
| Resource | Manifesti ressursimudel puudub; olemasolevad order'id/ravimid pole sama leping | Puudub |
| Ownership/handover | `AssignmentRepository` hoiab assignment'e ja transfer'e snapshot'is | Osaline; ownershipVersion/CAS puudub |
| Replay | Deterministlik event replay, seed ja state hash puuduvad | Puudub |
| Mooduliregister | Puudub | Puudub |
| ImportRunID | Puudub | Puudub |
| Staging | Puudub | Puudub |
| Version pointer | Puudub | Puudub |
| Content hash | Puudub | Puudub |
| Rollback | Puudub; legacy install kirjutab kohe aktiivsesse mällu | Puudub |
| State hash | Puudub | Puudub |
| Deterministic seed | Puudub | Puudub |

### 1.5 Failipaki inventuur

Manifest registreerib kuus moodulit. Botulismiõppuse laadimisjada on `CORE_ENGINE -> HYPOXIA_V1 -> HYPOVENTILATION_HYPERCAPNIA_V1 -> BOTULISM_V1 -> BOTULISM_EXERCISE_V1_4`. `HEMORRHAGE_V1` peab olema registreeritud, kuid `LoadForExercise=FALSE` tõttu selle õppuse runtime'ist välja jääma.

Õppuse töövihik kirjeldab 12 patsienti ja 60 PatientProcess assignment'i. Failipakis on lisaks arhitektuuri-, PatientProcess-, RuntimeState-, UI-integratsiooni-, PT-001 tööpaketi ja WP01 inventuuri töövihikud. Need on dokumentatsioon või tööpaketid, mitte automaatselt runtime-andmed. Golden test pack sisaldab 50 testi (`TestCatalog` andmeread), 176 assertion'it (`Assertions` andmeread) ning fixture/event/expected-state lepinguid; runner'it praeguses repos ei ole.

## 2. Gap report

### 2.1 Manifesti objektide vastavus

| Manifesti objekt | Olemasolev vaste | Olemasolev võimekus | Puuduv võimekus | Minimaalne järgmine muudatus | Migratsioon? |
|---|---|---|---|---|---|
| `ModuleRegistry` | Puudub | Legacy `installedWorkbook` mäletab ühe faili nime ja sisu | ModuleID, versioon, tüüp, aktiivsus, hash, staatus | Versioonitud moodulikirje + canonical payload/hash | Jah |
| `DependencyEdges` | Puudub | Ei ole | Topoloogiline järjestus, required/optional kontroll, tsüklituvastus | Manifesti valideerija importeri teenuses | Ei, kui tulemus talletatakse moodulikirjes |
| `SheetImportRules` | Fikseeritud `workbookSheetNames` | Legacy 12 lehe whitelist | Manifestipõhine klassifikatsioon ja runtime'i välistused | Uus manifestiparser; legacy parser jääb eraldi | Ei |
| `ImportUnits` | Puudub | Ei ole | Reapõhine source/target mapping, võtmed, load flag | Canonical payload'i mapperid lubatud lehtedele | Tõenäoliselt mitte esimeses etapis |
| `LoadPlan` | Puudub | Üks otsene install | Precheck, staging, dry run, atomic commit, postcheck | Impordijooksu state machine | Jah |
| `OwnershipMap` | Assignment/handover teenus | CM assignment ja transfer säilivad snapshot'is | Väljade/protsesside canonical owner, ownershipVersion, konfliktikontroll | Import-time ownership validation; runtime version hiljem | Püsiva runtime lepingu jaoks jah |
| `DuplicatePolicies` | Mõned mapperi unikaalsuskontrollid | Legacy PatientId jms valideerimine | ModuleID/version/hash, namespace'id, EventID ja child-process idempotentsus | Keskne canonical ID registry + hash check | Jah püsiva idempotentsuse jaoks |
| `DeprecatedInputs` | Puudub | Ei ole | Keelatud failide, moodulite, trigger'ite ja viidete FATAL kontroll | Precheck manifesti põhjal | Ei |
| `ExerciseBinding` | `exerciseId` snapshot'is | Üks aktiivne snapshot exercise ID kohta | Mooduliversioonide sidumine, EXCLUDED staatus | Aktiivse exercise-version viit + bindingud | Jah |
| `Validation` | Praeguse parseri vealoend | Legacy sheet/header/value kontroll | Manifesti FATAL/WARNING kontrollid ja arvutatud valemite usaldusväärne tulemus | Käivitatav validator, mis ei sõltu Exceli cached formula väärtusest | Ei |

### 2.2 Peamised riskid ja vastuolud

1. **Aktiivse oleku ülekirjutamine.** Legacy importer mutatsioonib aktiivset in-memory olekut enne tervikliku paketi kontrollimist. Failed mooduliimport ei saaks praegu eelmist õppust muutumatuna hoida.
2. **Üks JSONB-rida ei anna impordi aatomilisust moodulitasemel.** Snapshot'i upsert on ühe rea mõttes aatomiline, kuid selles pole staged/active versioone, impordijooksu auditit ega rollback'i ulatust.
3. **Samaaegse kirjutamise kaotuse oht.** `revision = latestRevision + 1` arvutatakse kliendis ja upsert'il puudub DB-poolne expected-revision tingimus.
4. **Domeenileping puudub.** PatientProcess, ActiveEffect, Resource, ownershipVersion, state hash ja replay seed pole tüübi- ega püsivuskihis esindatud.
5. **Exceli lepingud on legacy-parseriga kokkusobimatud.** Uued töövihikud ei sisalda praeguse importeri 12 kohustuslikku lehte ja neid ei tohi suunata olemasolevasse mapperisse.
6. **Manifesti FATAL kontrollid on vastuolulises olekus.** `VAL-02`, `VAL-05` ja `VAL-09` annavad failis `FAIL`; nende ignoreerimine rikuks manifesti enda failure policy't.
7. **RLS on õppusepõhiseks piiramiseks liiga lai.** Kõik authenticated kasutajad saavad kõiki `exercise_states` ridu lugeda ja uuendada; `updated_by` kontroll ei tõenda õppuse liikmelisust ega ownership'i.
8. **Golden runneril puudub käivitatav alus.** Praegune testipinu on olemasoleva rakenduskoodi jaoks, kuid Exceli TestCatalog/Assertions semantikat, replay'd ja state hash'i ei rakendata.

### 2.3 Nõuded, mis ei mahu praegusesse skeemi ilma migratsioonita

- Püsiv `ImportRunID` koos staatuse, vea, ajatempli ja rollback-ulatusena.
- Sama ModuleID + version + content hash idempotentne no-op ning sama versiooni erineva sisu FATAL konflikt.
- Staged ja active mooduliversioonid ning õppuse aatomiline active-version pointer.
- Eelmise aktiivse õppuseversiooni säilitamine failed impordi korral koos auditeeritava importiajalooga.
- Püsiv ownershipVersion/CAS, kui seda peab kontrollima server, mitte ainult klient.
- Normaliseeritud või eraldi auditeeritav PatientProcess/Event/Resource mudel, kui golden test peab neid pärima sõltumatult tervest snapshot'ist.

`DependencyEdges`, `SheetImportRules`, `DeprecatedInputs` ja enamik failisiseseid FATAL kontrolle saab rakendada kliendi/importeri valideerijana ilma DB-migratsioonita. Nende tulemus ei anna siiski üksinda nõutud aatomilist aktiveerimist ega serveripoolset idempotentsust.

### 2.4 Minimaalne kavand järgmise etapi jaoks (ei ole rakendatud)

1. Hoida olemasolev `exercise_states` runtime sync muutmata.
2. Lisada migratsiooniga kolm väikest juhtobjekti: `import_runs`, `module_versions` (canonical JSONB payload + content hash) ja `exercise_versions`/binding koos ühe aktiivse versiooni viidaga.
3. Ehitada olemasoleva `WorkbookImportService` kõrvale eraldi manifestipõhine parser, mitte muuta legacy 12-lehe parserit uute töövihikute jaoks.
4. Valideerida kogu pakett mälus/staging'us; aktiveerida viit alles pärast kõigi FATAL kontrollide ja deterministic dry-run'i läbimist.
5. Genereerida aktiivsest versioonitud payload'ist senine `SharedExerciseState`, et praegune UI ja remote sync ei vajaks esimeses etapis ümbertegemist.

See on väikseim tee, mis säilitab olemasoleva arhitektuuri ja loob manifesti jaoks turvalise aktiveerimispiiri. PatientProcess'i, ActiveEffect'i ja Resource'i täielik normaliseerimine tuleks otsustada eraldi pärast importerilepingu vertikaalse lõike tõestamist.

## Kontrollitud allikad

- `RussiCaptor_Module_Import_Manifest_v1.xlsx`: `ModuleRegistry`, `DependencyEdges`, `SheetImportRules`, `ImportUnits`, `LoadPlan`, `OwnershipMap`, `DuplicatePolicies`, `DeprecatedInputs`, `ExerciseBinding`, `Validation`.
- `RussiCaptor_Golden_Test_Pack_v1.xlsx`: kõik lehed, eraldi `TestCatalog`, `Assertions`, expected-state/event/process-tree ja `AutomationContract`.
- Kõik viis mooduli/õppuse konfiguratsioonitöövihikut ning kuus spetsifikatsiooni/tööpaketi töövihikut.
- Repo `ARCHITECTURE.md`, `PROJECT_CONTEXT.md`, importeri-, mapperi-, persistence-, sync-, assignment- ja mudelikood.
- Repo `supabase/schema.sql` ning Supabase projekti tegelik public-skeem.

## Käesoleva töö piir

- Ei loodud ega käivitatud migratsioone.
- Ei muudetud Supabase andmeid, RLS-i ega realtime-seadeid.
- Ei muudetud rakenduse koodi ega töövihikuid.
- Ei rakendatud prompti punkte 3–11.

## Järeltegevus 2026-07-27: importer foundation

Pärast gap report'i kinnitamist lisati ja rakendati `supabase/migrations/202607270001_module_import_foundation.sql`. Migratsioon lisab viis tühja juhtkihtide tabelit (`import_runs`, `module_versions`, `import_run_modules`, `exercise_versions`, `exercise_module_bindings`), vajalikud piirangud, indeksid ja RLS policy'd ning neli kontrollitud RPC-funktsiooni:

- `register_module_version` — sama ModuleID/version/hash on idempotentne, erinev hash on FATAL konflikt;
- `stage_import_run` — viib omaniku PREPARING impordijooksu STAGED olekusse;
- `activate_exercise_import` — kontrollib required bindinguid ja vahetab aktiivse õppuseversiooni ühe transaktsiooniga;
- `fail_import_run` — lõpetab sama omaniku poolelioleva jooksu FAILED olekus.

Olemasolevat `exercise_states` tabelit, runtime sync'i ja aktiivseid õppuseandmeid ei muudetud. Transaktsiooniline suitsutest on `supabase/tests/module_import_foundation_test.sql`; test lõpetab `ROLLBACK`-iga.

## Järeltegevus 2026-07-27: manifestipõhine importer

Prompti punkt 3 rakendati eraldi `ModuleImportService` ja `ModuleManifestParser` kihina, jättes legacy 12-lehe importeri puutumata. EXCON saab valida korraga manifesti ja selle kuus pakifaili. Importer:

- loeb kanoonilisi manifestilehti ja impordib payload'i ainult `RUNTIME_CONFIG`/`EXERCISE_DATA` lehtedelt;
- kontrollib sõltuvusjärjekorda, required lehti, import unit'e, ownership-konflikte, deprecated sisendeid, unikaalseid põhi-ID-sid, õppuse 12/60/5 loendusi ning keelatud viiteid;
- arvutab iga failisisu SHA-256 hash'i;
- jätab `HEMORRHAGE_V1` runtime'i välja, kuid registreerib mooduli;
- kasutab Supabase staging- ja RPC-kihti ning aktiveerib versiooni alles pärast FATAL kontrollide läbimist;
- eemaldab failed jooksu staging-kirjed, säilitades failed `import_runs` auditirea;
- tagastab sama aktiivse versiooni ja hash'i kordusimpordil no-op tulemuse.

Androidi emulaatoris imporditi kuuest töövihikust `BOT-FOODBORNE-2026-01` v1.4. Supabase kontroll näitas kuut registreeritud moodulit, viit laaditud moodulit, üht excluded moodulit, üht aktiivset õppuseversiooni ja `HEMORRHAGE_V1` EXCLUDED binding'ut. Sama paketi kordusimport ei loonud uut impordijooksu ega muutnud aktiivset versiooni.
