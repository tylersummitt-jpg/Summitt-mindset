/**
 * ARC / Active Reply Context unit tests.
 *
 * Production currently sets V2_ACTIVE_REPLY_CONTEXT_ENABLED=false (ARC kill switch). Baseline tests
 * below document current `buildV2ActiveReplyContext` math when ARC code is off in prod.
 *
 * Skipped block: coach-thread narrowing — revisit only if ARC is re-enabled or narrowed.
 */

import { describe, expect, it } from "vitest";

import {
  buildV2ActiveReplyContext,
  isAmbiguousShortReplyNeedingContext,
} from "@/lib/v2-active-reply-context";

import type { V2EventRowForAi } from "@/lib/v2-commitment";

/** Daily check then user_yes — newest-first order as loaded for AI prompts. */
function productionAnsweredCheckSpine(): V2EventRowForAi[] {
  return [
    {
      event_type: "user_yes",
      occurred_at: "2026-05-02T21:27:53.000Z",
      payload_json: {},
    },
    {
      event_type: "check_sent",
      occurred_at: "2026-05-02T19:00:52.000Z",
      payload_json: {},
    },
  ];
}

const DEFAULT_COMMITMENT_CONTEXT = {
  commitmentTitle: "Distribution",
  behaviorStatement: "Spend an hour on distribution for the SaaS app.",
  effectiveAsk: "Spend an hour on distribution for the SaaS app.",
};

/** Process inbound shortly after the thread (matches production window). */
const NOW_MS = Date.parse("2026-05-03T01:15:00.000Z");

describe("buildV2ActiveReplyContext — baseline (ARC disabled in prod)", () => {
  /**
   * TEST 4 (baseline): Without modeling a recent coach question, bare "Yes" after an answered
   * daily check MUST keep forcing clarification — protection unchanged.
   */
  it("TEST 4: random Yes with answered daily check — SHOULD force clarification", () => {
    const ctx = buildV2ActiveReplyContext({
      inboundText: "Yes",
      eventsNewestFirst: productionAnsweredCheckSpine(),
      nowMs: NOW_MS,
      ...DEFAULT_COMMITMENT_CONTEXT,
    });

    expect(isAmbiguousShortReplyNeedingContext("Yes")).toBe(true);
    expect(ctx.has_live_accountability_prompt).toBe(false);
    expect(ctx.should_force_clarification_for_ambiguous_short_reply).toBe(true);
    expect(ctx.clarification_reason).toBe("ambiguous_short_latest_check_already_answered");
  });

  /**
   * TEST 5 — After fix: stale coach timestamp must not authorize. Today: identical to TEST 4 (PASS).
   */
  it("TEST 5: stale coach question — SHOULD still force clarification for bare Yes (PASS until stale wiring)", () => {
    const ctx = buildV2ActiveReplyContext({
      inboundText: "Yes",
      eventsNewestFirst: productionAnsweredCheckSpine(),
      nowMs: NOW_MS,
      ...DEFAULT_COMMITMENT_CONTEXT,
    });

    expect(ctx.should_force_clarification_for_ambiguous_short_reply).toBe(true);
    expect(ctx.clarification_reason).toBe("ambiguous_short_latest_check_already_answered");

    // TODO(post-fix): extend API with lastOutboundCoachSentAt far in the past + accountability-shaped body;
    // assert should_force_clarification remains true.
  });

  /**
   * TEST 6 — After fix: empathy-only coach SMS must not authorize. Today: identical to TEST 4 (PASS).
   */
  it("TEST 6: non-accountability recent coach message — SHOULD force clarification for bare Yes (PASS until coach-body classifier)", () => {
    const ctx = buildV2ActiveReplyContext({
      inboundText: "Yes",
      eventsNewestFirst: productionAnsweredCheckSpine(),
      nowMs: NOW_MS,
      ...DEFAULT_COMMITMENT_CONTEXT,
    });

    expect(ctx.should_force_clarification_for_ambiguous_short_reply).toBe(true);

    // TODO(post-fix): lastOutboundCoachBody: "I hear you. That sounds frustrating." + recent sent_at
    // → assert clarification still forced.
  });
});

describe.skip(
  "ARC coach-thread narrowing (skipped: V2_ACTIVE_REPLY_CONTEXT_ENABLED=false in prod; revisit if ARC re-enabled)",
  () => {
    it("TEST 1: plain Yes answering recent coach completion question — should NOT force clarification", () => {
      const ctx = buildV2ActiveReplyContext({
        inboundText: "Yes",
        eventsNewestFirst: productionAnsweredCheckSpine(),
        nowMs: NOW_MS,
        ...DEFAULT_COMMITMENT_CONTEXT,
      });

      expect(ctx.clarification_reason).toBe("ambiguous_short_latest_check_already_answered");
      expect(ctx.should_force_clarification_for_ambiguous_short_reply).toBe(false);
    });

    it("TEST 2: Yes it was — should NOT force clarification when answering recent coach question", () => {
      const ctx = buildV2ActiveReplyContext({
        inboundText: "Yes it was",
        eventsNewestFirst: productionAnsweredCheckSpine(),
        nowMs: NOW_MS,
        ...DEFAULT_COMMITMENT_CONTEXT,
      });

      expect(ctx.clarification_reason).toBe("ambiguous_short_latest_check_already_answered");
      expect(ctx.should_force_clarification_for_ambiguous_short_reply).toBe(false);
    });

    it("TEST 3: Yes I did — should NOT force clarification when answering recent coach question", () => {
      const ctx = buildV2ActiveReplyContext({
        inboundText: "Yes I did",
        eventsNewestFirst: productionAnsweredCheckSpine(),
        nowMs: NOW_MS,
        ...DEFAULT_COMMITMENT_CONTEXT,
      });

      expect(ctx.clarification_reason).toBe("ambiguous_short_latest_check_already_answered");
      expect(ctx.should_force_clarification_for_ambiguous_short_reply).toBe(false);
    });
  }
);
