import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

vi.mock("@/lib/victory-media/correlate-inbound-mms-c1", () => ({
  scheduleC1IfWinsDurable: vi.fn(),
}));

import { validateV2AiInboundMessage } from "@/lib/v2-ai-inbound";
import { validateV2AiBlockerAckMessage } from "@/lib/v2-ai-blocker-ack";
import {
  evaluateCompletionAlignmentForProof,
  isSubstantiveSelfReportedCompletionForProof,
} from "@/lib/inbound-self-reported-completion";
import { isSelfContainedAccountabilityAnswer } from "@/lib/v2-active-reply-context";
import { resolveWinRecognitionCurrentGoal } from "@/lib/inbound-win-recognition-wire";
import { getEffectiveCoachingAsk } from "@/lib/v2-adaptive-contract";
import fs from "node:fs";
import path from "node:path";

describe("Phase 1 model-context title hygiene", () => {
  it("Win recognition currentGoal never falls back to legacy title", () => {
    expect(
      resolveWinRecognitionCurrentGoal({
        effectiveAsk: "Lift weights for 30 minutes a day",
        behaviorStatement: "Walk daily",
      })
    ).toBe("Lift weights for 30 minutes a day");

    expect(
      resolveWinRecognitionCurrentGoal({
        effectiveAsk: null,
        behaviorStatement: "Lift weights for 30 minutes a day",
      })
    ).toBe("Lift weights for 30 minutes a day");

    expect(
      resolveWinRecognitionCurrentGoal({
        effectiveAsk: "   ",
        behaviorStatement: null,
      })
    ).toBeNull();
  });

  it("inbound coach route uses resolveWinRecognitionCurrentGoal and no title fallback", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    expect(src).toContain("resolveWinRecognitionCurrentGoal");
    expect(src).not.toMatch(
      /currentGoal:[\s\S]{0,180}commitment\.title/
    );
  });

  it("active overlay effective ask wins over base behavior", () => {
    const row = {
      behavior_statement: "Lift weights for 30 minutes a day",
      adaptive_ask_text: "Lift for 10 minutes today",
      adaptive_ask_active_from: "2020-01-01T00:00:00.000Z",
      adaptive_ask_expires_at: "2099-01-01T00:00:00.000Z",
    } as Parameters<typeof getEffectiveCoachingAsk>[0];
    expect(getEffectiveCoachingAsk(row)).toBe("Lift for 10 minutes today");
    expect(
      resolveWinRecognitionCurrentGoal({
        effectiveAsk: getEffectiveCoachingAsk(row),
        behaviorStatement: row.behavior_statement,
      })
    ).toBe("Lift for 10 minutes today");
  });

  it("lifting completion still aligns when title is stale SaaS App", () => {
    const alignment = evaluateCompletionAlignmentForProof("Got my lifting done today", {
      commitmentBehaviorStatement: "Lift weights for 30 minutes a day",
      effectiveAsk: "Lift weights for 30 minutes a day",
      commitmentTitle: "SaaS App",
    });
    expect(alignment.aligned).toBe(true);
    expect(
      isSubstantiveSelfReportedCompletionForProof("Got my lifting done today", {
        commitmentBehaviorStatement: "Lift weights for 30 minutes a day",
        effectiveAsk: "Lift weights for 30 minutes a day",
        commitmentTitle: "SaaS App",
      })
    ).toBe(true);
  });

  it("SaaS/app wording alone cannot align via legacy title when goal is lifting", () => {
    const alignment = evaluateCompletionAlignmentForProof(
      "I completed my goal of shipping my SaaS App today",
      {
        commitmentBehaviorStatement: "Lift weights for 30 minutes a day",
        effectiveAsk: "Lift weights for 30 minutes a day",
        commitmentTitle: "SaaS App",
      }
    );
    expect(alignment.aligned).toBe(false);
    expect(alignment.skipReason).toBe("off_goal_completion_claim");
    expect(
      isSelfContainedAccountabilityAnswer({
        text: "I shipped a big SaaS App feature today",
        commitmentTitle: "SaaS App",
        behaviorStatement: "Lift weights for 30 minutes a day",
        effectiveAsk: "Lift weights for 30 minutes a day",
      })
    ).toBe(false);
  });

  it("v2-ai inbound/outbound/blocker prompts omit legacy title goal lines", () => {
    const inbound = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-ai-inbound.ts"),
      "utf8"
    );
    const outbound = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-ai-outbound.ts"),
      "utf8"
    );
    const blocker = fs.readFileSync(
      path.join(process.cwd(), "src/lib/v2-ai-blocker-ack.ts"),
      "utf8"
    );
    expect(inbound).not.toMatch(/lines\.push\(`title:/);
    expect(inbound).not.toMatch(/commitment_title:/);
    expect(outbound).not.toMatch(/lines\.push\(`title:/);
    expect(blocker).not.toMatch(/lines\.push\(`title:/);
  });

  it("inbound validator grounds on behavior/effective ask without requiring title tokens", () => {
    const ok = validateV2AiInboundMessage({
      message: "You protected the lift today — keep that same thirty-minute bar tomorrow.",
      serverStrategy: "reinforce_yes",
      modelStrategy: "reinforce_yes",
      behaviorStatement: "Lift weights for 30 minutes a day",
      commitmentTitle: "SaaS App",
    });
    expect(ok).toEqual({ ok: true });
  });

  it("blocker-ack validator does not require SaaS title tokens when behavior is lifting", () => {
    const ok = validateV2AiBlockerAckMessage({
      message: "Got it — meetings blocked your lift. Protect thirty minutes after dinner.",
      modelStrategy: "acknowledge_blocker",
      blockerText: "meetings ran long",
      behaviorStatement: "Lift weights for 30 minutes a day",
      commitmentTitle: "SaaS App",
    });
    expect(ok).toEqual({ ok: true });
  });
});
