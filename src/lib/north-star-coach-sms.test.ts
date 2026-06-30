import { describe, expect, it } from "vitest";
import {
  buildDailyCommitmentAsk,
  deriveFutureIntentHint,
  detectBrokenMicroEditArtifacts,
  detectBrokenMicroEditReason,
  finalizeNorthStarCoachSms,
  finalizeNorthStarCoachSmsPreservingSuffix,
  inboundSignalsCompletion,
  isV3RelationshipVoiceReplySource,
  matchesMalformedDidRawPhraseHappenToday,
  pickNorthStarWriterAttributionFields,
} from "./north-star-coach-sms";

const SAMPLE_COMPLIANCE_FOOTER = "Reply STOP to opt out. Reply HELP for help.";

describe("isV3RelationshipVoiceReplySource", () => {
  it("treats v3_voice_repair and refined sources as protected V3 relationship voice", () => {
    expect(isV3RelationshipVoiceReplySource("v3_voice_repair")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_daily_relationship_lane")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_inbound_relationship_lane")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_sms_brain")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_daily_check_in")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_answer_to_open_question")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_daily_deterministic_fallback")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_some_topic_refined")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_weekly_relationship_lane")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("v3_weekly_proof_refined")).toBe(true);
    expect(isV3RelationshipVoiceReplySource("deterministic_human")).toBe(false);
  });
});

describe("inboundSignalsCompletion", () => {
  it("treats sure did as completion", () => {
    expect(inboundSignalsCompletion("Sure did!")).toBe(true);
  });
  it("treats I have!! as completion", () => {
    expect(inboundSignalsCompletion("I have!!")).toBe(true);
  });
  it("treats yes already as completion", () => {
    expect(inboundSignalsCompletion("Yes already")).toBe(true);
  });
});

describe("finalizeNorthStarCoachSms", () => {
  it("tomorrow plan answer must not re-ask today completion", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "Tyler, great to hear you're planning for two hours tomorrow! Did you complete the hour of distribution today? Check the app for updates if you need to adjust your plan.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I am going to do two hours tomorrow. I got this.",
      latestOutboundBody: "What's your plan for the 1 hour of distribution tomorrow?",
      behaviorStatement: "Distribution",
      effectiveAskText: "1 hour distribution",
      finalEventType: "user_yes",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you complete");
    expect(r.visibleBody.toLowerCase()).not.toContain("today?");
    expect(r.visibleBody.toLowerCase()).not.toContain("check the app");
    expect(r.visibleBody.toLowerCase()).toContain("tomorrow");
  });

  it("completion context rewrites duplicate today ask", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did you get that done today?",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I got it done!",
      latestOutboundBody: "That's logged as done. That's proof.",
      finalEventType: "user_yes",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you get that done");
  });

  it("strips app deflection coaching lines", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Check the app for updates if you need to adjust your plan.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "ok",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("check the app");
    expect(r.visibleBody.toLowerCase()).not.toContain("adjust your plan");
  });

  it("cleans daily outbound reminder clichés", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Quick check: did you get a chance to finish the block today?",
      channel: "daily_outbound",
      behaviorStatement: "Focus work",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("quick check");
    expect(r.visibleBody.toLowerCase()).not.toContain("did you get a chance");
  });

  it("rewrites did it happen with daily opener even without a question mark", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "Did it happen with I want to keep a clear and accurate big picture mindset",
      channel: "daily_outbound",
      effectiveAskText: "big picture mindset",
      behaviorStatement: "I want to keep a clear and accurate big picture mindset",
    });
    expect(r.visibleBody.toLowerCase()).toContain("big-picture mindset");
    expect(r.visibleBody.toLowerCase()).not.toContain("did it happen with");
  });

  it("softens heavy recommit jargon", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Recommit to this for 7 days at the same bar.",
      channel: "contract_prompt",
      behaviorStatement: "Training",
      effectiveAskText: "30 minutes",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("recommit to this for 7 days");
  });

  it("contract_prompt preserves server standard binding inside verbatim line (no same-focus rewrite)", () => {
    const binding = "This is the standard for the next 7 days: I will text or call each day.";
    const r = finalizeNorthStarCoachSms({
      proposedBody: `Here's the line. ${binding} Reply YES or NO?`,
      channel: "contract_prompt",
      behaviorStatement: "I will text or call each day",
      effectiveAskText: binding,
    });
    expect(r.visibleBody).toContain("This is the standard for the next 7 days");
    expect(r.visibleBody).not.toMatch(/same focus—keep this line for 7 days:\s*same focus/i);
  });

  it("weekly Pat Pause keeps STOP/HELP footer untouched", () => {
    const raw = `Time for a Pat Pause.\n\nQuick check: did you show up?\n\n${SAMPLE_COMPLIANCE_FOOTER}`;
    const r = finalizeNorthStarCoachSmsPreservingSuffix({
      proposedFullBody: raw,
      suffixToPreserve: SAMPLE_COMPLIANCE_FOOTER,
      channel: "weekly_sms",
      preserveNewlines: true,
    });
    expect(r.visibleBody.endsWith(SAMPLE_COMPLIANCE_FOOTER)).toBe(true);
    expect(r.visibleBody.toLowerCase()).not.toContain("quick check");
  });

  it("followup channel removes robotic quick-check phrasing when present", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Quick check — you still in?",
      channel: "followup_sms",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("quick check");
  });

  it("contextPacket todayCompleted avoids duplicate today ask without explicit finalEventType", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did you get that done today?",
      channel: "inbound_coach_reply",
      latestInboundRaw: "thinking about tomorrow",
      contextPacket: { todayCompleted: true, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you get that done");
  });

  it("daily outbound flavor uses one clean ask when proposed is thin", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "short",
      channel: "daily_outbound",
      contextPacket: { effectiveAskText: "30 minutes of focused reps", source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).toContain("30 minutes");
    expect(r.visibleBody.toLowerCase()).toMatch(/did .*happen|did you dictate/);
    expect(r.visibleBody).toMatch(/\?$/);
  });

  it("repeat-kill / structural: proposed coach reply must not echo the same question after the user answered", () => {
    const q = "What's the smallest honest next step you can still do today - 10 minutes or less?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: `Got it. ${q}`,
      channel: "inbound_coach_reply",
      latestInboundRaw: "It's late so I'll have to get it done tomorrow",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("smallest honest");
    expect(
      r.meta.blockedReasons.includes("structural_guard_rewrite") ||
        r.meta.repeated_question_guard_fired === true
    ).toBe(true);
  });

  it("repeat-kill fires when structural guards do not apply", () => {
    const q = "What's the real blocker — time, energy, or avoidance?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Mostly energy.",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toBe(q.toLowerCase());
    expect(r.meta.repeated_question_guard_fired).toBe(true);
  });

  it("does not rewrite readable did-you-manage focused work copy into Did <fragment> happen today", () => {
    const proposedBody =
      "You made a comeback yesterday! Did you manage to get in that focused work session today without distractions?";
    const r = finalizeNorthStarCoachSms({
      proposedBody,
      channel: "daily_outbound",
      effectiveAskText: "Focused on work without distractions",
      behaviorStatement: "I will stay focused on work without distractions",
      contextPacket: { source: "test" },
    });
    expect(r.visibleBody).toContain("Did you get in that focused work session today without distractions");
    expect(r.visibleBody.toLowerCase()).not.toContain("did focused on work without distractions happen");
    expect(matchesMalformedDidRawPhraseHappenToday(r.visibleBody)).toBe(false);
  });

  it("v3 daily: did_you_manage_scrub preserves OpenAI body and requires repair (no deterministic rewrite)", () => {
    const proposedBody =
      "You made a comeback yesterday! Did you manage to get in that focused work session today without distractions?";
    const r = finalizeNorthStarCoachSms({
      proposedBody,
      channel: "daily_outbound",
      replySource: "v3_daily_check_in",
      effectiveAskText: "Focused on work without distractions",
      behaviorStatement: "I will stay focused on work without distractions",
      contextPacket: { source: "test" },
    });
    expect(r.visibleBody).toBe(proposedBody);
    expect(r.visibleBody).toContain("Did you manage to get in that focused work session");
    expect(r.visibleBody.toLowerCase()).not.toContain("did focused on work without distractions happen");
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["did_you_manage_requires_v3_repair"])
    );
    expect(matchesMalformedDidRawPhraseHappenToday(r.visibleBody)).toBe(false);
  });

  it("v3 daily: how-did-your + did-you-manage essay does not become buildDailyCommitmentAsk; flags requires_v3_repair", () => {
    const proposedBody = "How did your focus go today and did you manage to finish the block?";
    const r = finalizeNorthStarCoachSms({
      proposedBody,
      channel: "daily_outbound",
      replySource: "v3_daily_check_in",
      effectiveAskText: "30 min focus",
      behaviorStatement: "Focus",
      contextPacket: { source: "test" },
    });
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.visibleBody.toLowerCase()).toContain("how did your focus");
    expect(r.visibleBody.toLowerCase()).not.toBe("did you dictate one story today?");
  });

  it("v3 inbound: repeat-kill does not inject intentRecovery paragraph; flags requires_v3_repair", () => {
    const q = "Did you take a moment to thank someone for being present today?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      replySource: "v3_sms_brain",
      latestInboundRaw: "I have!!",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.repeated_question_guard_fired).toBe(true);
    expect(r.visibleBody.toLowerCase()).toContain("thank someone");
    expect(r.visibleBody.toLowerCase()).not.toContain("that counts if you say it does");
  });

  it("v3_voice_repair: scrub collapse does not inject Did the rep happen today bank", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "@@@",
      channel: "daily_outbound",
      replySource: "v3_voice_repair",
      effectiveAskText: "30 min focus",
      behaviorStatement: "Focus",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did the rep happen today");
    expect(r.meta.requires_v3_repair).toBe(true);
  });

  it("v3 daily: scrub collapse does not use buildDailyCommitmentAsk as final bank", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "@@@",
      channel: "daily_outbound",
      replySource: "v3_daily_check_in",
      effectiveAskText: "30 min focus block",
      behaviorStatement: "Focus",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you protect");
    expect(r.visibleBody.toLowerCase()).not.toContain("did the rep happen today");
    expect(r.meta.requires_v3_repair).toBe(true);
  });

  it("exposes writer attribution fields for telemetry merge", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Great job on your journey today!",
      channel: "daily_outbound",
      contextPacket: { source: "test", effectiveAskText: "reps" },
    });
    expect(Array.isArray(r.meta.voice_writer_chain)).toBe(true);
    expect(r.meta.voice_writer_chain).toContain("final_voice_gate");
    expect(r.meta.north_star_rewrite_type).toBeDefined();
    const picked = pickNorthStarWriterAttributionFields(r.meta);
    expect(picked.voice_writer_chain).toEqual(r.meta.voice_writer_chain);
    expect(picked.north_star_rewrite_type).toBe(r.meta.north_star_rewrite_type);
  });

  it("daily outbound scrubs did you manage essay phrasing", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "How did your focus go today and did you manage to finish the block?",
      channel: "daily_outbound",
      contextPacket: { effectiveAskText: "30 min focus", behaviorStatement: "Focus", source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did you manage");
  });

  it("rewrites malformed Did it happen with + behavior_statement stitching", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did it happen with I want to keep a clear mindset today?",
      channel: "daily_outbound",
      effectiveAskText: "protect 30 min workout",
      behaviorStatement: "I want to keep a clear mindset",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("did it happen with");
    expect(r.visibleBody.toLowerCase()).toContain("30 min workout");
    expect(r.visibleBody.toLowerCase()).not.toContain("did protect");
  });

  it("fixes Let's Did contraction", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Hey Nate! Let's Did you protect 30 min daily workout today?",
      channel: "daily_outbound",
      effectiveAskText: "30 min daily workout",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("let's did");
  });

  it("scrubs broken It's Acknowledging lead-in", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "It's Acknowledging your needs is essential today.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I'm wiped.",
    });
    expect(r.visibleBody.startsWith("It's Acknowledging")).toBe(false);
    expect(r.visibleBody.toLowerCase()).toContain("acknowledging");
  });

  it("replaces Good morning when local hour is evening", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Good morning, Diane! Quick check — did you protect the rep?",
      channel: "daily_outbound",
      effectiveAskText: "the rep",
      localHour: 19,
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("good morning");
  });
  it("Hoover-like gratitude completion: strips vaping drift from bad draft", () => {
    const q = "Did you take a moment to thank someone for being present today?";
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "I see you've taken the time to acknowledge those around you. As you focus on cutting back on vaping, that awareness counts.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "I have!!",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("vap");
  });

  it("repeat kill after daily gratitude + I have!! does not emit Got it or next concrete move", () => {
    const q = "Did you take a moment to thank someone for being present today?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "I have!!",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("got it");
    expect(r.visibleBody.toLowerCase()).not.toContain("next concrete move");
  });

  it("emotional inbound repeat-kill avoids quote echo", () => {
    const q = "Did you protect the rep today?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Having an anxious morning",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain('got it — "');
    expect(r.visibleBody.toLowerCase()).not.toContain("…");
  });

  it("long proof inbound repeat-kill does not quote user text", () => {
    const q = "Did you thank your teams today?";
    const longProof =
      "I tried talking with all the teams today in a positive tone and thanked each member for all they do for our patients";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: longProof,
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody).not.toContain("I tried talking");
    expect(r.visibleBody.toLowerCase()).toContain("proof");
  });

  it("let me think repeat-kill avoids quote echo", () => {
    const q = "Want to lock tomorrow's block?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: q,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Let me think about it",
      latestOutboundBody: q,
      contextPacket: { latestOpenQuestion: q, source: "test" },
    });
    expect(r.visibleBody.toLowerCase()).not.toContain('got it');
    expect(r.visibleBody.toLowerCase()).not.toContain("next concrete move");
    expect(r.visibleBody.toLowerCase()).toContain("think");
  });

  it("broken transcript echo guard rewrites Got it quote draft", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: `Got it — "Let me think about it" — what's the next concrete move?`,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Let me think about it",
      latestOutboundBody: "What time works tomorrow?",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain('got it — "');
    expect(r.visibleBody.toLowerCase()).not.toContain("next concrete move");
  });

  it("daily rewrites Did you protect keep a clear… malformed opener", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Did you protect keep a clear and accurate big picture mindset. today?",
      channel: "daily_outbound",
      effectiveAskText: "Keep a clear and accurate big picture mindset",
    });
    expect(r.visibleBody.toLowerCase()).toContain("big-picture mindset");
  });

  it("daily rewrites Did you protect Use AI malformed opener", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "You're making strides! Did you protect Use AI & dictate at least one story today?",
      channel: "daily_outbound",
      effectiveAskText: "Use AI & dictate at least one story",
    });
    expect(r.visibleBody.toLowerCase()).toContain("dictate one story");
  });

  it("daily rewrites chopped part of the ending", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "Did you take a deep breath today and ask yourself if the situation is worth being anxious about? Remember, letting go of what you can't control is part of the",
      channel: "daily_outbound",
      effectiveAskText: "pause when anxious",
      behaviorStatement: "Take a breath when anxious",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("part of the");
    expect(r.visibleBody).toMatch(/\?$/);
  });

  it("maps common raw behavior statements to clean daily asks", () => {
    expect(buildDailyCommitmentAsk("say affirmation every day")).toBe("Did you say the affirmation today?");
    expect(buildDailyCommitmentAsk("declutter a little at a time")).toBe("Did you declutter one small area today?");
    expect(buildDailyCommitmentAsk("Focus on process")).toBe("Did you focus on the process today?");
    expect(buildDailyCommitmentAsk("reach out to your daughter")).toBe("Did you reach out to your daughter today?");
  });

  it("maps focused work without distractions to a readable daily ask, not Did <title> happen today", () => {
    expect(buildDailyCommitmentAsk("Focused on work without distractions")).toBe(
      "Did you get in that focused work session today without distractions?"
    );
  });

  it("hard-blocks malformed daily protect phrases", () => {
    const cases = [
      "Did you protect say affirmation every day today?",
      "Did you protect declutter a little at a time today?",
      "It's been a quiet stretch. Did you protect Focus on process today?",
      "Hey Diane, just checking in. Did you reach out to your daughter today? Keeping those connections alive is a great step forward.",
    ];

    for (const proposedBody of cases) {
      const r = finalizeNorthStarCoachSms({
        proposedBody,
        channel: "daily_outbound",
        effectiveAskText: "say affirmation every day",
      });
      expect(r.visibleBody).toBe("Did you say the affirmation today?");
      expect(r.visibleBody.toLowerCase()).not.toContain("did you protect say");
      expect(r.visibleBody.toLowerCase()).not.toContain("just checking in");
      expect(r.visibleBody.toLowerCase()).not.toContain("great step forward");
    }
  });

  it("removes Say it straight fallback from final inbound replies", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Say it straight — what moved with today's line, and what didn't?",
      channel: "inbound_coach_reply",
      latestInboundRaw: "Have early meetings so will do later",
      latestOutboundBody: "Did you protect the rep today?",
      effectiveAskText: "story dictation",
    });

    expect(r.visibleBody.toLowerCase()).not.toContain("say it straight");
    expect(r.visibleBody.toLowerCase()).not.toContain("what moved with today's line");
    expect(r.visibleBody.toLowerCase()).toContain("later");
  });

  it("scrubs broken It's That's grammar", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "It's That's a valuable skill.",
      channel: "inbound_coach_reply",
      latestInboundRaw: "Good learned to listen",
    });

    expect(r.visibleBody).toBe("That's a valuable skill.");
  });

  it("shortens long generic coaching paragraphs", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody:
        "Reflecting on that can help reinforce your commitment. As you move forward, consider how you can refine that process because it can really make a difference!",
      channel: "inbound_coach_reply",
      latestInboundRaw: "Yes, on her way to school. She's a teacher.",
      latestOutboundBody: "Did you reach out to your daughter today?",
      effectiveAskText: "reach out to daughter",
    });

    expect(r.visibleBody.length).toBeLessThan(120);
    expect(r.visibleBody.toLowerCase()).not.toContain("as you move forward");
    expect(r.visibleBody.toLowerCase()).not.toContain("really make a difference");
  });
});

const PRODUCTION_STAY_ON_TRACK_BODY =
  "As you think about your calls this week, how does it feel to stay on track with your plan? Would you like to keep this cadence for the next 7 days, ease up, or adjust your approach?";

describe("V3 relationship product jargon scrub (production regression)", () => {
  it("detectBrokenMicroEditReason catches feel-to-Would splice", () => {
    expect(
      detectBrokenMicroEditReason(
        "As you think about your calls this week, how does it feel to Would you like to keep this cadence?"
      )
    ).toBe("broken_micro_edit");
    expect(detectBrokenMicroEditArtifacts("how does it feel to Would you like")).toContain(
      "broken_micro_edit_feel_to_would"
    );
  });

  it("v3_daily_relationship_lane: does not destructive-delete stay on track into broken grammar", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: PRODUCTION_STAY_ON_TRACK_BODY,
      channel: "daily_outbound",
      replySource: "v3_daily_relationship_lane",
    });
    expect(r.visibleBody).not.toMatch(/feel to Would/i);
    expect(r.visibleBody).toBe(PRODUCTION_STAY_ON_TRACK_BODY);
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.north_star_rewrite_type).toBe("repair_required");
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["product_jargon_scrub", "product_jargon_requires_v3_repair"])
    );
    expect(r.meta.north_star_rewrote_body).toBe(false);
  });

  it("v3_inbound_relationship_lane: same non-destructive product jargon policy", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: PRODUCTION_STAY_ON_TRACK_BODY,
      channel: "inbound_coach_reply",
      replySource: "v3_inbound_relationship_lane",
    });
    expect(r.visibleBody).not.toMatch(/feel to Would/i);
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toContain("product_jargon_requires_v3_repair");
  });

  it("v3_weekly_relationship_lane: same non-destructive product jargon policy", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: PRODUCTION_STAY_ON_TRACK_BODY,
      channel: "weekly_sms",
      replySource: "v3_weekly_relationship_lane",
    });
    expect(r.visibleBody).not.toMatch(/feel to Would/i);
    expect(r.meta.requires_v3_repair).toBe(true);
  });

  it("non-V3 daily_outbound: legacy destructive stay-on-track scrub still applies", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: PRODUCTION_STAY_ON_TRACK_BODY,
      channel: "daily_outbound",
      effectiveAskText: "make sales calls",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("stay on track");
    expect(r.meta.blockedReasons).toContain("product_jargon_scrub");
    expect(r.meta.requires_v3_repair).toBeFalsy();
  });

  it("V3: flags broken_micro_edit and requires_v3_repair without shipping damaged copy as final", () => {
    const broken =
      "As you think about your calls this week, how does it feel to Would you like to keep this cadence?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: broken,
      channel: "daily_outbound",
      replySource: "v3_daily_relationship_lane",
    });
    expect(r.meta.blockedReasons).toContain("broken_micro_edit");
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.north_star_rewrite_type).toBe("repair_required");
    expect(r.visibleBody).toBe(broken);
  });
});

describe("V3 generalized destructive scrub policy", () => {
  const v3Daily = { replySource: "v3_daily_relationship_lane" as const, channel: "daily_outbound" as const };

  it("robot_motivation: V3 preserves journey clause and requires repair", () => {
    const body =
      "How did the call land? On your journey toward steady outreach, what felt true for you today?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody).toBe(body);
    expect(r.visibleBody.toLowerCase()).toContain("journey");
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["robot_motivation_scrub", "robot_motivation_requires_v3_repair"])
    );
    expect(r.visibleBody).not.toMatch(/journey\.?\s+Would/i);
  });

  it("wrong_temporal: V3 does not delete temporal clause", () => {
    const body = "Focus on the commitment first today — how did the rep feel?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody.toLowerCase()).toContain("focus on the commitment first");
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["wrong_temporal_scrub", "wrong_temporal_requires_v3_repair"])
    );
  });

  it("app_deflection: V3 does not delete check-the-app fragment", () => {
    const body = "Nice work today. Check the app when you want to tweak your plan — what felt hardest?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody.toLowerCase()).toContain("check the app");
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["app_deflection", "app_deflection_requires_v3_repair"])
    );
  });

  it("v3_open_answer: V3 requires repair instead of mid-sentence deletion", () => {
    const body = "Did you manage to dictate a story today, or did something else take priority?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: body,
      channel: "inbound_coach_reply",
      replySource: "v3_inbound_relationship_lane",
      contextPacket: { v3AnswerToOpenQuestion: true },
    });
    expect(r.visibleBody).toBe(body);
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["v3_open_answer_scrub", "v3_open_answer_requires_v3_repair"])
    );
  });

  it("daily_fluff: V3 requires repair instead of stripping fluff/journey", () => {
    const body =
      "Your commitment matters on this path — did you get in that focused work session today?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody.toLowerCase()).toContain("your commitment matters");
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["daily_outbound_final_quality", "daily_fluff_requires_v3_repair"])
    );
  });

  it("daily_strides: V3 preserves you're making strides and requires repair", () => {
    const body =
      "You're making strides on the calls — did you get in that focused work session today?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody).toBe(body);
    expect(r.visibleBody.toLowerCase()).toContain("making strides");
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["daily_strides_requires_v3_repair", "daily_outbound_final_quality_requires_v3_repair"])
    );
  });

  it("check_in_workflow: V3 preserves quick-check prefix and requires repair", () => {
    const body = "Quick check — how did your sales calls feel today?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody).toBe(body);
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining(["check_in_workflow_scrub", "check_in_workflow_requires_v3_repair"])
    );
  });

  it("daily_outbound_essay: V3 did you manage preserves body and requires repair", () => {
    const body =
      "With time being tight, did you manage to get in that focused work session today without distractions?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody).toBe(body);
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining([
        "daily_outbound_essay_scrub",
        "did_you_manage_requires_v3_repair",
        "with_time_tight_requires_v3_repair",
      ])
    );
  });

  it("daily_outbound_flavor: V3 quick check strip requires repair without mutating", () => {
    const body = "Today's check-in: how did the rep land for you?";
    const r = finalizeNorthStarCoachSms({ proposedBody: body, ...v3Daily });
    expect(r.visibleBody).toBe(body);
    expect(r.meta.requires_v3_repair).toBe(true);
    expect(r.meta.blockedReasons).toEqual(
      expect.arrayContaining([
        "daily_outbound_flavor",
        "daily_outbound_flavor_requires_v3_repair",
        "daily_outbound_flavor_quick_check_requires_v3_repair",
      ])
    );
  });

  it("detectBrokenMicroEditArtifacts: allowed lowercase phrases are not flagged", () => {
    for (const phrase of [
      "Tell me to what extent that landed for you.",
      "It can help to let go of the old story.",
      "What would it take to do this once today?",
    ]) {
      expect(detectBrokenMicroEditArtifacts(phrase)).toEqual([]);
      expect(detectBrokenMicroEditReason(phrase)).toBeNull();
    }
  });

  it("detectBrokenMicroEditArtifacts: catches journey.Would and on-this-dot-Would splices", () => {
    expect(detectBrokenMicroEditArtifacts("On your journey. Would you try again?")).toContain(
      "broken_micro_edit_journey_would"
    );
    expect(detectBrokenMicroEditArtifacts("Stay on this . Would that work?")).toContain(
      "broken_micro_edit_on_this_dot_would"
    );
  });

  it("non-V3 legacy: robot motivation still scrubs journey clause", () => {
    const body = "How was today? On your journey toward balance, what stood out?";
    const r = finalizeNorthStarCoachSms({
      proposedBody: body,
      channel: "inbound_coach_reply",
      latestInboundRaw: "Good day",
    });
    expect(r.visibleBody.toLowerCase()).not.toContain("journey");
    expect(r.meta.blockedReasons).toContain("robot_motivation_scrub");
    expect(r.meta.requires_v3_repair).toBeFalsy();
  });

  it("non-V3 legacy: FVG backstop blocks feel-to-Would if scrub damage slips through", () => {
    const damaged = "how does it feel to Would you like to adjust?";
    expect(detectBrokenMicroEditReason(damaged)).toBe("broken_micro_edit");
  });

  it("inbound V3: did you get a chance does not rewrite to bare Did you do it?", () => {
    const r = finalizeNorthStarCoachSms({
      proposedBody: "Thanks for sharing that. Did you get a chance to finish the workout today?",
      channel: "inbound_coach_reply",
      latestInboundRaw:
        "I spent time encouraging others on the team today and building unity among us.",
      replySource: "v3_inbound_relationship_lane",
    });
    expect(r.visibleBody).not.toMatch(/\bDid you do it\?\b/);
    expect(r.meta.blockedReasons).toContain("did_you_get_a_chance_requires_v3_repair");
    expect(r.meta.requires_v3_repair).toBe(true);
  });
});

describe("deriveFutureIntentHint", () => {
  it("buckets tomorrow vs durable change", () => {
    expect(deriveFutureIntentHint("I'll go two hours tomorrow")).toBe("tomorrow");
    expect(deriveFutureIntentHint("New baseline from now on")).toBe("durable_change");
  });
});
