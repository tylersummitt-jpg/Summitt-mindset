import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildConversationBrainFallbackFacts,
  buildInboundV3RelationshipFacts,
} from "@/lib/v3-inbound-relationship-lane";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import type { V2InboundGatedDecision } from "@/lib/v2-ai-inbound";
import type { NorthStarSmsContextPacket } from "@/lib/north-star-coach-sms";

const __dirname = dirname(fileURLToPath(import.meta.url));
const routePath = join(__dirname, "../app/api/cron/sms-inbound-coach/route.ts");
const route = readFileSync(routePath, "utf8");

const minimalCommitment = {
  id: "c1",
  title: "Deep work",
  behavior_statement: "Two hours focused",
  accountability_phase: "active",
} as ActiveV2CommitmentRow;

const gdFallbackYes: V2InboundGatedDecision = {
  mode: "use_deterministic",
  decision_reason: "conversation_brain_legacy_fallback_disabled",
  confidence_used: null,
  should_write_outcome_event: true,
  final_event_type: "user_yes",
  reply_style: "normal_outcome",
  overrode_deterministic: false,
  should_open_blocker_capture: false,
  supplement_commitment_change_guidance: false,
};

const gdFallbackNo: V2InboundGatedDecision = {
  ...gdFallbackYes,
  final_event_type: "user_no",
  should_open_blocker_capture: true,
};

const minimalNorthStar = {
  latestOutboundBody: "prev",
  latestOpenQuestion: null,
  expectedReplySemantics: "yes_no",
  proofSignal: false,
  missSignal: false,
  blockerSignal: false,
  todayCompleted: false,
} as unknown as NorthStarSmsContextPacket;

describe("buildConversationBrainFallbackFacts", () => {
  it("marks control unavailable and truncates deterministic preview", () => {
    const longBody = "x".repeat(600);
    const f = buildConversationBrainFallbackFacts({
      legacyFallbackReason: "conversation_brain_legacy_fallback_disabled",
      deterministicTemplateBody: longBody,
      classifierResult: "user_yes",
      gatedEventType: "user_yes",
      shouldWriteOutcomeEvent: true,
      gatedMode: "use_deterministic",
      commitment: minimalCommitment,
      effectiveAsk: "Did you get two hours?",
      inboundMessageSid: "SMcb1",
    });
    expect(f.conversation_brain_control_available).toBe(false);
    expect(f.deterministic_template_preview.endsWith("...")).toBe(true);
    expect(f.deterministic_template_preview.length).toBeLessThanOrEqual(500);
    expect(f.inbound_message_sid).toBe("SMcb1");
    expect(f.suggested_coaching_move).toBe("acknowledge_completion");
    expect(f.coaching_route_meaning_summary).toMatch(/deterministic_template_preview/);
  });
});

describe("buildInboundV3RelationshipFacts — conversation_brain_unavailable", () => {
  it("merges coaching_route_meaning_summary into constraints and keeps suggested move from fallback facts", () => {
    const cb = buildConversationBrainFallbackFacts({
      legacyFallbackReason: "conversation_brain_legacy_fallback_disabled",
      deterministicTemplateBody: "Legacy template would say hello",
      classifierResult: "user_no",
      gatedEventType: "user_no",
      shouldWriteOutcomeEvent: true,
      gatedMode: "use_deterministic",
      commitment: minimalCommitment,
      effectiveAsk: "Did you show up?",
      inboundMessageSid: "SMcb2",
    });
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_1",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T12:00:00.000Z",
      commitment: minimalCommitment,
      effectiveAsk: "Did you show up?",
      userMessageRaw: "no",
      coalescedInboundText: "no",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: minimalNorthStar,
      gatedDecision: gdFallbackNo,
      deterministicEventType: "user_no",
      doNotRepeatHints: [],
      relationshipProfileSummary: null,
      conversationBrain: { enabled: false },
      centralBrain: { shadow_stored: false },
      arc: { ambiguous_short_reply: false, clarification_required: false },
      phase5a: {
        central_tether_brain_enabled: false,
        arc_clarify_brain_enabled: false,
        inbound_stitched_final_enabled: false,
      },
      forcedFutureStretchIntentActive: false,
      wave11MemoryConfirmationPending: false,
      accountabilityProofHint: null,
      rejectedTimeCandidates: [],
      unavailableWindows: [],
      routePurpose: "conversation_brain_unavailable",
      branchName: "conversation_brain_legacy_disabled_lane",
      branchMigratedToLane: true,
      conversationBrainFallbackFacts: cb,
    });
    expect(facts.route_purpose).toBe("conversation_brain_unavailable");
    expect(facts.conversation_brain_fallback_facts?.classifier_result).toBe("user_no");
    expect(facts.constraints.required_meaning_summary).toMatch(/Conversation brain was unavailable/);
    expect(facts.suggested_coaching_move).toBe("name_blocker");
  });
});

describe("Phase 3G-2 — conversation brain legacy-disabled lane (static route)", () => {
  it("does not send deterministic_template_fallback as final replySource on the legacy-disabled branch", () => {
    expect(route).not.toContain("replySource: \"deterministic_template_fallback\"");
  });

  it("routes legacy-disabled branch through produceInboundV3RelationshipSms with conversation_brain_unavailable", () => {
    const idx = route.indexOf(
      "conversationBrainControlTurn == null && !isV2SmsConversationBrainLegacyFallbackEnabled()"
    );
    expect(idx).toBeGreaterThan(-1);
    const slice = route.slice(idx, idx + 12000);
    expect(slice).toContain("await produceInboundV3RelationshipSms");
    expect(slice).toContain("routePurpose: \"conversation_brain_unavailable\"");
    expect(slice).toContain("buildConversationBrainFallbackFacts");
    expect(slice).toContain("replySource: \"v3_inbound_relationship_lane\"");
    expect(slice).toContain("await northStarGatePersistBodyAsync(cbLaneRes.body");
  });

  it("uses structured lane no-send last_error with fallback facts summary", () => {
    expect(route).toContain("conversation_brain_legacy_disabled_lane_no_send");
    expect(route).toContain("formatInboundV3LaneNoSendLastError(cbLaneRes");
    expect(route).toContain("conversation_brain_fallback_facts_summary: cbSlimFactsSummary");
  });

  it("extends final_voice_gate_no_send extras with fallback facts summary", () => {
    const idx = route.indexOf("if (!cbVoicePack.voice.shouldSend)");
    expect(idx).toBeGreaterThan(-1);
    const slice = route.slice(idx, idx + 2000);
    expect(slice).toContain("finalVoiceSkipLastError(cbVoicePack.voice");
    expect(slice).toContain("conversation_brain_fallback_facts_summary: cbSlimFactsSummary");
  });
});
