import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Anonymous survey protection", () => {
  const resultsRoutePath = path.resolve(
    process.cwd(),
    "app/api/v1/surveys/[id]/results/route.ts"
  );

  const source = readFileSync(resultsRoutePath, "utf8");

  it("never selects respondent_id for anonymous surveys", () => {
    // The route has two select column strings — one for anonymous and one for non-anonymous.
    // The anonymous branch must NOT include "respondent_id".

    // Find the anonymous select clause: when isAnonymous is true
    const anonymousSelectMatch = source.match(
      /survey\.isAnonymous\s*\?\s*["']([^"']+)["']/
    );

    expect(anonymousSelectMatch).not.toBeNull();
    expect(anonymousSelectMatch![1]).not.toContain("respondent_id");
  });

  it("selects respondent_id only for non-anonymous surveys", () => {
    // The non-anonymous branch SHOULD include respondent_id
    const nonAnonymousSelectMatch = source.match(
      /survey\.isAnonymous\s*\?\s*["'][^"']+["']\s*:\s*["']([^"']+)["']/
    );

    expect(nonAnonymousSelectMatch).not.toBeNull();
    expect(nonAnonymousSelectMatch![1]).toContain("respondent_id");
  });

  it("returns protected: true when anonymous survey has fewer responses than threshold", () => {
    // The route must check isAnonymous AND !hasMinimumResponses
    // and return a response with protected: true
    expect(source).toContain("survey.isAnonymous && !hasMinimumResponses");
    expect(source).toContain("protected: true");
    expect(source).toContain("Not enough responses to display results.");
  });

  it("returns empty questionResults when protected", () => {
    // Inside the protected branch, questionResults must be empty
    const protectedBlock = source.slice(
      source.indexOf("survey.isAnonymous && !hasMinimumResponses"),
      source.indexOf("survey.isAnonymous && !hasMinimumResponses") + 600
    );

    expect(protectedBlock).toContain("questionResults: []");
    expect(protectedBlock).toContain("heatmap: null");
    expect(protectedBlock).toContain("trend: null");
  });

  it("does not include respondent_id in the anonymous select columns", () => {
    // Additional line-level check: find all .select() calls and verify
    // that respondent_id only appears in the non-anonymous branch
    const lines = source.split("\n");
    const selectLines = lines.filter(
      (line) =>
        line.includes("respondent_id") && !line.trimStart().startsWith("//")
    );

    // There should be exactly 2 references to respondent_id:
    // 1. The non-anonymous select clause: "id, answers, submitted_at, department, respondent_id"
    // 2. The Zod schema: respondent_id: z.string().uuid().nullable().optional()
    for (const line of selectLines) {
      if (line.includes("isAnonymous")) {
        // This is the ternary — the anonymous side must not have respondent_id
        const parts = line.split("?");
        const anonymousPart = parts[1]?.split(":")[0] ?? "";
        expect(anonymousPart).not.toContain("respondent_id");
      }
    }
  });
});
