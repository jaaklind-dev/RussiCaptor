import { getBuildProvenance, getReleaseConfigurationError } from "../ReleaseConfig";

describe("WP-NEXT-04 release configuration", () => {
  test("production configuration is fail-closed when provenance is missing", () => {
    expect(getReleaseConfigurationError({
      releaseEnvironment: "production", supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_example",
    })).toBe("Release-buildi Git SHA puudub.");
  });

  test("accepts a complete production configuration and exposes only safe provenance", () => {
    const environment = {
      releaseEnvironment: "production", supabaseUrl: "https://fimcsrivizpliiuoqopv.supabase.co",
      supabasePublishableKey: "sb_publishable_example", gitSha: "a".repeat(40),
      buildTimestamp: "2026-08-29T12:00:00.000Z", versionCode: "2",
    };
    expect(getReleaseConfigurationError(environment)).toBeUndefined();
    expect(getBuildProvenance(environment)).toEqual({
      environment: "production", gitSha: "a".repeat(40), buildTimestamp: "2026-08-29T12:00:00.000Z",
      versionCode: "2", supabaseProjectRef: "fimcsrivizpliiuoqopv",
    });
  });

  test("rejects local URLs and privileged keys", () => {
    expect(getReleaseConfigurationError({
      releaseEnvironment: "production", supabaseUrl: "http://127.0.0.1:54321",
      supabasePublishableKey: "sb_secret_forbidden",
    })).toMatch(/tootmisaadress/);
  });
});
