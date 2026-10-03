import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ttoFinishWouldProtectDraft } from "@/lib/tto-stale-tyler-replacement";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const MIGRATION = read(
  "supabase/migrations/20261003120000_tto_finish_replace_stale_tyler_nonempty.sql"
);

describe("stale Tyler persistence migration", () => {
  it("drops the old signature and creates one default-off replacement", () => {
    expect(MIGRATION).toContain("BEGIN;");
    expect(MIGRATION).toContain("COMMIT;");
    expect(MIGRATION).toContain(
      "DROP FUNCTION IF EXISTS public.tto_finish_generation_persistence"
    );
    expect(MIGRATION).toContain(
      "p_allow_replace_stale_tyler_nonempty boolean DEFAULT false"
    );
    expect(MIGRATION.match(/CREATE FUNCTION public\.tto_finish_generation_persistence/g)?.length).toBe(
      1
    );
    expect(MIGRATION).not.toContain("CREATE OR REPLACE FUNCTION public.tto_finish_generation_persistence");
    const replaceLines = MIGRATION.match(/v_replace_stale_tyler_nonempty :=/g) ?? [];
    expect(replaceLines.length).toBe(2);
    expect(MIGRATION).toContain("AND v_tyler");
    expect(MIGRATION).toContain("AND v_nonempty");
    expect(MIGRATION).toContain("(v_tyler AND NOT v_replace_stale_tyler_nonempty)");
    expect(MIGRATION).toContain(
      "tto_finish_generation_persistence(\n  text, text, text, uuid, text, text, timestamptz, boolean, boolean\n) TO service_role"
    );
    expect(MIGRATION).not.toMatch(/\bALTER TABLE\b/);
    expect(MIGRATION).not.toMatch(/\bADD COLUMN\b/);
  });

  it("SQL override still refuses a Tyler blank and still pins admin calls", () => {
    expect(
      ttoFinishWouldProtectDraft({
        draftExists: true,
        tyler: true,
        nonempty: false,
        protectTylerProvenanceOnly: true,
        allowReplaceStaleTylerNonempty: true,
      })
    ).toBe(true);
    expect(
      ttoFinishWouldProtectDraft({
        draftExists: true,
        tyler: true,
        nonempty: true,
        protectTylerProvenanceOnly: true,
        allowReplaceStaleTylerNonempty: true,
      })
    ).toBe(false);
    expect(
      ttoFinishWouldProtectDraft({
        draftExists: true,
        tyler: true,
        nonempty: true,
        protectTylerProvenanceOnly: true,
        allowReplaceStaleTylerNonempty: false,
      })
    ).toBe(true);
    expect(
      ttoFinishWouldProtectDraft({
        draftExists: true,
        tyler: true,
        nonempty: true,
        protectTylerProvenanceOnly: false,
        allowReplaceStaleTylerNonempty: true,
      })
    ).toBe(true);
    expect(
      ttoFinishWouldProtectDraft({
        draftExists: true,
        tyler: false,
        nonempty: true,
        protectTylerProvenanceOnly: true,
        allowReplaceStaleTylerNonempty: false,
      })
    ).toBe(false);
  });
});

describe("newest conversation send ownership", () => {
  it("keeps STOP, opt-out review, and Manual Pat ahead of freshness on every lane", () => {
    const daily = read("src/app/api/cron/daily-sms/route.ts");
    const evening = read("src/lib/tyler-text-overview-evening-send.ts");
    const weekly = read("src/lib/tyler-text-overview-weekly-send.ts");

    expect(daily.split("ensureCurrentTtoDraftFreshForSend(").length - 1).toBe(2);
    expect(evening.split("ensureCurrentTtoDraftFreshForSend(").length - 1).toBe(1);
    expect(weekly.split("ensureCurrentTtoDraftFreshForSend(").length - 1).toBe(1);

    for (const src of [daily, evening, weekly]) {
      const freshAt = src.indexOf("ensureCurrentTtoDraftFreshForSend(");
      const optOutAt = src.indexOf("await shouldSkipDailyForAwaitingSmsOptOutReview") !== -1
        ? src.indexOf("await shouldSkipDailyForAwaitingSmsOptOutReview")
        : src.indexOf("await hasAwaitingSmsOptOutReview");
      const patAt = src.indexOf("await shouldSkipDailyForAwaitingManualPatAnswer") !== -1
        ? src.indexOf("await shouldSkipDailyForAwaitingManualPatAnswer")
        : src.indexOf("await hasAwaitingManualPatAnswer");
      expect(optOutAt).toBeGreaterThan(-1);
      expect(patAt).toBeGreaterThan(-1);
      expect(optOutAt).toBeLessThan(freshAt);
      expect(patAt).toBeLessThan(freshAt);
    }

    const morningSend = daily.slice(daily.indexOf("async function attemptMorningTtoTwilioSend"));
    const morningRace = morningSend.indexOf("savedProactiveSentenceOutgrownByRealConversation(");
    const morningTwilio = morningSend.indexOf("await sendSMS(");
    expect(morningRace).toBeGreaterThan(-1);
    expect(morningTwilio).toBeGreaterThan(morningRace);
    expect(daily.indexOf("ensureCurrentTtoDraftFreshForSend(")).toBeLessThan(
      daily.indexOf("const retrySendAttempt = await attemptMorningTtoTwilioSend")
    );
    expect(
      daily.indexOf("ensureCurrentTtoDraftFreshForSend(", daily.indexOf("path: \"main\""))
    ).toBeLessThan(daily.indexOf("const mainSendAttempt = await attemptMorningTtoTwilioSend"));

    for (const src of [evening, weekly]) {
      const freshAt = src.indexOf("ensureCurrentTtoDraftFreshForSend(");
      const raceAt = src.indexOf("savedProactiveSentenceOutgrownByRealConversation(");
      const twilioAt = src.indexOf("await sendSMS(");
      expect(raceAt).toBeGreaterThan(freshAt);
      expect(twilioAt).toBeGreaterThan(raceAt);
    }

    expect(daily.indexOf("stopped_at")).toBeLessThan(
      daily.indexOf("ensureCurrentTtoDraftFreshForSend(")
    );
    expect(evening.indexOf("stopped_at")).toBeLessThan(
      evening.indexOf("ensureCurrentTtoDraftFreshForSend(")
    );
    expect(weekly.indexOf("stopped_at")).toBeLessThan(
      weekly.indexOf("ensureCurrentTtoDraftFreshForSend(")
    );
    expect(daily).toContain('morningFreshRetry.reason !== "conversation_moved_again"');
  });

  it("does not give Admin Generate, Goal Change, or the idle refresher the replace flag", () => {
    const fresh = read("src/lib/tto-draft-fresh-for-send.ts");
    expect(fresh).toContain("allowReplaceStaleTylerNonempty: true");
    for (const rel of [
      "src/lib/sol-goal-change-tto-draft-refresh.ts",
      "src/lib/tyler-text-overview-refresh-stale.ts",
      "src/lib/morning-tto-brief-interpreter-v1.ts",
      "src/lib/weekly-tto-brief-interpreter.ts",
      "src/lib/sms-relationship-exit-intent.ts",
    ]) {
      expect(read(rel)).not.toContain("allowReplaceStaleTylerNonempty");
      expect(read(rel)).not.toContain("replaced_stale_tyler_body");
    }
    const generate = read("src/lib/tyler-text-overview-generate.ts");
    expect(generate).toContain(
      "p_allow_replace_stale_tyler_nonempty: args.allowReplaceStaleTylerNonempty === true"
    );
  });
});
