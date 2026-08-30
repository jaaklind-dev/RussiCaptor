import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gradlePath = path.join(root, "android/app/build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
const versionName = process.env.RUSSICAPTOR_VERSION_NAME;
const versionCode = process.env.RUSSICAPTOR_VERSION_CODE;
if (!versionName || !/^\d+$/.test(versionCode ?? "")) throw new Error("Release version metadata is required.");

for (const name of [
  "RUSSICAPTOR_RELEASE_KEYSTORE",
  "RUSSICAPTOR_RELEASE_STORE_PASSWORD",
  "RUSSICAPTOR_RELEASE_KEY_ALIAS",
  "RUSSICAPTOR_RELEASE_KEY_PASSWORD",
]) {
  if (!process.env[name]) throw new Error(`${name} is required; release signing has no debug fallback.`);
}

const signingMarker = "    signingConfigs {\n        debug {";
if (!gradle.includes(signingMarker)) throw new Error("Generated Android signing block was not recognized.");
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);
gradle = gradle.replace(signingMarker, `    def releaseStoreFile = System.getenv("RUSSICAPTOR_RELEASE_KEYSTORE")
    def releaseStorePassword = System.getenv("RUSSICAPTOR_RELEASE_STORE_PASSWORD")
    def releaseKeyAlias = System.getenv("RUSSICAPTOR_RELEASE_KEY_ALIAS")
    def releaseKeyPassword = System.getenv("RUSSICAPTOR_RELEASE_KEY_PASSWORD")
    signingConfigs {
        debug {`);

const signingEnd = "        }\n    }\n    buildTypes {";
if (!gradle.includes(signingEnd)) throw new Error("Generated Android signing block end was not recognized.");
gradle = gradle.replace(signingEnd, `        }
        release {
            storeFile file(releaseStoreFile)
            storePassword releaseStorePassword
            keyAlias releaseKeyAlias
            keyPassword releaseKeyPassword
        }
    }
    buildTypes {`);

const buildTypesOffset = gradle.indexOf("    buildTypes {");
if (buildTypesOffset < 0) throw new Error("Generated Android buildTypes block was not recognized.");
const beforeBuildTypes = gradle.slice(0, buildTypesOffset);
let buildTypes = gradle.slice(buildTypesOffset);
const releaseOffset = buildTypes.indexOf("        release {");
if (releaseOffset < 0) throw new Error("Generated Android release build type was not recognized.");
const releaseBuild = buildTypes.slice(releaseOffset);
if (!releaseBuild.includes("signingConfig signingConfigs.debug")) throw new Error("Generated release debug-signing line was not recognized.");
buildTypes = buildTypes.slice(0, releaseOffset) + releaseBuild.replace(
  "signingConfig signingConfigs.debug",
  "signingConfig signingConfigs.release",
);
gradle = beforeBuildTypes + buildTypes;
if (!gradle.includes("debug {\n            signingConfig signingConfigs.debug")) throw new Error("Debug build signing was unexpectedly changed.");
if (!gradle.includes("signingConfig signingConfigs.release")) throw new Error("Release build does not use the production signing config.");
fs.writeFileSync(gradlePath, gradle);
console.log("FIELD_RELEASE_NATIVE_CONFIGURED");
