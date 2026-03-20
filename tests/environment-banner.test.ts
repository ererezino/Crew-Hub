import { describe, expect, it } from "vitest";

import {
  isNonProductionSupabaseUrl,
  resolveEnvironmentBannerLabel
} from "../components/shared/environment-banner";

describe("environment banner label resolution", () => {
  it("hides the banner for the production Supabase project", () => {
    expect(
      isNonProductionSupabaseUrl("https://xmeruhyybvyosqxfleiu.supabase.co")
    ).toBe(false);
  });

  it("shows PREVIEW when Vercel preview is set", () => {
    expect(
      resolveEnvironmentBannerLabel({
        supabaseUrl: "https://rvcpvfmkjadbkvhmiklu.supabase.co",
        vercelEnv: "preview",
        hostname: "crew-preview.vercel.app"
      })
    ).toBe("PREVIEW");
  });

  it("shows LOCAL for localhost on non-production projects", () => {
    expect(
      resolveEnvironmentBannerLabel({
        supabaseUrl: "https://rvcpvfmkjadbkvhmiklu.supabase.co",
        vercelEnv: "",
        hostname: "localhost"
      })
    ).toBe("LOCAL");
  });

  it("shows STAGING for non-local non-production hosts", () => {
    expect(
      resolveEnvironmentBannerLabel({
        supabaseUrl: "https://rvcpvfmkjadbkvhmiklu.supabase.co",
        vercelEnv: "",
        hostname: "crew.useaccrue.dev"
      })
    ).toBe("STAGING");
  });

  it("stays hidden until hostname is known", () => {
    expect(
      resolveEnvironmentBannerLabel({
        supabaseUrl: "https://rvcpvfmkjadbkvhmiklu.supabase.co",
        vercelEnv: "",
        hostname: null
      })
    ).toBeNull();
  });
});
