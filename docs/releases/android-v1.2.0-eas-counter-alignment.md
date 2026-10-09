# Android 1.2.0 — EAS Androidi versiooniloenduri joondamine

2026-10-09 joondati EAS-i projekti `@jaaklind/RussiCaptor` (`a98b2049-58ed-42ad-97f2-6138197a3120`) Androidi kaugversioon. Rakenduse ID on `com.jaaklind.RussiCaptor`.

| Olek | Androidi kaugne `versionCode` |
| --- | ---: |
| Enne muudatust, EAS-ist loetud | 1 |
| Toetatud `eas build:version:set --platform android --profile production` järel EAS-ist uuesti loetud | 151 |

Avaldatud ja füüsiliselt valideeritud Android 1.2.0 APK `versionCode` on **151**. `eas.json` määrab `cli.appVersionSource` väärtuseks `remote` ning tootmisprofiilis `autoIncrement: true`. [Expo versioonihalduse dokumentatsiooni](https://docs.expo.dev/build-reference/app-versions/) järgi talletatakse kaugolekus viimati kasutatud kood ja järgmine automaatselt suurendatud tootmisversioon saab seega **152**. Eraldi kuiva EAS-i ehitusresolutsiooni ei käivitatud; järeldus tugineb serverist tagasiloetud väärtusele ja dokumenteeritud suurendamisreeglile.

iOS-i kaugolek oli nii enne kui ka pärast muudatust `{}`. Kohalik `app.json` jäi versioonile `1.2.0` / koodile `151`; avaldatud APK-d, valideeritud tag'i ja tõenduscommitti ei muudetud. Pilvehitust, APK/AAB ehitust ega uut väljalaset ei loodud.

Ära vähenda ega lähtesta EAS-i Androidi kaugloendurit. Enne järgmist EAS-i pilvehitust kontrolli kaugolekut uuesti, eriti kui vahepeal on tekkinud mõni kõrgema koodiga levitatud ehitus.
