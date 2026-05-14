import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";
import { buildCommitmentChangeInboundFactsFromWave4 } from "@/lib/v3-inbound-relationship-lane";

function baseCommitment(overrides?: Partial<ActiveV2CommitmentRow>): ActiveV2CommitmentRow {
  return {
    id: "cmt_3f4",
    clerk_user_id: "user_3f4",
    status: "active",
    behavior_statement: "Two hours deep work before noon",
    title: "Morning focus",
    success_criteria: null,
    blocker_capture_expires_at: null,
    blocker_capture_after_event: null,
    adaptive_ask_text: null,
    adaptive_ask_active_from: null,
    adaptive_ask_expires_at: null,
    adaptive_proposal_text: null,
    adaptive_proposal_created_at: null,
    adaptive_proposal_expires_at: null,
    accountability_phase: "active_accountability",
    reactivation_entered_at: null,
    reactivation_last_sent_at: null,
    reactivation_entry_reason_code: null,
    refresh_session: null,
    commitment_refresh_last_prompted_at: null,
    pending_resolution_kind: null,
    pending_resolution_created_at: null,
    pending_resolution_expires_at: null,
    pending_resolution_payload: null,
    updated_at: null,
    started_at: null,
    ...overrides,
  };
}

describe("buildCommitmentChangeInboundFactsFromWave4", () => {
  const intentTighten = {
    intent: "sms_tighten_request" as const,
    candidateTightenedBar: "20 minutes reading",
    candidateNewBar: null,
    aiConfidence: 0.8,
  };

  it("marks pending_resolution_created for tighten apply", () => {
    const f = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: intentTighten,
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessage: "Make it smaller — 20 minutes reading only",
      messageSid: "SMtesttighten",
      wave4: {
        pendingApplied: true,
        pendingKind: "commitment_tighten",
        skipReason: null,
      },
      pendingResolutionApplyException: null,
      legacyCommitmentChangeReplyPreview:
        "Good — I won't rewrite the full commitment from here, but I'll hold you to this honest smaller version: 20 minutes reading. Same fight, clearer bar.",
    });
    expect(f.pending_resolution_created).toBe(true);
    expect(f.pending_resolution_type).toBe("commitment_tighten");
    expect(f.server_state_transition_summary).toBe("pending_resolution_upserted:commitment_tighten");
    expect(f.legacy_commitment_change_reply_preview.length).toBeGreaterThan(0);
    expect(f.append_note_preview).toBeNull();
    expect(f.required_meaning_summary).toMatch(/pending_resolution_created is true/);
    expect(f.required_meaning_summary).toContain("written commitment row already changed");
  });

  it("marks skip for soft_quit and does not imply pending was created", () => {
    const f = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: {
        intent: "sms_soft_quit_or_frustration",
        candidateTightenedBar: null,
        candidateNewBar: null,
        aiConfidence: 0.7,
      },
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessage: "I quit",
      messageSid: "SMtestquit",
      wave4: { pendingApplied: false, pendingKind: null, skipReason: "soft_quit" },
      pendingResolutionApplyException: null,
      legacyCommitmentChangeReplyPreview: "I hear you. That may mean the bar is wrong…",
    });
    expect(f.pending_resolution_created).toBe(false);
    expect(f.pending_resolution_skip_reason).toBe("soft_quit");
    expect(f.server_state_transition_summary).toBe("pending_resolution_skipped:soft_quit");
    expect(f.required_meaning_summary).toMatch(/pending_resolution_created is false/);
  });

  it("sets existing pending note preview and required verbatim for lane binding", () => {
    const f = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: intentTighten,
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessage: "Change again",
      messageSid: "SMtestexist",
      wave4: { pendingApplied: false, pendingKind: null, skipReason: "existing_pending" },
      pendingResolutionApplyException: null,
      legacyCommitmentChangeReplyPreview: "stub legacy",
    });
    expect(f.existing_pending_resolution).toBe(true);
    expect(f.append_note_preview).toBe(
      "You already have a commitment update in progress—reply here to finish it before starting another."
    );
    expect(f.required_verbatim_substrings).toEqual([
      "You already have a commitment update in progress—reply here to finish it before starting another.",
    ]);
  });

  it("surfaces apply exception in server summary without claiming pending was created", () => {
    const f = buildCommitmentChangeInboundFactsFromWave4({
      intentPack: intentTighten,
      commitment: baseCommitment(),
      effectiveAsk: "Two hours deep work before noon",
      userMessage: "Tighten",
      messageSid: "SMtesterr",
      wave4: { pendingApplied: false, pendingKind: null, skipReason: null },
      pendingResolutionApplyException: "rpc_timeout",
      legacyCommitmentChangeReplyPreview: "stub legacy",
    });
    expect(f.pending_resolution_apply_exception).toBe("rpc_timeout");
    expect(f.server_state_transition_summary).toMatch(/^pending_resolution_apply_failed:/);
    expect(f.pending_resolution_created).toBe(false);
  });
});

describe("sms-inbound-coach route — Phase 3F-4 commitment_change_handoff (static)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const routePath = join(__dirname, "../app/api/cron/sms-inbound-coach/route.ts");
  const route = readFileSync(routePath, "utf8");

  it("defines persistCommitmentChangeHandoffLaneAndSend using lane + NS+FVG on inbound_coach_reply", () => {
    const start = route.indexOf("async function persistCommitmentChangeHandoffLaneAndSend");
    expect(start).toBeGreaterThan(-1);
    const end = route.indexOf("async function handleAdaptiveProposalConsentAmbiguousInbound", start);
    expect(end).toBeGreaterThan(start);
    const body = route.slice(start, end);
    expect(body).toContain("produceInboundV3RelationshipSms");
    expect(body).toContain("northStarGatePersistBodyAsync");
    expect(body).toContain('channel: "inbound_coach_reply"');
    expect(body).toContain("formatInboundV3LaneNoSendLastError");
    expect(body).toContain("finalVoiceSkipLastError");
    expect(body).not.toContain("wave4_commitment_handoff");
    expect(body).not.toContain("produceV3InboundCoachDraft");
  });

  it("early-returns from processV2NormalInboundOutcome after persistCommitmentChangeHandoffLaneAndSend for handoff", () => {
    const idxReturn = route.indexOf("await persistCommitmentChangeHandoffLaneAndSend");
    expect(idxReturn).toBeGreaterThan(-1);
    expect(route.slice(idxReturn, idxReturn + 900)).toMatch(/\}\);\s*\n\s*return;/);
  });

  it("does not use appendWhenExistingPendingResolution in the Wave4 block", () => {
    expect(route).not.toContain("appendWhenExistingPendingResolution");
  });
});
