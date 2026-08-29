export type ReleaseEnvironment = "development" | "production";

export type BuildProvenance = Readonly<{
  environment: ReleaseEnvironment;
  gitSha: string;
  buildTimestamp: string;
  versionCode: string;
  supabaseProjectRef?: string;
}>;

export type ReleasePublicEnvironment = Readonly<{
  releaseEnvironment?: string;
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  gitSha?: string;
  buildTimestamp?: string;
  versionCode?: string;
}>;

function publicReleaseEnvironment(): ReleasePublicEnvironment {
  return {
    releaseEnvironment: process.env.EXPO_PUBLIC_RELEASE_ENVIRONMENT,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    gitSha: process.env.EXPO_PUBLIC_BUILD_GIT_SHA,
    buildTimestamp: process.env.EXPO_PUBLIC_BUILD_TIMESTAMP,
    versionCode: process.env.EXPO_PUBLIC_ANDROID_VERSION_CODE,
  };
}

function projectRef(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(url.trim())?.[1];
}

export function getReleaseConfigurationError(environment: ReleasePublicEnvironment = publicReleaseEnvironment()): string | undefined {
  if (environment.releaseEnvironment !== "production") return undefined;
  const url = environment.supabaseUrl;
  const key = environment.supabasePublishableKey;
  if (!projectRef(url)) return "Release-buildi Supabase'i aadress puudub või ei ole tootmisaadress.";
  if (!key || (!key.startsWith("sb_publishable_") && !key.startsWith("eyJ"))) return "Release-buildi Supabase'i avalik võti puudub või on vigane.";
  if (!environment.gitSha?.match(/^[0-9a-f]{40}$/)) return "Release-buildi Git SHA puudub.";
  if (!environment.buildTimestamp) return "Release-buildi ajatempel puudub.";
  if (!environment.versionCode?.match(/^[1-9][0-9]*$/)) return "Release-buildi versionCode puudub.";
  return undefined;
}

export function getBuildProvenance(environment: ReleasePublicEnvironment = publicReleaseEnvironment()): BuildProvenance {
  return Object.freeze({
    environment: environment.releaseEnvironment === "production" ? "production" : "development",
    gitSha: environment.gitSha ?? "development",
    buildTimestamp: environment.buildTimestamp ?? "development",
    versionCode: environment.versionCode ?? "development",
    supabaseProjectRef: projectRef(environment.supabaseUrl),
  });
}
