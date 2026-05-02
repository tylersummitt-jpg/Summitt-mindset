import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

const PHASE1_LIB_FILES = [
  "src/lib/v2-human-visible-sms/validate-human-visible-sms.ts",
  "src/lib/v2-human-visible-sms/banned-internal-terms.ts",
  "src/lib/v2-human-visible-sms/types.ts",
  "src/lib/v2-commitment-meaning-interpreter/types.ts",
  "src/lib/v2-commitment-meaning-interpreter/commitment-meaning-interpreter.ts",
  "src/lib/v2-human-sms-brain/types.ts",
  "src/lib/v2-human-sms-brain/human-sms-brain.ts",
  "src/lib/v2-human-sms-brain/prompts.ts",
  "src/lib/v2-human-sms-brain/flags.ts",
  "src/lib/v2-human-sms-brain/finalize-phase1-human-sms.ts",
  "src/lib/v2-human-sms-brain/thin-commitment-bar-for-victory.ts",
];

describe("Phase 1 SMS modules avoid Supabase coupling", () => {
  it.each(PHASE1_LIB_FILES)("no supabaseServer / mutation imports in %s", (rel) => {
    const src = readFileSync(join(repoRoot, rel), "utf8");
    expect(src).not.toMatch(/supabaseServer/);
    expect(src).not.toMatch(/@\/lib\/supabase-server/);
  });
});
