import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      insert: vi.fn(async () => ({ error: null })),
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        }),
      }),
    }),
  },
}));

import {
  MEANING_INTERPRETER_ROUTES,
  resolveNormalInboundMeaningShadowRoute,
  resolvePendingResolutionMeaningRoute,
  buildBlockerCaptureMeaningShadow,
  buildOpenQuestionMeaningShadow,
  buildPendingResolutionMeaningShadow,
} from "@/lib/sms-meaning-interpreter-routes";

describe("meaning interpreter route taxonomy", () => {
  it("resolveNormalInboundMeaningShadowRoute handles comms preference applied", () => {
    expect(
      resolveNormalInboundMeaningShadowRoute({
        gatedMode: "normal",
        commsPreferenceAction: "pause_until",
      })
    ).toBe(MEANING_INTERPRETER_ROUTES.comms_preference_applied);
  });

  it("resolveNormalInboundMeaningShadowRoute handles planned interruption", () => {
    expect(
      resolveNormalInboundMeaningShadowRoute({
        gatedMode: "normal",
        plannedInterruptionActive: true,
      })
    ).toBe(MEANING_INTERPRETER_ROUTES.planned_interruption);
  });

  it("resolveNormalInboundMeaningShadowRoute handles central sub-routes via gated mode", () => {
    expect(
      resolveNormalInboundMeaningShadowRoute({ gatedMode: "clarify" })
    ).toBe(MEANING_INTERPRETER_ROUTES.clarify_reply);
    expect(
      resolveNormalInboundMeaningShadowRoute({ gatedMode: "repair_reply_only" })
    ).toBe(MEANING_INTERPRETER_ROUTES.repair_reply_only);
  });

  it("resolvePendingResolutionMeaningRoute maps season mutation", () => {
    expect(
      resolvePendingResolutionMeaningRoute({
        pendingKind: "commitment_replace",
        userAnswerType: "user_yes",
        pendingReplaceApplied: true,
        pendingCleared: true,
        seasonTransitionApplied: true,
      })
    ).toBe(MEANING_INTERPRETER_ROUTES.season_goal_change_confirmation);
  });

  it("resolvePendingResolutionMeaningRoute maps rejected NO", () => {
    expect(
      resolvePendingResolutionMeaningRoute({
        pendingKind: "commitment_replace",
        userAnswerType: "user_no",
        pendingReplaceApplied: false,
        pendingCleared: false,
      })
    ).toBe(MEANING_INTERPRETER_ROUTES.pending_resolution_rejected);
  });

  it("branch builders attach deterministic_route", () => {
    expect(
      buildOpenQuestionMeaningShadow({
        commitmentId: "c1",
        classifierEventType: "user_yes",
        classifierNormalizedHint: null,
        openQuestionText: "Did you stretch?",
      }).deterministicRoute
    ).toBe(MEANING_INTERPRETER_ROUTES.open_question_answer);

    expect(
      buildBlockerCaptureMeaningShadow({
        commitmentId: "c1",
        classifierEventType: "user_partial",
        blockerCaptureAfterEvent: "user_no",
        blockerTextPreview: "traffic",
      }).deterministicRoute
    ).toBe(MEANING_INTERPRETER_ROUTES.blocker_capture);

    expect(
      buildPendingResolutionMeaningShadow({
        commitmentId: "c1",
        pendingKind: "commitment_tighten",
        userAnswerType: "user_yes",
        pendingApplied: true,
        pendingCleared: true,
      }).deterministicRoute
    ).toBe(MEANING_INTERPRETER_ROUTES.pending_resolution_commitment_tighten);
  });
});

describe("migration schema expectations", () => {
  it("includes shadow_status, skipped_reason, outcome_sent, reply_body_preview, route index", async () => {
    const fs = await import("node:fs/promises");
    const sql = await fs.readFile(
      "supabase/migrations/20260611120000_v2_sms_meaning_interpretation_shadow.sql",
      "utf8"
    );
    expect(sql).toContain("shadow_status");
    expect(sql).toContain("skipped_reason");
    expect(sql).toContain("outcome_sent");
    expect(sql).toContain("reply_body_preview");
    expect(sql).toContain("idx_v2_sms_meaning_shadow_route_created");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("manual reports include Phase 1 daily audit queries", async () => {
    const fs = await import("node:fs/promises");
    const sql = await fs.readFile("supabase/manual/meaning_interpreter_shadow_reports.sql", "utf8");
    expect(sql).toContain(":day_start");
    expect(sql).toContain(":day_end");
    expect(sql).toContain("open_question_routing_miss");
    expect(sql).toContain("contract_consent_gate_miss");
  });
});

describe("coach route wiring", () => {
  it("persistInboundV3 forwards meaningShadow to commitAndSend", async () => {
    const fs = await import("node:fs/promises");
    const route = await fs.readFile("src/app/api/cron/sms-inbound-coach/route.ts", "utf8");
    expect(route).toContain("meaningShadow?: MeaningInterpreterShadowScheduleArgs");
    expect(route).toMatch(/commitAndSendInboundCoachReply\(fresh, args\.userId, threadMemoryCtx\)/);
  });

  it("route attaches shadow on eligible branches", async () => {
    const fs = await import("node:fs/promises");
    const route = await fs.readFile("src/app/api/cron/sms-inbound-coach/route.ts", "utf8");
    expect(route).toContain("buildBlockerCaptureMeaningShadow");
    expect(route).toContain("buildPendingResolutionMeaningShadow");
    expect(route).toContain("buildContractConsentMeaningShadow");
    expect(route).toContain("buildCoachingRefreshMeaningShadow");
    expect(route).toContain("buildMemoryConfirmationMeaningShadow");
    expect(route).toContain("MEANING_INTERPRETER_ROUTES.central_brain_pivot");
    expect(route).toContain("MEANING_INTERPRETER_ROUTES.arc_clarify");
    expect(route).toContain("MEANING_INTERPRETER_ROUTES.conversation_brain_legacy_fallback");
  });

  it("safety and tapback register skipped shadow before markJobFinal", async () => {
    const fs = await import("node:fs/promises");
    const route = await fs.readFile("src/app/api/cron/sms-inbound-coach/route.ts", "utf8");
    expect(route).toContain("MEANING_INTERPRETER_ROUTES.safety_short_circuit_skipped");
    expect(route).toContain("MEANING_INTERPRETER_ROUTES.suppressed_tapback");
    expect(route).toContain("recordInboundMeaningShadowSuppressedNoSend");
    expect(route).toContain("finalizeMeaningShadowAfterJobTerminal");
  });
});
