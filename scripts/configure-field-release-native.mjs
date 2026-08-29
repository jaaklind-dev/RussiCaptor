import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gradlePath = path.join(root, "android/app/build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");

const signingMarker = "    signingConfigs {\n        debug {";
if (!gradle.includes(signingMarker)) throw new Error("Generated Android signing block was not recognized.");
gradle = gradle.replace(signingMarker, `    def releaseStoreFile = System.getenv("RUSSICAPTOR_RELEASE_KEYSTORE")
    def releaseStorePassword = System.getenv("RUSSICAPTOR_RELEASE_STORE_PASSWORD")
    def releaseKeyAlias = System.getenv("RUSSICAPTOR_RELEASE_KEY_ALIAS")
    def releaseKeyPassword = System.getenv("RUSSICAPTOR_RELEASE_KEY_PASSWORD")
    def releaseSigningConfigured = [releaseStoreFile, releaseStorePassword, releaseKeyAlias, releaseKeyPassword].every { it }
    signingConfigs {
        debug {`);

const signingEnd = "        }\n    }\n    buildTypes {";
if (!gradle.includes(signingEnd)) throw new Error("Generated Android signing block end was not recognized.");
gradle = gradle.replace(signingEnd, `        }
        if (releaseSigningConfigured) {
            release {
                storeFile file(releaseStoreFile)
                storePassword releaseStorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            }
        }
    }
    buildTypes {`);

if (!gradle.includes("signingConfig signingConfigs.debug")) throw new Error("Generated release signing line was not recognized.");
gradle = gradle.replace(
  "signingConfig signingConfigs.debug",
  "signingConfig releaseSigningConfigured ? signingConfigs.release : null",
);
fs.writeFileSync(gradlePath, gradle);
console.log("FIELD_RELEASE_NATIVE_CONFIGURED");
