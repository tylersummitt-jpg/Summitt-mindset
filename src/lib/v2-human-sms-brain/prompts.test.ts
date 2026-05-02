import { describe, expect, it } from "vitest";
import { brainCaseInstruction } from "@/lib/v2-human-sms-brain/prompts";

describe("brainCaseInstruction — Phase 5A", () => {
  it("uses non-default, coach-specific instructions (not generic default string)", () => {
    const generic = "Rewrite the MACHINE_DRAFT into natural coach SMS.";
    const p5: Array<"daily_outbound_reactivation_nudge" | "inbound_central_tether_pivot" | "inbound_active_reply_context_clarify" | "normal_inbound_stitched_final"> = [
      "daily_outbound_reactivation_nudge",
      "inbound_central_tether_pivot",
      "inbound_active_reply_context_clarify",
      "normal_inbound_stitched_final",
    ];
    for (const c of p5) {
      const s = brainCaseInstruction(c);
      expect(s).not.toBe(generic);
      expect(s.length).toBeGreaterThan(40);
    }
  });
});
