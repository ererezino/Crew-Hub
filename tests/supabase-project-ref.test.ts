import { describe, expect, it } from "vitest";

import { extractSupabaseProjectRef } from "../lib/supabase/project-ref";

describe("extractSupabaseProjectRef", () => {
  it("extracts project ref from Supabase URL", () => {
    expect(
      extractSupabaseProjectRef("https://xmeruhyybvyosqxfleiu.supabase.co")
    ).toBe("xmeruhyybvyosqxfleiu");
  });

  it("returns null for non-supabase URL", () => {
    expect(extractSupabaseProjectRef("https://example.com")).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(extractSupabaseProjectRef("not-a-url")).toBeNull();
  });
});
