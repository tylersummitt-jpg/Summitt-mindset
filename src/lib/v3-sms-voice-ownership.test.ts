import { afterEach, describe, expect, it } from "vitest";

import { finalizeNorthStarCoachSms } from "./north-star-coach-sms";
import {
  appendPreservedSignedLink,
  appendPreservedSmsSuffix,
  applyFinalVoiceOwnershipGate,
  detectFinalVoiceBlockedReasons,
} from "./v3-sms-voice-ownership";

const prevOpenAi = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = prevOpenAi;
});

describe("detectFinalVoiceBlockedReasons", () => {
  it("rejects quoted/truncated next concrete move copy", () => {
    const reasons = detectFinalVoiceBlockedReasons(
      'Got it — "This is a very long user text that should not be quoted back in an SMS..." — what\'s the next concrete move?'
    );
    expect(reasons).toContain("got_it_quote_lead");
    expect(reasons).toContain("next_concrete_move");
  });

  it("rejects malformed daily wrappers and old fallback copy", () => {
    expect(detectFinalVoiceBlockedReasons("Did you protect Use AI & dictate at least one story today?")).toContain(
      "did_you_protect_use"
    );
    expect(detectFinalVoiceBlockedReasons("Say it straight — what moved with today's line, and what didn't?")).toContain(
      "say_it_straight"
    );
  });

  it("flags malformed Did raw phrase happen today", () => {
    expect(detectFinalVoiceBlockedReasons("Did Focus on process happen today?")).toContain(
      "malformed_did_raw_phrase_happen_today"
    );
    expect(detectFinalVoiceBlockedReasons("You made a comeback yesterday! Did Focused on work without distractions happen today?")).toContain(
      "malformed_did_raw_phrase_happen_today"
    );
  });
});

describe("applyFinalVoiceOwnershipGate", () => {
  it("allows a clean V3-owned body", async () => {
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "That counts. What made it work?",
      replySource: "v3_sms_brain",
      channel: "inbound_coach_reply",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });

    expect(r.body).toBe("That counts. What made it work?");
    expect(r.shouldSend).toBe(true);
    expect(r.voiceOwner).toBe("v3_openai");
    expect(r.v3Owned).toBe(true);
    expect(r.emergencyFallbackUsed).toBe(false);
  });

  it("uses safe emergency fallback when OpenAI repair is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      replySource: "deterministic_human",
      channel: "inbound_coach_reply",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      finalEventType: "user_yes",
      normalCoaching: true,
    });

    expect(r.shouldSend).toBe(true);
    expect(r.body).toBe("That counts. What made it work?");
    expect(r.voiceOwner).toBe("v3_deterministic_fallback");
    expect(r.emergencyFallbackUsed).toBe(true);
    expect(r.body.toLowerCase()).not.toContain("say it straight");
  });

  it("fail-closed daily: does not use deterministic emergency fallback when repair unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Did you protect Use AI & dictate at least one story today?",
      replySource: "v3_daily_check_in",
      channel: "daily_outbound",
      activeCommitmentId: "c1",
      effectiveAsk: "Use AI & dictate at least one story",
      normalCoaching: true,
    });

    expect(r.shouldSend).toBe(false);
    expect(r.skipReason).toBe("no_safe_v3_voice");
    expect(r.body).toBe("");
    expect(r.emergencyFallbackUsed).toBe(false);
    expect(r.metadata.v3_emergency_fallback_used).toBe(false);
    expect(r.metadata.should_send).toBe(false);
    expect(r.metadata.skip_reason).toBe("no_safe_v3_voice");
    expect(r.metadata.twilio_send_attempted).toBe(false);
    expect(r.metadata.voice_owner).toBe("v3_daily");
    expect(r.metadata.deterministic_code_blocked).toBe(true);
  });

  it("fail-closed daily malformed Did <raw> happen today: no send when repair unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody:
        "You made a comeback yesterday! Did Focused on work without distractions happen today?",
      replySource: "v3_daily_check_in",
      channel: "daily_outbound",
      activeCommitmentId: "c1",
      effectiveAsk: "Focused on work without distractions",
      normalCoaching: true,
    });

    expect(r.shouldSend).toBe(false);
    expect(r.skipReason).toBe("no_safe_v3_voice");
    expect(r.body).toBe("");
    expect(r.metadata.final_voice_blocked_reasons).toEqual(
      expect.arrayContaining(["malformed_did_raw_phrase_happen_today"])
    );
    expect(r.metadata.deterministic_code_blocked).toBe(true);
    expect(r.metadata.v3_emergency_fallback_used).toBe(false);
    expect(r.metadata.v3_repair_attempted).toBe(false);
    expect(r.metadata.v3_repair_succeeded).toBe(false);
    expect(r.body).not.toContain("Did you protect the focused work block");
  });

  it("allows clean v3-owned daily_outbound copy to pass without repair", async () => {
    delete process.env.OPENAI_API_KEY;
    const proposed =
      "You made a comeback yesterday! Did you get in that focused work session today without distractions?";
    const ns = finalizeNorthStarCoachSms({
      proposedBody: proposed,
      channel: "daily_outbound",
      replySource: "v3_daily_check_in",
      effectiveAskText: "Focused on work without distractions",
    });
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: ns.visibleBody,
      replySource: "v3_daily_check_in",
      channel: "daily_outbound",
      activeCommitmentId: "c1",
      effectiveAsk: "Focused on work without distractions",
      northStarMeta: ns.meta,
      normalCoaching: true,
    });

    expect(r.shouldSend).toBe(true);
    expect(r.voiceOwner).toBe("v3_daily");
    expect(r.blockedReasons).toHaveLength(0);
    expect(r.metadata.deterministic_code_blocked).toBe(false);
    expect(r.body).toContain("Did you get in that focused work session");
  });

  it("fail-closed daily: requires_v3_repair with no OpenAI yields no send, not emergency fallback", async () => {
    delete process.env.OPENAI_API_KEY;
    const ns = finalizeNorthStarCoachSms({
      proposedBody: "How did your focus go today and did you manage to finish the block?",
      channel: "daily_outbound",
      replySource: "v3_daily_check_in",
      effectiveAskText: "30 min focus",
    });
    expect(ns.meta.requires_v3_repair).toBe(true);
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: ns.visibleBody,
      replySource: "v3_daily_check_in",
      channel: "daily_outbound",
      activeCommitmentId: "c1",
      effectiveAsk: "30 min focus",
      northStarMeta: ns.meta,
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.skipReason).toBe("no_safe_v3_voice");
    expect(r.body).toBe("");
    expect(r.blockedReasons).toEqual(expect.arrayContaining(["north_star_requires_v3_repair"]));
    expect(r.emergencyFallbackUsed).toBe(false);
    expect(r.metadata.v3_emergency_fallback_used).toBe(false);
  });

  it("fail-closed daily: explicit requires_v3_repair meta yields no send when repair unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Did you get in that focused work session today without distractions?",
      replySource: "v3_daily_check_in",
      channel: "daily_outbound",
      activeCommitmentId: "c1",
      effectiveAsk: "Focused on work without distractions",
      normalCoaching: true,
      northStarMeta: {
        source: "rewritten",
        blockedReasons: ["daily_outbound_final_quality"],
        requires_v3_repair: true,
      },
    });
    expect(r.shouldSend).toBe(false);
    expect(r.skipReason).toBe("no_safe_v3_voice");
    expect(r.body).toBe("");
    expect(r.blockedReasons).toEqual(expect.arrayContaining(["north_star_requires_v3_repair"]));
    expect(r.emergencyFallbackUsed).toBe(false);
  });

  it("fail-closed applies to reactivation daily channel with active commitment", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "You made a comeback yesterday! Did Focused on work without distractions happen today?",
      replySource: "v3_daily_check_in",
      channel: "reactivation",
      activeCommitmentId: "c1",
      effectiveAsk: "Focused on work without distractions",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
    expect(r.emergencyFallbackUsed).toBe(false);
  });

  it("no active commitment path still sends deterministic body unchanged", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Reminder: your subscription renews soon.",
      replySource: "deterministic_human",
      channel: "daily_outbound",
      normalCoaching: false,
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toContain("subscription renews");
    expect(r.voiceOwner).toBe("no_active_commitment");
  });

  it("adds voice owner metadata", async () => {
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Fair. What time tomorrow?",
      replySource: "v3_refined_prior_draft",
      channel: "inbound_coach_reply",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });

    expect(r.metadata).toMatchObject({
      voice_owner: "v3_machine_refine",
      final_voice_source: "v3_refined_prior_draft",
      v3_finalized: true,
      v3_emergency_fallback_used: false,
    });
  });

  it("does not force compliance or onboarding consent through V3", async () => {
    const compliance = await applyFinalVoiceOwnershipGate({
      proposedBody: "Reply STOP to opt out. Reply HELP for help.",
      replySource: "twilio_compliance",
      channel: "other_coaching",
      bypassKind: "compliance",
    });
    const consent = await applyFinalVoiceOwnershipGate({
      proposedBody: "You agree to receive recurring SMS messages.",
      replySource: "onboarding",
      channel: "other_coaching",
      bypassKind: "onboarding_consent",
    });

    expect(compliance.shouldSend).toBe(true);
    expect(consent.shouldSend).toBe(true);
    expect(compliance.voiceOwner).toBe("compliance");
    expect(consent.voiceOwner).toBe("onboarding_consent");
  });

  it("preserves compliance suffix after a blocked weekly fallback body", async () => {
    delete process.env.OPENAI_API_KEY;
    const suffix = "Reply STOP to opt out. Reply HELP for help.";
    const gated = await applyFinalVoiceOwnershipGate({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      replySource: "deterministic_human",
      channel: "weekly_sms",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    const finalBody = appendPreservedSmsSuffix(gated.body, suffix);

    expect(finalBody.endsWith(suffix)).toBe(true);
    expect(finalBody.toLowerCase()).not.toContain("say it straight");
  });

  it("preserves signed links after rescue/winback fallback body", async () => {
    delete process.env.OPENAI_API_KEY;
    const link = "https://example.com/rescue?t=signed-token";
    const gated = await applyFinalVoiceOwnershipGate({
      proposedBody: "Great job on your journey. Keep momentum because",
      replySource: "deterministic_human",
      channel: "inactivity_rescue",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    const finalBody = appendPreservedSignedLink(gated.body, link);

    expect(finalBody.endsWith(link)).toBe(true);
    expect(finalBody.toLowerCase()).not.toContain("journey");
    expect(finalBody.toLowerCase()).not.toContain("momentum");
  });
});
