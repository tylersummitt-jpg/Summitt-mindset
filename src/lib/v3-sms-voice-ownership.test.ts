import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

const repairCreateMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  __esModule: true,
  default: class MockOpenAI {
    chat = {
      completions: {
        create: repairCreateMock,
      },
    };
  },
}));

import { computeRecommitBindingText } from "./v2-adaptive-contract";
import { finalizeNorthStarCoachSms } from "./north-star-coach-sms";
import {
  appendPreservedSignedLink,
  appendPreservedSmsSuffix,
  applyFinalVoiceOwnershipGate,
  detectFinalVoiceBlockedReasons,
  detectRelationshipCoachingVoiceBlockedReasons,
  isRepairableFinalVoiceBlockedReason,
  partitionFinalVoiceBlockedReasons,
  repairV3RelationshipLaneBodyWithOpenAI,
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

  it("its_good: allows natural reentry warmth (to see/hear/have you)", () => {
    expect(
      detectFinalVoiceBlockedReasons(
        "It's good to see you back, Anne! To improve your consistency this week, what specific changes will you implement in your workout schedule or daily activities?"
      )
    ).not.toContain("its_good");
    expect(
      detectFinalVoiceBlockedReasons("It's good to hear from you — what's one win from today?")
    ).not.toContain("its_good");
    expect(
      detectFinalVoiceBlockedReasons("It's good to have you back. Did you get the bar done today?")
    ).not.toContain("its_good");
  });

  it("its_good: still blocks canned or broken It's Good opener fragments", () => {
    expect(detectFinalVoiceBlockedReasons("It's Good. What is one change you'll make this week?")).toContain(
      "its_good"
    );
    expect(detectFinalVoiceBlockedReasons("It's good! That's a solid start.")).toContain("its_good");
    expect(detectFinalVoiceBlockedReasons("It's Good — what moved with today's line?")).toContain("its_good");
  });

  it("flags robotic Reply YES/NO contract menu language", () => {
    expect(
      detectRelationshipCoachingVoiceBlockedReasons("Reply YES to confirm or NO to discard.")
    ).toContain("reply_yes_no_menu_language");
    expect(
      detectRelationshipCoachingVoiceBlockedReasons("Reply YES to commit or NO to pause.")
    ).toContain("reply_yes_no_menu_language");
    expect(
      detectRelationshipCoachingVoiceBlockedReasons("Reply YES or NO if that works.")
    ).toContain("reply_yes_no_menu_language");
    expect(
      detectRelationshipCoachingVoiceBlockedReasons(
        "Same commitment—keep this line for 7 days: Focused on work without distractions."
      )
    ).toContain("same_commitment_keep_this_line_robot_copy");
    expect(
      detectRelationshipCoachingVoiceBlockedReasons(
        "Same focus—keep this line for 7 days: Focused on work without distractions."
      )
    ).toContain("same_commitment_keep_this_line_robot_copy");
    expect(detectRelationshipCoachingVoiceBlockedReasons("Keep this line for 7 days.")).toContain(
      "same_commitment_keep_this_line_robot_copy"
    );
  });

  it("allows exact binding once when bindingVerbatim is provided", () => {
    const binding = computeRecommitBindingText("Focused on work without distractions");
    const body = `Let's make this simple. ${binding} Want to keep this bar for the week?`;
    const reasons = detectRelationshipCoachingVoiceBlockedReasons(body, { bindingVerbatim: binding });
    expect(reasons).not.toContain("same_commitment_keep_this_line_robot_copy");
    expect(reasons).not.toContain("robotic_contract_menu_language");
  });

  it("still blocks duplicate binding or robot phrases outside the binding window", () => {
    const binding = computeRecommitBindingText("Call one person each day");
    const duplicateBinding = `${binding} ${binding}`;
    expect(
      detectRelationshipCoachingVoiceBlockedReasons(duplicateBinding, { bindingVerbatim: binding })
    ).toContain("same_commitment_keep_this_line_robot_copy");

    const outsideRobot = `Keep this line for 7 days. ${binding}`;
    expect(
      detectRelationshipCoachingVoiceBlockedReasons(outsideRobot, { bindingVerbatim: binding })
    ).toContain("same_commitment_keep_this_line_robot_copy");

    const menuOutside = `${binding} Reply YES to confirm or NO to discard.`;
    expect(
      detectRelationshipCoachingVoiceBlockedReasons(menuOutside, { bindingVerbatim: binding })
    ).toContain("reply_yes_no_menu_language");
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

  it("treats robotic consent menu reasons as repairable", () => {
    const p = partitionFinalVoiceBlockedReasons([
      "reply_yes_no_menu_language",
      "generic_rep_happen_ask",
    ]);
    expect(p.repairable).toEqual(["reply_yes_no_menu_language"]);
    expect(p.hard).toEqual(["generic_rep_happen_ask"]);
    expect(isRepairableFinalVoiceBlockedReason("reply_yes_no_menu_language")).toBe(true);
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

  it("allows contract SMS with binding once when bindingVerbatim is provided", async () => {
    const binding = computeRecommitBindingText("I will text or call each day");
    const body = `Here's the line. ${binding} Want to keep this bar for the week?`;
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: body,
      replySource: "v3_daily_relationship_lane",
      channel: "contract_prompt",
      activeCommitmentId: "c1",
      effectiveAsk: "I will text or call each day",
      normalCoaching: true,
      bindingVerbatim: binding,
    });
    expect(r.shouldSend).toBe(true);
    expect(r.body).toBe(body);
    expect(r.blockedReasons).not.toContain("same_commitment_keep_this_line_robot_copy");
  });

  it("blocks legacy robot binding phrase without bindingVerbatim", async () => {
    delete process.env.OPENAI_API_KEY;
    const legacy =
      "Same commitment—keep this line for 7 days: Focused on work without distractions.";
    const r = await applyFinalVoiceOwnershipGate({
      proposedBody: legacy,
      replySource: "v3_daily_relationship_lane",
      channel: "contract_prompt",
      activeCommitmentId: "c1",
      effectiveAsk: "Focused on work without distractions",
      normalCoaching: true,
    });
    expect(r.shouldSend).toBe(false);
    expect(r.blockedReasons.some((b) => b.includes("same_commitment_keep_this_line_robot_copy"))).toBe(
      true
    );
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

describe("repairV3RelationshipLaneBodyWithOpenAI memory repeat V2", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    repairCreateMock.mockReset();
  });

  it("returns null when memory repeat repair used_strategy is missing", async () => {
    repairCreateMock.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ body: "Protected, partial, or missed?" }) } }],
    });
    const r = await repairV3RelationshipLaneBodyWithOpenAI({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      originalBody: "What nurturing action can you take today?",
      blockedReasons: ["memory_repeat_question"],
      factsJson: {},
      memoryRepeatRepairContext: {
        prior_outbound_full_body: null,
        blocked_candidate_body: "What nurturing action can you take today?",
        repeated_question: "What nurturing action can you take?",
        repeated_phrases: [],
        latest_user_answer: null,
        accountability_purpose: "Self-care",
        suggested_coaching_move: null,
        repeat_violation_reason: "repeated_recent_question",
        recommended_repair_strategy: "binary_truth_check",
        forbidden_coaching_frames: ["What nurturing action can you take?"],
        strategy_examples: ["Protected, partial, or missed?"],
      },
    });
    expect(r).toBeNull();
  });

  it("returns null when forcedRepairStrategy does not match used_strategy", async () => {
    repairCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "What got in the way today?",
              used_strategy: "barrier_check",
            }),
          },
        },
      ],
    });
    const r = await repairV3RelationshipLaneBodyWithOpenAI({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      originalBody: "What nurturing action can you take today?",
      blockedReasons: ["memory_repeat_question"],
      factsJson: {},
      forcedRepairStrategy: "binary_truth_check",
      memoryRepeatRepairContext: {
        prior_outbound_full_body: null,
        blocked_candidate_body: "What nurturing action can you take today?",
        repeated_question: "What nurturing action can you take?",
        repeated_phrases: [],
        latest_user_answer: null,
        accountability_purpose: "Self-care",
        suggested_coaching_move: null,
        repeat_violation_reason: "repeated_recent_question",
        recommended_repair_strategy: "binary_truth_check",
        forbidden_coaching_frames: [],
        strategy_examples: ["Protected, partial, or missed?"],
      },
    });
    expect(r).toBeNull();
  });

  it("accepts valid strict enum repair and includes structured context in user payload", async () => {
    repairCreateMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              body: "Protected, partial, or missed on the distribution block today?",
              used_strategy: "binary_truth_check",
            }),
          },
        },
      ],
    });
    const ctx = {
      prior_outbound_full_body: "Enjoy your hike!",
      blocked_candidate_body: "How did your hike go?",
      repeated_question: "Enjoy your hike!",
      repeated_phrases: ["Enjoy your hike!"],
      latest_user_answer: null,
      accountability_purpose: "Hike weekly",
      suggested_coaching_move: null,
      repeat_violation_reason: "repeated_recent_question",
      recommended_repair_strategy: "binary_truth_check" as const,
      forbidden_coaching_frames: ["How did your hike go?"],
      strategy_examples: ["Protected, partial, or missed?"],
    };
    const r = await repairV3RelationshipLaneBodyWithOpenAI({
      routeKind: "daily",
      routePurpose: "main_active_accountability",
      originalBody: "How did your hike go?",
      blockedReasons: ["memory_repeat_question"],
      factsJson: { commitment: { behavior_statement: "Hike weekly" } },
      memoryRepeatRepairContext: ctx,
    });
    expect(r?.body).toMatch(/Protected, partial, or missed/i);
    expect(r?.metadata.repeat_repair_strategy).toBe("binary_truth_check");
    const userMessage = repairCreateMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string;
    expect(userMessage).toMatch(/MEMORY_REPEAT_REPAIR_CONTEXT_JSON/);
    expect(userMessage).toMatch(/Enjoy your hike/);
  });
});
