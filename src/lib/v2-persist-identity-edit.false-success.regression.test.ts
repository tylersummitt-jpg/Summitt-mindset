import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isQuotableIdentitySource } from "@/lib/v2-identity-anchor-validation";

const root = process.cwd();

describe("Edit Identity client success guard", () => {
  it("requires ok + versionId + identity_anchor_text before showing success", () => {
    const src = readFileSync(
      path.join(root, "src/components/IdentityBuilderClient.tsx"),
      "utf8"
    );
    expect(src).toContain("data?.ok !== true");
    expect(src).toContain('typeof data.versionId !== "string"');
    expect(src).toContain('typeof data.identity_anchor_text !== "string"');
    expect(src).toContain("We couldn’t save your identity. Please try again.");
  });
});

describe("Victory Room identity source compatibility", () => {
  it("treats user_edited as quotable for canonical profile mirrors", () => {
    expect(isQuotableIdentitySource("user_edited")).toBe(true);
    expect(isQuotableIdentitySource("explicitly_confirmed")).toBe(true);
    expect(isQuotableIdentitySource(null)).toBe(false);
  });
});

describe("persistAppIdentityEdit uses profile upsert not update-only", () => {
  it("source upserts on clerk_user_id and selects the mirror", () => {
    const src = readFileSync(
      path.join(root, "src/lib/v2-persist-identity-edit.ts"),
      "utf8"
    );
    expect(src).toContain('.upsert(profileRow, { onConflict: "clerk_user_id" })');
    expect(src).toContain("missing_or_mismatched_profile_mirror");
    expect(src).not.toMatch(
      /\.from\("user_profiles"\)\s*\n\s*\.update\(profilePatch\)/
    );
  });
});
