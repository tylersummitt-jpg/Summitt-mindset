import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildCommitmentChangeContextFactsForHeuristicInbound,
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

const minimalGated: V2InboundGatedDecision = {
  mode: "use_ai_outcome",
  decision_reason: "test",
  should_write_outcome_event: true,
  final_event_type: "user_yes",
  reply_style: "standard",
  supplement_commitment_change_guidance: false,
} as V2InboundGatedDecision;

const minimalNorthStar = {
  latestOutboundBody: "prev",
  latestOpenQuestion: null,
  expectedReplySemantics: "yes_no",
  proofSignal: false,
  missSignal: false,
  blockerSignal: false,
  todayCompleted: false,
} as unknown as NorthStarSmsContextPacket;

describe("buildCommitmentChangeContextFactsForHeuristicInbound", () => {
  it("marks heuristic intent, not_handoff, and no_state_change_taken", () => {
    const f = buildCommitmentChangeContextFactsForHeuristicInbound({
      commitment: minimalCommitment,
      userMessage: "I want to change my commitment to mornings only",
      messageSid: "SM123",
      gatedMode: "use_ai_outcome",
      shadowInterpretation: {
        ok: true,
        model: "test",
        data: {
          version: 1,
          intent: "commitment_change_request",
          proposed_outcome: "yes",
          confidence: 0.8,
          needs_clarification: false,
          clarification_question: null,
          is_repair: false,
          repair_of: null,
          user_asks_question: false,
          suggests_commitment_change: true,
          blocker_likely: false,
          discouraged_or_frustrated: false,
          substitution_counts: false,
          opt_out_like_but_not_stop: false,
          reasoning_short: "User asks to shift bar",
          suggested_reply: "…",
        },
      },
    });
    expect(f.heuristic_commitment_change_intent).toBe(true);
    expect(f.server_decision).toBe("not_handoff");
    expect(f.no_state_change_taken).toBe(true);
    expect(f.gated_mode).toBe("use_ai_outcome");
    expect(f.inbound_message_sid).toBe("SM123");
    expect(f.required_meaning_summary).toMatch(/no Wave4 pending-resolution was created/);
    expect(f.required_meaning_summary).toContain("pending SMS update flow");
    expect(f.requested_change_summary).toMatch(/suggests_commitment_change/);
  });
});

describe("Phase 3G-1 — sms-inbound-coach route gating (static)", () => {
  it("defines normalInboundV3OwnershipEligible without normalCoachingV3Eligible (heuristic no longer blocks lane)", () => {
    const idx = route.indexOf("const normalInboundV3OwnershipEligible");
    expect(idx).toBeGreaterThan(-1);
    const slice = route.slice(idx, idx + 220);
    expect(slice).toContain("!isInboundTransactionalException");
    expect(slice).not.toContain("normalCoachingV3Eligible");
  });

  it("declares isInboundTransactionalException from compliance/opt-out only", () => {
    expect(route).toMatch(
      /const isInboundTransactionalException = isLikelySmsComplianceOrOptOutTurn\(userMessage\)/
    );
  });

  it("feeds heuristic commitment-change context into buildInboundV3RelationshipFacts before produceInboundV3RelationshipSms", () => {
    const idx = route.indexOf("buildCommitmentChangeContextFactsForHeuristicInbound");
    const prod = route.indexOf("const laneRes = await produceInboundV3RelationshipSms", idx);
    expect(idx).toBeGreaterThan(-1);
    expect(prod).toBeGreaterThan(idx);
  });

  it("guards legacy else with inbound_active_coaching_legacy_else_invariant", () => {
    expect(route).toContain("inbound_active_coaching_legacy_else_invariant");
    expect(route).toContain("non_transactional_inbound_reached_legacy_else_without_inboundRelationshipLane");
  });

  it("calls await applyWave4SmsCommitmentPendingResolution only under commitment_change_handoff", () => {
    const matches = route.match(/await applyWave4SmsCommitmentPendingResolution/g);
    expect(matches?.length).toBe(1);
    expect(route).toMatch(/gatedDecision\.mode === "commitment_change_handoff"/);
  });
});

describe("buildInboundV3RelationshipFacts — commitment_change_context", () => {
  it("sets route_purpose and merges required_meaning from context facts", () => {
    const ctx = buildCommitmentChangeContextFactsForHeuristicInbound({
      commitment: minimalCommitment,
      userMessage: "Change my bar",
      messageSid: "SMx",
      gatedMode: "clarify",
      shadowInterpretation: null,
    });
    const facts = buildInboundV3RelationshipFacts({
      clerkUserId: "user_1",
      preferredName: "Alex",
      timezone: "America/Chicago",
      localTimeIso: "2026-05-12T12:00:00.000Z",
      commitment: minimalCommitment,
      effectiveAsk: "Did you get two hours?",
      userMessageRaw: "Change my bar",
      coalescedInboundText: "Change my bar",
      suppressedMessageSids: [],
      transcriptLines: [],
      northStarPacket: minimalNorthStar,
      gatedDecision: { ...minimalGated, mode: "clarify", final_event_type: null, should_write_outcome_event: false },
      deterministicEventType: "user_yes",
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
      routePurpose: "commitment_change_context",
      branchName: "commitment_change_context_heuristic",
      branchMigratedToLane: true,
      commitmentChangeContextFacts: ctx,
    });
    expect(facts.route_purpose).toBe("commitment_change_context");
    expect(facts.commitment_change_context_facts?.heuristic_commitment_change_intent).toBe(true);
    expect(facts.constraints.required_meaning_summary).toContain("no Wave4 pending-resolution was created");
    expect(facts.suggested_coaching_move).toBe("respond_commitment_change_context_without_pending_resolution");
  });
});
