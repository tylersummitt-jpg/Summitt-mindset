import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20260612120000_v2_sms_pattern_correction.sql"
);

const REPORTS = join(process.cwd(), "supabase/manual/pattern_correction_reports.sql");

describe("v2_sms_pattern_correction migration", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("creates v2_sms_pattern_correction table", () => {
    expect(sql).toContain("CREATE TABLE v2_sms_pattern_correction");
    expect(sql).toContain("source_shadow_id UUID NULL REFERENCES v2_sms_meaning_interpretation_shadow");
    expect(sql).toContain("ON DELETE SET NULL");
  });

  it("has scope/status/usage_policy/source/correction_type CHECKs", () => {
    expect(sql).toContain("v2_sms_pattern_correction_scope_chk");
    expect(sql).toContain("scope IN ('user', 'commitment', 'global')");
    expect(sql).toContain("v2_sms_pattern_correction_status_chk");
    expect(sql).toContain("'suggested', 'approved', 'rejected', 'archived'");
    expect(sql).toContain("v2_sms_pattern_correction_usage_policy_chk");
    expect(sql).toContain("'prompt_hint_only'");
    expect(sql).toContain("v2_sms_pattern_correction_source_chk");
    expect(sql).toContain("v2_sms_pattern_correction_type_chk");
    expect(sql).toContain("'shadow_disagreement_reviewed'");
  });

  it("has confidence check", () => {
    expect(sql).toContain("v2_sms_pattern_correction_confidence_chk");
    expect(sql).toMatch(/confidence >= 0 AND confidence <= 1/);
  });

  it("has scope rules", () => {
    expect(sql).toContain("v2_sms_pattern_correction_scope_user_chk");
    expect(sql).toContain("v2_sms_pattern_correction_scope_commitment_chk");
    expect(sql).toContain("v2_sms_pattern_correction_scope_global_chk");
  });

  it("has pattern rule", () => {
    expect(sql).toContain("v2_sms_pattern_correction_pattern_chk");
    expect(sql).toContain("length(trim(phrase_pattern))");
    expect(sql).toContain("length(trim(normalized_pattern))");
  });

  it("has use_count check", () => {
    expect(sql).toContain("v2_sms_pattern_correction_use_count_chk");
    expect(sql).toContain("use_count >= 0");
  });

  it("has RLS enabled without anon/authenticated policies", () => {
    expect(sql).toContain("ALTER TABLE v2_sms_pattern_correction ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql.toLowerCase()).not.toContain("to authenticated");
    expect(sql.toLowerCase()).not.toContain("to anon");
    expect(sql.toLowerCase()).not.toContain("grant select");
  });

  it("has required indexes", () => {
    expect(sql).toContain("idx_v2_sms_pattern_correction_clerk_status_type");
    expect(sql).toContain("(clerk_user_id, status, correction_type)");
    expect(sql).toContain("idx_v2_sms_pattern_correction_commitment_status");
    expect(sql).toContain("idx_v2_sms_pattern_correction_scope_status_type");
    expect(sql).toContain("idx_v2_sms_pattern_correction_source_shadow_id");
    expect(sql).toContain("idx_v2_sms_pattern_correction_source_message_sid");
    expect(sql).toContain("idx_v2_sms_pattern_correction_expires_at");
    expect(sql).toContain("idx_v2_sms_pattern_correction_updated_at");
    expect(sql).toContain("uq_v2_sms_pattern_correction_approved_pattern");
  });

  it("documents non-authoritative purpose", () => {
    expect(sql).toMatch(/non-authoritative/i);
    expect(sql).toMatch(/must not mutate routing/i);
  });
});

describe("sms-pattern-correction static isolation", () => {
  it("helper does not import inbound coach route, V3, Victory, proof, classifier, Season RPCs, Twilio", async () => {
    const fs = await import("node:fs/promises");
    const helper = await fs.readFile("src/lib/sms-pattern-correction.ts", "utf8");
    const schema = await fs.readFile("src/lib/sms-pattern-correction-schema.ts", "utf8");
    const combined = `${helper}\n${schema}`;

    expect(combined).not.toContain("sms-inbound-coach");
    expect(combined).not.toContain("produceInboundV3RelationshipSms");
    expect(combined).not.toContain("victory");
    expect(combined).not.toContain("proof");
    expect(combined).not.toContain("classifier");
    expect(combined).not.toContain("season_lifecycle");
    expect(combined).not.toContain("twilio");
  });

  it("inbound coach route does not import pattern correction helper yet", async () => {
    const fs = await import("node:fs/promises");
    const route = await fs.readFile("src/app/api/cron/sms-inbound-coach/route.ts", "utf8");
    expect(route).not.toContain("sms-pattern-correction");
    expect(route).not.toContain("v2_sms_pattern_correction");
  });
});

describe("pattern_correction_reports.sql", () => {
  const sql = readFileSync(REPORTS, "utf8");

  it("exists with 12 read-only SELECT reports", () => {
    const selectBlocks = sql.match(/^SELECT\b/gim) ?? [];
    expect(selectBlocks.length).toBeGreaterThanOrEqual(12);
    expect(sql).not.toMatch(/^INSERT INTO v2_sms_pattern_correction/m);
    expect(sql).not.toMatch(/^UPDATE v2_sms_pattern_correction/m);
  });

  it("includes DO NOT RUN WITHOUT REVIEW templates commented out", () => {
    expect(sql).toContain("DO NOT RUN WITHOUT REVIEW");
    expect(sql).toContain("-- INSERT INTO v2_sms_pattern_correction");
    expect(sql).toContain("-- UPDATE v2_sms_pattern_correction");
    expect(sql).not.toContain("INSERT INTO v2_sms_pattern_correction\n");
  });

  it("does not bulk auto-insert from all disagreements", () => {
    expect(sql.toLowerCase()).not.toMatch(/insert\s+into\s+v2_sms_pattern_correction[\s\S]*from\s+v2_sms_meaning_interpretation_shadow[\s\S]*where\s+s\.disagreement\s*=\s*true/i);
    const uncommentedInserts = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .some((line) => /^INSERT\b/i.test(line.trim()));
    expect(uncommentedInserts).toBe(false);
  });
});
