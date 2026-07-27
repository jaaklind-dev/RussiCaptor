# Golden engine adapter mapping

`GoldenEngineAdapter` on WP-4B runneri ja käivitatava patsiendimootori vaheline piir.
Adapter ei sisalda kliinilist loogikat ega golden-väärtusi. Mootor loob fixture'ist puhta
oleku, rakendab sündmused ning tagastab checkpoint'i semantilise oleku.

## Engine harness

Mootor peab rakendama `GoldenEngineHarness` liidese:

- `reset(fixture)` — loob puhta oleku ja rakendab fixture'i seed'i;
- `advanceTo(simulationTimeSec)` — liigub absoluutse simulatsiooniajani;
- `dispatch(event)` — rakendab välise EventID-ga sündmuse;
- `checkpoint(time)` — tagastab oleku ja protsessipuu;
- `readEvents()` — tagastab genereeritud sündmused semantilises järjekorras;
- `readHashes()` — tagastab state-, event-log- ja process-tree hash'id.

Runner kutsub `reset` iga käivituse, sealhulgas deterministliku kordusreplay eel.
Seinakella ega production-andmeid adapter ei kasuta.

## Assertion query mapping

| Golden query | Checkpoint state kuju |
|---|---|
| `PT-001::Resp::RR` | `state.entities["PT-001"].Resp.RR` |
| `PT-001::Resource::RES-ATX.available` | `state.entities["PT-001"].Resource["RES-ATX"].available` |
| `*::HV::co2Burden` | `state.HV.co2Burden` või `state.global.HV.co2Burden` |
| `exercise.patientCount` | `state.exercise.patientCount` |
| `activeModules[module=BOTULISM_V1]` | filtreeritav `state.activeModules` massiiv |
| `children[HV_NM_SEV]` | `state.children.HV_NM_SEV` või semantiline massiiv |
| `events[...]` | `readEvents()`; lahendab runner |
| `processTree[...]` | checkpoint'i `processTree`; lahendab runner |

Mootor võib anda erandliku või tuletatud väärtuse `checkpoint.values[query]` kaudu.
See on ette nähtud hash'ide, agregaatide ja importeri auditväärtuste jaoks, mida pole
mõistlik üldisest olekupuust tuletada.

Sama query eri checkpoint'ides säilitatakse eraldi. Puuduv kohustuslik mapping peatab
testi veaga `ENGINE_ADAPTER_MAPPING_MISSING`, mistõttu tulemus on `BLOCKED`, mitte
eksitav kliiniline `FAIL`.

## Repo praegune võimekus

Repo sisaldab runneri adapterit ja harness-lepingut. Praegune `ScenarioEngine` käivitab
ainult demo töövoosündmusi ega halda veel järgmisi WP-4B olekuid:

- PatientProcess puu ja child-trigger'id;
- HV/Hypoxia/Botulism protsesside progressioon;
- fixture seed'iga replay-olek;
- transaktsiooniline ResourcePool;
- engine'i event log ja semantilised hash'id;
- importeri failure-injection fixture'id.

Need võimed tuleb ühendada või rakendada harness'i taga. Golden runnerit ega assertion'i
mappingut selleks muuta ei ole vaja.
