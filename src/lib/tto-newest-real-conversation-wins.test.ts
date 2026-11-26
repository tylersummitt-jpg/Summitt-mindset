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

    const production = daily.slice(daily.indexOf("export async function GET"));
    expect(production).toContain("deliverScheduledDailyCoaching");
    expect(production).not.toContain("attemptMorningTtoTwilioSend(");
    expect(production).not.toContain("ensureCurrentTtoDraftFreshForSend(");
    const send = read("src/lib/tyler-text-overview-send.ts");
    const prepare = send.slice(send.indexOf("async function prepareScheduledDailyDelivery"));
    expect(prepare.indexOf("hasAwaitingManualPatAnswer")).toBeGreaterThan(-1);
    expect(prepare.indexOf("hasAwaitingSmsOptOutReview")).toBeGreaterThan(-1);
    expect(prepare.indexOf("hasAwaitingManualPatAnswer")).toBeLessThan(prepare.indexOf("scheduledDailyBodyAuthorization"));
    expect(read("src/app/api/cron/evening-sms/route.ts")).not.toContain(
      "sendEveningTtoAuthoritativeCronSend"
    );
    expect(weekly).not.toContain("await sendSMS(");
    expect(prepare.indexOf("evaluateOutboundSmsForAccountDeletion")).toBeGreaterThan(-1);
    expect(prepare.indexOf("evaluateOutboundSmsForAccountDeletion")).toBeLessThan(
      prepare.indexOf("hasAwaitingManualPatAnswer")
    );
    expect(prepare.indexOf("stopped_at")).toBeLessThan(
      prepare.indexOf("scheduledDailyBodyAuthorization")
    );
    expect(evening).toContain("evening_proactive_send_disabled");
    expect(weekly).toContain("weekly_delivery_retired");
    expect(production).not.toContain("morningFreshRetry");
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
