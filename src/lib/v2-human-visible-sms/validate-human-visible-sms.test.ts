import { describe, expect, it } from "vitest";
import {
  isRoboticAccountabilityMenuLanguage,
  validateHumanVisibleSms,
} from "@/lib/v2-human-visible-sms/validate-human-visible-sms";
import type { HumanSmsBrainCase } from "@/lib/v2-human-sms-brain/types";
import { phase1CuratedFallbackForCase } from "@/lib/v2-human-sms-brain/finalize-phase1-human-sms";

describe("validateHumanVisibleSms", () => {
  const bannedCases = [
    "contract proposal",
    "candidate",
    "same commitment-recommit",
    "I acknowledge your decision",
    "adaptive overlay",
    "pending resolution",
  ];

  it.each(bannedCases)("rejects banned phrase via %s", (snippet) => {
    const r = validateHumanVisibleSms(`Please note: ${snippet} here.`, {
      channel: "pending_resolution",
      maxChars: 320,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("banned_term");
  });

  const humanReplyYes = [
    "Reply yes and I’ll set that.",
    "Reply yes or no.",
    "Reply yes if that’s right, or no if not.",
    "Say yes if that works.",
  ];

  it.each(humanReplyYes)("allows normal coaching phrase: %s", (msg) => {
    const r = validateHumanVisibleSms(msg, { channel: "pending_resolution", maxChars: 320 });
    expect(r.ok).toBe(true);
  });

  const roboticMenus = [
    "Reply YES / NO / PARTIAL",
    "Reply yes/no/partial",
    "Reply with yes, no, or partial",
    "Text YES, NO, or PARTIAL",
    "Respond yes/no/partial",
    "yes, no, or partial — pick one",
  ];

  it.each(roboticMenus)("rejects robotic menu: %s", (msg) => {
    const r = validateHumanVisibleSms(msg, { channel: "pending_resolution", maxChars: 320 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("robotic_menu");
  });

  const dailyOutboundNatural = [
    "Did you do it today?",
    "Did you follow through?",
    "Reply yes or no when you can.",
    "Today's check: did you stretch for ten minutes?",
  ];

  it.each(dailyOutboundNatural)("daily_outbound allows accountability phrasing: %s", (msg) => {
    const r = validateHumanVisibleSms(msg, { channel: "daily_outbound", maxChars: 320 });
    expect(r.ok).toBe(true);
  });

  it("daily_outbound still rejects banned internal jargon", () => {
    const r = validateHumanVisibleSms("Quick note about adaptive overlay status.", {
      channel: "daily_outbound",
      maxChars: 320,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("banned_term");
  });
});

describe("validateHumanVisibleSms — Phase 5A channels", () => {
  const coachLines = [
    "Still here—when you're ready, what's one honest step on your morning walk today?",
    "I'm not scoring this yet—what happened with your bar today?",
    "Which thread are you answering: today's check-in or something else?",
    "Locked in on your proof—nice work. If the bar still needs to move, tell me what would be honest to hold you to.",
  ];
  const channels = [
    "reactivation_outbound",
    "inbound_central_tether",
    "inbound_arc_clarify",
    "normal_inbound_stitched_final",
  ] as const;

  it.each(channels.map((ch, i) => [ch, coachLines[i]!] as const))(
    "%s accepts natural coach SMS without internal jargon",
    (channel, msg) => {
      const r = validateHumanVisibleSms(msg, { channel, maxChars: 320 });
      expect(r.ok).toBe(true);
    }
  );

  it.each(channels)("rejects banned internal wording on %s", (channel) => {
    const r = validateHumanVisibleSms("Your pending resolution contract proposal status.", {
      channel,
      maxChars: 320,
    });
    expect(r.ok).toBe(false);
  });
});

describe("isRoboticAccountabilityMenuLanguage", () => {
  it("detects slash triads case-insensitively", () => {
    expect(isRoboticAccountabilityMenuLanguage("Just reply YES / NO / PARTIAL")).toBe(true);
  });

  it("does not flag plain reply yes or no", () => {
    expect(isRoboticAccountabilityMenuLanguage("Reply yes or no when you can.")).toBe(false);
  });
});

const ALL_BRAIN_CASES: HumanSmsBrainCase[] = [
  "pending_resolution_confirmation_prompt",
  "pending_resolution_replace_applied",
  "pending_resolution_tighten_applied",
  "pending_resolution_clarify_candidate",
  "pending_resolution_ambiguous_confirm",
  "pending_resolution_no_problem_reenter",
  "pending_resolution_lost_candidate",
  "pending_resolution_rpc_error_hold",
  "pending_resolution_vague_need_detail",
  "contract_consent_overlay_yes_ack",
  "contract_consent_overlay_no_ack",
];

describe("phase1CuratedFallbackForCase", () => {
  it.each(ALL_BRAIN_CASES)("every curated fallback passes validation (%s)", (brainCase) => {
    const fb = phase1CuratedFallbackForCase(brainCase);
    const r = validateHumanVisibleSms(fb, { channel: "pending_resolution", maxChars: 320 });
    expect(r.ok, fb).toBe(true);
  });
});
