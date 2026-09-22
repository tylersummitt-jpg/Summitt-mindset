import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || entry.includes(".test.")) continue;
    files.push(full);
  }
  return files;
}

describe("Programs isolation", () => {
  it("keeps runtime Programs code off the archive and off other member systems", () => {
    const files = [
      ...sourceFiles(path.join(ROOT, "src/lib/learning")),
      ...sourceFiles(path.join(ROOT, "src/app/programs")),
      ...sourceFiles(path.join(ROOT, "src/components/programs")),
    ];
    expect(files.length).toBeGreaterThan(5);
    const forbidden = [
      /data\/learning\/source/,
      /definite_dozen\/program\.json/,
      /film_videos/,
      /journal_entries/,
      /v2_durable_user_evidence/,
      /v2_coach_relationship_memory/,
      /weekly_sms_reflections/,
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        expect(source, file).not.toMatch(pattern);
      }
    }
  });

  it("does not accept a client-supplied member id in Programs actions", () => {
    const source = readFileSync(path.join(ROOT, "src/app/programs/actions.ts"), "utf8");
    expect(source).not.toMatch(/clerk_user_id|clerkUserId/);
    expect(source).toContain("requireProgramsMemberId");
    expect(source).toContain("canPersistOnStep");
    expect(source).not.toContain("correct_choice_ids");
    expect(source).not.toContain("correct_category");
    expect(source).not.toContain("passed");
  });
});
