import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guardrail: Phase 2 finalize must appear after resolveV2InboundCoachReplyBody,
 * which itself appears only after central-brain pivot and active-reply-context early exits.
 */
describe("sms-inbound-coach route — Phase 2 ordering vs early exits", () => {
  it("Phase 2 gate appears after resolveV2InboundCoachReplyBody and after pivot/ARC branches", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const routePath = join(__dirname, "../../app/api/cron/sms-inbound-coach/route.ts");
    const route = readFileSync(routePath, "utf8");

    const idxPivotControl = route.indexOf("shouldCentralBrainBlockOutcomeScoring");
    const idxArcClarify = route.indexOf("should_force_clarification_for_ambiguous_short_reply");
    const idxResolve = route.indexOf("resolveV2InboundCoachReplyBody({");
    const idxPhase2 = route.indexOf("isV2HumanSmsPhase2NormalInboundEnabled()");

    expect(idxPivotControl).toBeGreaterThan(-1);
    expect(idxArcClarify).toBeGreaterThan(-1);
    expect(idxResolve).toBeGreaterThan(-1);
    expect(idxPhase2).toBeGreaterThan(-1);

    expect(idxResolve).toBeGreaterThan(idxPivotControl);
    expect(idxResolve).toBeGreaterThan(idxArcClarify);
    expect(idxPhase2).toBeGreaterThan(idxResolve);
  });
});
