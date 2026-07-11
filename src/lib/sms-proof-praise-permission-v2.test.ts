import { describe, expect, it } from "vitest";
import {
  buildProofAndPraisePermissionV2,
  DEFAULT_FORBIDDEN_PROOF_CLAIMS,
  PROOF_PRAISE_EVIDENCE_MAX_ITEMS,
  PROOF_PRAISE_QUOTE_MAX_CHARS,
} from "@/lib/sms-proof-praise-permission-v2";

describe("buildProofAndPraisePermissionV2", () => {
  it("always emits section when no evidence", () => {
    const { section, meta } = buildProofAndPraisePermissionV2({ surface: "inbound" });
    expect(section.authority).toBe("server_state_authoritative");
    expect(section.data).toBeDefined();
    expect(meta.proof_permission_emitted).toBe(true);
  });

  it("no evidence → proof/Victory hard claims forbidden; bare Victory Room not forbidden", () => {
    const { section } = buildProofAndPraisePermissionV2({ surface: "daily" });
    expect(section.data.can_claim_proof).toBe(false);
    expect(section.data.can_reference_victory_room).toBe(false);
    expect(section.data.forbidden_proof_claims.length).toBeGreaterThan(0);
    expect(section.data.forbidden_proof_claims).toContain("saved to Victory Room");
    expect(section.data.forbidden_proof_claims).toContain("I'm adding that to your Victory Room");
    expect(section.data.forbidden_proof_claims).not.toContain("Victory Room");
  });

  it("effort praise allowed even when proof forbidden", () => {
    const { section } = buildProofAndPraisePermissionV2({ surface: "inbound" });
    expect(section.data.can_praise_effort).toBe(true);
    expect(section.data.can_claim_proof).toBe(false);
    expect(section.data.writer_guidance.may_praise_effort_without_proof).toBe(true);
  });

  it("completion evidence → can_claim_completion=true", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "inbound",
      currentTurn: {
        deterministic_classifier_event: "user_yes",
        should_write_outcome_event: true,
      },
    });
    expect(section.data.can_claim_completion).toBe(true);
    expect(section.data.allowed_outbound_claims.completion).toBe(true);
  });

  it("miss evidence → can_claim_miss=true", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "inbound",
      legacyProofVictoryPermission: {
        authority: "authoritative_current",
        data: { miss_signal: true },
      },
    });
    expect(section.data.can_claim_miss).toBe(true);
  });

  it("partial evidence → can_claim_partial=true", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "inbound",
      currentTurn: {
        deterministic_classifier_event: "user_partial",
        should_write_outcome_event: true,
      },
    });
    expect(section.data.can_claim_partial).toBe(true);
  });

  it("proof hint → can_claim_proof=true", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "inbound",
      legacyProofVictoryPermission: {
        authority: "authoritative_current",
        data: {
          proof_callout_hint: {
            eligible: true,
            surface: "victory_room",
            reason: "first_completion",
            proof_callout_claim_saved_allowed: false,
          },
        },
      },
    });
    expect(section.data.can_claim_proof).toBe(true);
    expect(section.data.evidence.some((e) => e.claim_type === "proof")).toBe(true);
  });

  it("Victory evidence → can_reference_victory_room=true", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "inbound",
      legacyProofVictoryPermission: {
        authority: "authoritative_current",
        data: {
          proof_callout_hint: {
            eligible: true,
            surface: "victory_room",
            reason: "meaningful_streak",
            proof_callout_claim_saved_allowed: false,
          },
        },
      },
    });
    expect(section.data.can_reference_victory_room).toBe(true);
    expect(section.data.allowed_outbound_claims.victory_room).toBe(true);
  });

  it("weekly strong week without proof hint does NOT allow Victory", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "weekly",
      currentTurn: { strong_week: true, silent_week: false },
      structuredRecentTruth: {
        weekly_week_summary: {
          completed_count: 4,
          missed_count: 0,
          partial_count: 0,
          proof_moment_hints: [],
        },
      },
    });
    expect(section.data.can_praise_consistency).toBe(true);
    expect(section.data.can_claim_proof).toBe(false);
    expect(section.data.can_reference_victory_room).toBe(false);
  });

  it("weekly completed_count >= 2 alone does NOT allow can_claim_proof", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "weekly",
      structuredRecentTruth: {
        weekly_week_summary: {
          completed_count: 3,
          missed_count: 0,
          partial_count: 0,
          proof_moment_hints: [],
        },
      },
    });
    expect(section.data.can_claim_completion).toBe(true);
    expect(section.data.can_claim_proof).toBe(false);
  });

  it("guided conservative defaults", () => {
    const { section } = buildProofAndPraisePermissionV2({ surface: "guided_contract" });
    expect(section.data.can_praise_effort).toBe(true);
    expect(section.data.can_claim_completion).toBe(false);
    expect(section.data.can_claim_miss).toBe(false);
    expect(section.data.can_claim_partial).toBe(false);
    expect(section.data.can_claim_proof).toBe(false);
    expect(section.data.can_reference_victory_room).toBe(false);
  });

  it("forbidden proof claims populated when disallowed", () => {
    const { section } = buildProofAndPraisePermissionV2({ surface: "guided_contract" });
    for (const phrase of DEFAULT_FORBIDDEN_PROOF_CLAIMS) {
      expect(section.data.forbidden_proof_claims).toContain(phrase);
    }
  });

  it("evidence array capped / quotes trimmed", () => {
    const longQuote = "x".repeat(PROOF_PRAISE_QUOTE_MAX_CHARS + 40);
    const hints = Array.from({ length: 8 }, (_, i) => `hint-${i}-${longQuote}`);
    const { section } = buildProofAndPraisePermissionV2({
      surface: "weekly",
      structuredRecentTruth: {
        weekly_week_summary: {
          completed_count: 2,
          missed_count: 0,
          partial_count: 0,
          proof_moment_hints: hints,
        },
      },
    });
    expect(section.data.evidence.length).toBeLessThanOrEqual(PROOF_PRAISE_EVIDENCE_MAX_ITEMS);
    for (const e of section.data.evidence) {
      if (e.quote) {
        expect(e.quote.length).toBeLessThanOrEqual(PROOF_PRAISE_QUOTE_MAX_CHARS);
      }
    }
  });

  it("legacy_v1 preserved (slim transition copy)", () => {
    const legacy = {
      authority: "authoritative_current" as const,
      data: {
        proof_signal: true,
        can_say_saved_as_proof: false,
        proof_callout_hint: {
          eligible: true,
          surface: "victory_room",
          reason: "first_completion",
          instruction: "long instruction should not appear in slim copy",
          proof_callout_claim_saved_allowed: false,
        },
      },
    };
    const { section } = buildProofAndPraisePermissionV2({
      surface: "inbound",
      legacyProofVictoryPermission: legacy,
    });
    expect(section.data.legacy_v1?.data.proof_signal).toBe(true);
    expect(section.data.legacy_v1?.data.proof_callout_hint).toEqual({
      eligible: true,
      proof_callout_claim_saved_allowed: false,
    });
    expect(section.data.legacy_v1?.data.proof_callout_hint).not.toHaveProperty("instruction");
  });

  it("compact mode drops legacy_v1 and shortens evidence", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "weekly",
      compact: true,
      legacyProofVictoryPermission: {
        authority: "authoritative_current",
        data: { proof_or_milestone_signal: "strong_week" },
      },
      structuredRecentTruth: {
        weekly_week_summary: {
          completed_count: 2,
          missed_count: 0,
          partial_count: 0,
          proof_moment_hints: ["a", "b", "c", "d", "e", "f"],
        },
      },
    });
    expect(section.data.legacy_v1).toBeNull();
    expect(section.data.evidence.length).toBeLessThanOrEqual(2);
    expect(section.data.evidence.every((e) => e.quote == null)).toBe(true);
  });

  it("weekly silent week forbids proof/Victory", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "weekly",
      currentTurn: { silent_week: true },
      structuredRecentTruth: {
        weekly_week_summary: {
          completed_count: 0,
          missed_count: 0,
          partial_count: 0,
        },
      },
    });
    expect(section.data.can_claim_proof).toBe(false);
    expect(section.data.can_reference_victory_room).toBe(false);
    expect(section.data.can_praise_consistency).toBe(false);
  });

  it("daily prior outcome maps via memory day key", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "daily",
      currentTurn: { accountability_day_key: "2026-05-18" },
      relationshipMemory7d: {
        window_days: 7,
        built_at: "2026-05-18T12:00:00.000Z",
        outcome_counts: { yes: 2, no: 0, partial: 0, blockers: 0, checks_sent: 2 },
        wins: [
          {
            summary: "yes",
            evidence: "User said done",
            at: "2026-05-18T11:00:00.000Z",
            local_day_key: "2026-05-18",
            source: "test",
            message_sid: null,
            is_exact_body: false,
          },
        ],
        misses: [],
        partials: [],
        comebacks: [],
        blockers: [],
        proof_moments: [],
        open_loops: [],
        direct_answer_history: [],
        context_flags: {},
      },
    });
    expect(section.data.can_claim_completion).toBe(true);
  });

  it("daily proof requires explicit proof_or_milestone_signal", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "daily",
      currentTurn: { accountability_day_key: "2026-05-18" },
      legacyProofVictoryPermission: {
        authority: "authoritative_current",
        data: {},
      },
      relationshipMemory7d: {
        window_days: 7,
        built_at: "2026-05-18T12:00:00.000Z",
        outcome_counts: { yes: 1, no: 0, partial: 0, blockers: 0, checks_sent: 1 },
        wins: [
          {
            summary: "yes",
            evidence: "done",
            at: "2026-05-18T11:00:00.000Z",
            local_day_key: "2026-05-18",
            source: "test",
            message_sid: null,
            is_exact_body: false,
          },
        ],
        misses: [],
        partials: [],
        comebacks: [],
        blockers: [],
        proof_moments: [],
        open_loops: [],
        direct_answer_history: [],
        context_flags: {},
      },
    });
    expect(section.data.can_claim_completion).toBe(true);
    expect(section.data.can_claim_proof).toBe(false);
  });

  it("inbound proof_signal alone does not allow can_claim_proof", () => {
    const { section } = buildProofAndPraisePermissionV2({
      surface: "inbound",
      legacyProofVictoryPermission: {
        authority: "authoritative_current",
        data: { proof_signal: true },
      },
    });
    expect(section.data.can_claim_proof).toBe(false);
  });

  it("emits telemetry meta", () => {
    const { meta } = buildProofAndPraisePermissionV2({
      surface: "guided_contract",
      legacyProofVictoryPermission: {
        authority: "authoritative_current",
        data: { can_say_saved_as_proof: false },
      },
    });
    expect(meta.proof_permission_emitted).toBe(true);
    expect(meta.proof_permission_has_legacy_v1).toBe(true);
    expect(meta.proof_permission_sources).toContain("surface:guided_contract");
  });
});
