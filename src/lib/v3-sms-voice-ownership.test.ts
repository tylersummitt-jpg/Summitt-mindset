import { afterEach, describe, expect, it } from "vitest";

import { finalizeNorthStarCoachSms } from "./north-star-coach-sms";
import {
  appendPreservedSignedLink,
  appendPreservedSmsSuffix,
  applyFinalVoiceOwnershipGate,
  detectFinalVoiceBlockedReasons,
  isRepairableFinalVoiceBlockedReason,
  partitionFinalVoiceBlockedReasons,
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

  it("flags empty or trivial bodies for fail-closed routing", () => {
    expect(detectFinalVoiceBlockedReasons("")).toContain("empty_or_trivial_body");
    expect(detectFinalVoiceBlockedReasons(" ")).toContain("empty_or_trivial_body");
  });

  it("rejects structural -in: leak and generic rep-happen fallback", () => {
    expect(detectFinalVoiceBlockedReasons("Hey Brooke, -in: Did you organize that drawer today?")).toContain(
      "structural_role_leak"
    );
    expect(detectFinalVoiceBlockedReasons("Did the rep happen today?")).toContain("generic_rep_happen_ask");
  });

  it("rejects generic day-reminder reset copy", () => {
    expect(
      detectFinalVoiceBlockedReasons(
        "Hope you're having a great day! Just wanted to remind you to take a moment to appreciate someone who's been there for you."
      )
    ).toContain("generic_day_reminder_reset");
  });

  it("flags malformed Did raw phrase happen today", () => {
    expect(detectFinalVoiceBlockedReasons("Did Focus on process happen today?")).toContain(
      "malformed_did_raw_phrase_happen_today"
    );
    expect(detectFinalVoiceBlockedReasons("You made a comeback yesterday! Did Focused on work without distractions happen today?")).toContain(
      "malformed_did_raw_phrase_happen_today"
    );
  });

  it("does not add too_many_sentences for 3–4 short sentences under 480 chars", () => {
    const three =
      "Hi Alex. Great work today. What is one small win you want to lock before noon?";
    const four =
      "Hi Alex. Great work today. I heard you on the calls. What is one small win you want to lock before noon?";
    expect(detectFinalVoiceBlockedReasons(three)).not.toContain("too_many_sentences");
    expect(detectFinalVoiceBlockedReasons(four)).not.toContain("too_many_sentences");
  });

  it("adds too_many_sentences for 5+ sentence endings under 480 chars", () => {
    const five = "A. B. C. D. E.";
    expect(detectFinalVoiceBlockedReasons(five)).toContain("too_many_sentences");
  });

  it("adds too_many_sentences in 480–600 char band and over 600 chars", () => {
    const band = "x".repeat(500);
    expect(detectFinalVoiceBlockedReasons(band)).toContain("too_many_sentences");
    expect(detectFinalVoiceBlockedReasons(band)).toContain("too_long");
    const long = "y".repeat(620);
    expect(detectFinalVoiceBlockedReasons(long)).toContain("too_many_sentences");
    expect(detectFinalVoiceBlockedReasons(long)).toContain("too_long");
  });

  it("adds too_many_sentences for obvious adjacent word stutter under 480 chars", () => {
    expect(detectFinalVoiceBlockedReasons("That sounds really really hard.")).toContain("too_many_sentences");
  });

  it("May 14-style gratitude SMS still hits repairable phrase gate without too_many from sentence count alone", () => {
    const may14 =
      "As you reflect on your day, who did you thank for being present? Sharing that gratitude can really strengthen your connections. Let me know how it went!";
    const reasons = detectFinalVoiceBlockedReasons(may14);
    expect(reasons).toContain("let_me_know_how_it_went");
    expect(reasons).not.toContain("too_many_sentences");
  });

  it("does not treat contractions or empathetic paraphrase as long_user_quote (double-quote span only)", () => {
    expect(
      detectFinalVoiceBlockedReasons(
        "It sounds like you're feeling really overwhelmed right now, Angel. What is one tiny next step?"
      )
    ).not.toContain("long_user_quote");
    expect(
      detectFinalVoiceBlockedReasons(
        "I see you're facing challenges during other exercises and that can throw the rhythm. What feels most doable next?"
      )
    ).not.toContain("long_user_quote");
  });

  it("long_user_quote fires on a long span inside ASCII double quotes (verbatim user echo)", () => {
    const longEcho =
      'Thanks for sharing. When you said "I need to step back from everything for a while and reset my priorities completely" I heard you. What is one boundary you want tonight?';
    expect(detectFinalVoiceBlockedReasons(longEcho)).toContain("long_user_quote");
  });

  it("did_you_manage is a detector hit for normal accountability wording", () => {
    expect(
      detectFinalVoiceBlockedReasons("Welcome back, Angel! Did you manage to make the calls as planned at 2 PM?")
    ).toContain("did_you_manage");
  });
});

describe("partitionFinalVoiceBlockedReasons", () => {
  it("splits allowlisted repairable reasons from hard reasons", () => {
    const p = partitionFinalVoiceBlockedReasons(["too_many_sentences", "generic_rep_happen_ask", "let_me_know_how_it_went"]);
    expect(p.repairable).toEqual(["too_many_sentences", "let_me_know_how_it_went"]);
    expect(p.hard).toEqual(["generic_rep_happen_ask"]);
  });

  it("treats unknown detector tokens as hard", () => {
    const p = partitionFinalVoiceBlockedReasons(["say_it_straight", "great_job"]);
    expect(p.repairable).toEqual(["great_job"]);
    expect(p.hard).toEqual(["say_it_straight"]);
  });

  it("isRepairableFinalVoiceBlockedReason matches partition allowlist", () => {
    expect(isRepairableFinalVoiceBlockedReason("too_long")).toBe(true);
    expect(isRepairableFinalVoiceBlockedReason("journey")).toBe(true);
    expect(isRepairableFinalVoiceBlockedReason("did_you_manage")).toBe(true);
    expect(isRepairableFinalVoiceBlockedReason("structural_role_leak")).toBe(false);
  });

  it("partitions did_you_manage as repairable while malformed raw Did… happen stays hard", () => {
    const p = partitionFinalVoiceBlockedReasons(["did_you_manage", "malformed_did_raw_phrase_happen_today"]);
    expect(p.repairable).toEqual(["did_you_manage"]);
    expect(p.hard).toEqual(["malformed_did_raw_phrase_happen_today"]);
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

  it("v3_voice_repair replySource maps to v3_repair voice owner when clean", async () => {
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Locked in for tomorrow morning.",
      replySource: "v3_voice_repair",
      channel: "inbound_coach_reply",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(true);
    expect(r.voiceOwner).toBe("v3_repair");
    expect(r.metadata.final_voice_owner).toBe("v3_repair");
  });

  it("fail-closed inbound: does not use deterministic emergency fallback when repair unavailable", async () => {
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

    expect(r.shouldSend).toBe(false);
    expect(r.skipReason).toBe("no_safe_v3_voice");
    expect(r.body).toBe("");
    expect(r.emergencyFallbackUsed).toBe(false);
    expect(r.metadata.twilio_send_attempted).toBe(false);
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

  it("preserves compliance suffix when weekly body is accepted after the gate", async () => {
    delete process.env.OPENAI_API_KEY;
    const suffix = "Reply STOP to opt out. Reply HELP for help.";
    const gated = await applyFinalVoiceOwnershipGate({
      proposedBody: "Pat Pause — one honest line: what felt most true about your week?",
      replySource: "v3_weekly_proof_refined",
      channel: "weekly_sms",
      activeCommitmentId: "c1",
      effectiveAsk: "30 min focus",
      normalCoaching: true,
    });
    expect(gated.shouldSend).toBe(true);
    const finalBody = appendPreservedSmsSuffix(gated.body, suffix);
    expect(finalBody).toContain("Pat Pause");
    expect(finalBody.endsWith(suffix)).toBe(true);
  });

  it("weekly_sms unsafe non-V3 copy: shouldSend false (routes must not append footer or send)", async () => {
    delete process.env.OPENAI_API_KEY;
    const gated = await applyFinalVoiceOwnershipGate({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      replySource: "deterministic_human",
      channel: "weekly_sms",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(gated.shouldSend).toBe(false);
    expect(gated.body).toBe("");
    expect(gated.skipReason).toBe("no_safe_v3_voice");
    expect(gated.metadata.should_send).toBe(false);
    expect(gated.metadata.skip_reason).toBe("no_safe_v3_voice");
  });

  it("followup_sms unsafe non-V3 copy: shouldSend false", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      replySource: "deterministic_human",
      channel: "followup_sms",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
  });

  it("missed_yesterday_sms unsafe non-V3 copy: shouldSend false", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      replySource: "deterministic_human",
      channel: "missed_yesterday_sms",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
  });

  it("inactivity_rescue unsafe non-V3 copy: shouldSend false", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Great job on your journey. Keep momentum because",
      replySource: "deterministic_human",
      channel: "inactivity_rescue",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
  });

  it("post_churn_winback unsafe non-V3 copy: shouldSend false", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Great job on your journey. Keep momentum because",
      replySource: "deterministic_human",
      channel: "post_churn_winback",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
  });

  it("guided_contract_proposal unsafe non-V3 copy: shouldSend false", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      replySource: "deterministic_human",
      channel: "guided_contract_proposal",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
  });

  it("memory_confirmation channel is fail-closed for unsafe non-V3 copy", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      replySource: "deterministic_human",
      channel: "memory_confirmation",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.body).toBe("");
  });

  it("appends signed rescue link only when gate accepts body", async () => {
    delete process.env.OPENAI_API_KEY;
    const link = "https://example.com/rescue?t=signed-token";
    const gated = await applyFinalVoiceOwnershipGate({
      proposedBody: "Quick check-in — want a smaller version tomorrow?",
      replySource: "v3_inactivity_rescue_refined",
      channel: "inactivity_rescue",
      activeCommitmentId: "c1",
      effectiveAsk: "focus block",
      normalCoaching: true,
    });
    expect(gated.shouldSend).toBe(true);
    const finalBody = appendPreservedSignedLink(gated.body, link);
    expect(finalBody.endsWith(link)).toBe(true);
  });

  it("north_star deterministic_minimal meta blocks even clean V3-looking body until repair (no send without repair)", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: "That counts. What made it work?",
      replySource: "v3_sms_brain",
      channel: "inbound_coach_reply",
      activeCommitmentId: "c1",
      effectiveAsk: "dictate one story",
      normalCoaching: true,
      northStarMeta: {
        source: "deterministic_minimal",
        blockedReasons: [],
      },
    });
    expect(r.shouldSend).toBe(false);
    expect(r.blockedReasons).toEqual(expect.arrayContaining(["north_star_deterministic_replacement"]));
  });
});
