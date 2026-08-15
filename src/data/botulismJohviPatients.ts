import type { Patient } from "@/models/Patient";

const patient = (
  id: string,
  isikukood: string,
  name: string,
  triage: Patient["triage"],
  location: string,
  lastSeen: string,
  mechanism: string,
  injuries: string,
  signs: string,
  treatment: string,
): Patient => ({ id, isikukood, name, triage, status: "Active", location, lastSeen, mist: { mechanism, injuries, signs, treatment } });

/** Current production Botulism/Jõhvi dataset. Clinical values mirror the historical 12-patient workbook. */
export const BOTULISM_JOHVI_PATIENTS: readonly Patient[] = Object.freeze([
  patient("P01", "37203140017", "Tarmo Lepp", "P3", "EMO triaaž", "08:25", "54-aastane mees; sümptomite algus 07:30. Sõi eelmisel õhtul Jõhvi restoranis; seost ei nimeta enne täpsustavat küsimust.", "Hägune nägemine, suukuivus ja kerge üldnõrkus.", "HR 82/min, RR 136/80 mmHg, HS 17/min, SpO₂ 98%, GCS 15.", "Ravi pole alustatud; jälgimine ja korduv hingamisfunktsiooni hindamine."),
  patient("P02", "45411020027", "Leida Saar", "P2", "EMO jälgimisala", "09:10", "71-aastane naine; sümptomite algus 08:00. Sõi Jõhvi restoranis koos sõbraga; restorani nimetab otsesel küsimisel.", "Düsfaagia, muutunud kõne ja suukuivus.", "HR 94/min, RR 148/84 mmHg, HS 21/min, SpO₂ 95%, GCS 15.", "Monitooring, veenitee ning valmisolek hingamistee toetuseks."),
  patient("P03", "37706210032", "Andres Kask", "P2", "EMO jälgimisala", "09:40", "49-aastane mees; sümptomite algus 08:15. Pere tähistas Jõhvi restoranis sünnipäeva; sõi sama rooga kui teised.", "Diploopia, ptoos ja neelamisraskus.", "HR 90/min, RR 134/82 mmHg, HS 20/min, SpO₂ 96%, GCS 15.", "Monitooring, veenitee ning hingamislihaste korduv hindamine."),
  patient("P04", "48004080041", "Kadri Kask", "P3", "EMO triaaž", "09:40", "46-aastane naine; sümptomite algus 08:45. Sõi Jõhvi restoranis väiksema portsjoni sama rooga.", "Suukuivus ja hägune nägemine; jõudlus veidi langenud.", "HR 78/min, RR 128/76 mmHg, HS 16/min, SpO₂ 99%, GCS 15.", "Jälgimine ja sümptomite dünaamika hindamine."),
  patient("P05", "60809170053", "Liisa Kask", "P3", "EMO triaaž", "09:40", "17-aastane naine; sümptomite algus 09:00. Maitses Jõhvi restoranis sama rooga väikese koguse.", "Nägemishäire ja halb enesetunne, neuroloogiline leid minimaalne.", "HR 86/min, RR 118/70 mmHg, HS 17/min, SpO₂ 98%, GCS 15.", "Jälgimine ja korduv neuroloogiline hindamine."),
  patient("P06", "51401250060", "Martin Kask", "P2", "EMO jälgimisala", "10:05", "12-aastane mees; sümptomite algus 09:30. Sõi Jõhvi restoranis perega sama rooga.", "Väsimus, suukuivus ja hägune nägemine; võimalik varajane bulbaarne haaratus.", "HR 96/min, RR 112/68 mmHg, HS 21/min, SpO₂ 96%, GCS 15.", "Monitooring, veenitee ja madal lävi eskaleerimiseks."),
  patient("P07", "38408300078", "Toomas Vaher", "P2", "EMO jälgimisala", "11:05", "41-aastane mees; sümptomite algus 09:30. Õhtustas Jõhvi restoranis kolleegidega; teab, et kolmas kolleeg on samuti haige.", "Düsartria, diploopia ja düsfaagia.", "HR 100/min, RR 138/80 mmHg, HS 22/min, SpO₂ 95%, GCS 15.", "Monitooring, veenitee ja hingamistee varajane planeerimine."),
  patient("P08", "48612120083", "Anneli Põld", "P3", "EMO triaaž", "11:05", "39-aastane naine; sümptomite algus 09:45. Sõi Jõhvi restoranis kolleegidega sama rooga.", "Kerge diploopia ja suukuivus.", "HR 84/min, RR 124/74 mmHg, HS 18/min, SpO₂ 98%, GCS 15.", "Jälgimine ning korduv hingamis- ja neelamisfunktsiooni hindamine."),
  patient("P09", "38205190097", "Raivo Mets", "P1", "EMO punane ala", "11:45", "44-aastane mees; sümptomite algus 10:45. Seos Jõhvi restorani ühise õhtusöögiga selgub kaaslaste info põhjal.", "Düspnoe, düsfaagia ja kiiresti süvenev lihasnõrkus.", "HR 112/min, RR 104/66 mmHg, HS 28/min, SpO₂ 90%, GCS 14.", "Kõrge vooluga hapnik, veenitee ning kohene ettevalmistus intubatsiooniks ja ventilatsiooniks."),
  patient("P10", "49807040108", "Laura Tamm", "P2", "EMO jälgimisala", "12:10", "28-aastane naine; sümptomite algus 10:00. Peatus kaaslasega Jõhvi restoranis ja sõi sama rooga.", "Düsartria, düsfaagia ja nägemishäire.", "HR 98/min, RR 126/76 mmHg, HS 22/min, SpO₂ 95%, GCS 15.", "Monitooring, veenitee ning hingamistee varajane planeerimine."),
  patient("P11", "39410230113", "Markus Tamm", "P1", "EMO punane ala", "12:35", "31-aastane mees; sümptomite algus 11:30. Sõi Jõhvi restoranis kaaslasega sama rooga.", "Progresseeruv üldnõrkus, düspnoe ja väljendunud bulbaarsed sümptomid.", "HR 108/min, RR 110/68 mmHg, HS 26/min, SpO₂ 91%, GCS 14.", "Hapnik, veenitee ning kohene ettevalmistus intubatsiooniks ja ventilatsiooniks."),
  patient("P12", "35202160120", "Heino Oja", "P1", "EMO punane ala", "13:00", "74-aastane mees; sümptomite algus 11:00. P02 sõber; ühine Jõhvi restorani söögikord selgub saatja ja P02 info põhjal.", "Hingamispuudulikkus, düsfaagia ja suur aspiratsioonirisk.", "HR 118/min, RR 98/60 mmHg, HS 30/min, SpO₂ 88%, GCS 13.", "Hapnik, aspiratsioonikaitse, veenitee ning kohene invasiivse ventilatsiooni valmisolek."),
].map((value) => Object.freeze({ ...value, mist: Object.freeze({ ...value.mist }) })));
