import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

const { fromMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: (...args: unknown[]) => fromMock(...args) },
}));

import {
  clearPendingResolutionIfExpired,
  getPendingResolutionOrNull,
  hasUnexpiredPendingResolutionForDailyRoute,
  isPendingResolutionExpired,
  isSmsInboundPendingResolutionActionable,
} from "@/lib/v2-guided-resolution";

const NOW_MS = Date.parse("2026-07-15T12:00:00.000Z");
const EXPIRED_AT = "2026-07-01T12:00:00.000Z";
const CREATED_OLD = "2026-06-24T12:00:00.000Z";
const UNEXPIRED_AT = "2026-07-22T12:00:00.000Z";

function baseCommitment(
  overrides: Partial<ActiveV2CommitmentRow> = {}
): ActiveV2CommitmentRow {
  return {
    id: "cmt_expire_1",
    clerk_user_id: "user_expire_1",
    status: "active",
    behavior_statement: "I will run 2 miles a day",
    title: "Run",
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
    updated_at: "2026-06-24T12:00:00.000Z",
    started_at: null,
    ...overrides,
  };
}

function expiredReplacePending(
  overrides: Partial<ActiveV2CommitmentRow> = {}
): ActiveV2CommitmentRow {
  return baseCommitment({
    pending_resolution_kind: "commitment_replace",
    pending_resolution_created_at: CREATED_OLD,
    pending_resolution_expires_at: EXPIRED_AT,
    pending_resolution_payload: {
      source: "sms_inbound",
      sms_state: "awaiting_confirmation",
      detected_intent: "sms_replace_request",
      raw_user_text: "lift twice a week",
      inbound_message_sid: "SMexpired",
      ai_confidence: null,
      candidate_behavior_statement: "Lift weights twice a week",
      candidate_new_bar: "Lift weights twice a week",
      confirmation_prompt_sent_at: CREATED_OLD,
    },
    ...overrides,
  });
}

function unexpiredReplacePending(
  overrides: Partial<ActiveV2CommitmentRow> = {}
): ActiveV2CommitmentRow {
  return baseCommitment({
    pending_resolution_kind: "commitment_replace",
    pending_resolution_created_at: "2026-07-14T12:00:00.000Z",
    pending_resolution_expires_at: UNEXPIRED_AT,
    pending_resolution_payload: {
      source: "sms_inbound",
      sms_state: "awaiting_candidate",
      detected_intent: "sms_replace_request",
      raw_user_text: "I want to change my goal",
      inbound_message_sid: "SMfresh",
      ai_confidence: null,
      candidate_behavior_statement: null,
      candidate_new_bar: null,
      confirmation_prompt_sent_at: null,
      awaiting_candidate_reason: "goal_change_without_concrete_bar",
    },
    ...overrides,
  });
}

describe("expired pending resolution cleanup", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("A — expired pending is detected and clearPendingResolutionIfExpired write-backs null columns", async () => {
    const row = expiredReplacePending();
    expect(getPendingResolutionOrNull(row)).not.toBeNull();
    expect(isPendingResolutionExpired(row, NOW_MS)).toBe(true);
    expect(isSmsInboundPendingResolutionActionable(row, NOW_MS)).toBe(false);
    expect(hasUnexpiredPendingResolutionForDailyRoute(row, NOW_MS)).toBe(false);

    const updateFn = vi.fn(() => ({
      eq: () => ({
        eq: () => ({
          select: () => ({
            maybeSingle: async () => ({
              data: { updated_at: "2026-07-15T12:00:01.000Z" },
              error: null,
            }),
          }),
        }),
      }),
    }));
    fromMock.mockImplementation(() => ({ update: updateFn }));

    const cleared = await clearPendingResolutionIfExpired(row.id, row, NOW_MS);
    expect(cleared).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("v2_commitment");
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_resolution_kind: null,
        pending_resolution_created_at: null,
        pending_resolution_expires_at: null,
        pending_resolution_payload: null,
      })
    );
  });

  it("B — after expire, inbound actionable is false (no pending completion path)", () => {
    const row = expiredReplacePending();
    expect(isSmsInboundPendingResolutionActionable(row, NOW_MS)).toBe(false);
    // Unexpired control still works.
    expect(isSmsInboundPendingResolutionActionable(unexpiredReplacePending(), NOW_MS)).toBe(
      true
    );
  });

  it("C — expired pending does not qualify for daily pending_resolution route", () => {
    expect(hasUnexpiredPendingResolutionForDailyRoute(expiredReplacePending(), NOW_MS)).toBe(
      false
    );
    expect(
      hasUnexpiredPendingResolutionForDailyRoute(unexpiredReplacePending(), NOW_MS)
    ).toBe(true);
  });

  it("D — unexpired awaiting_candidate / awaiting_confirmation still route as pending", () => {
    const awaitingCandidate = unexpiredReplacePending();
    expect(hasUnexpiredPendingResolutionForDailyRoute(awaitingCandidate, NOW_MS)).toBe(true);
    expect(isSmsInboundPendingResolutionActionable(awaitingCandidate, NOW_MS)).toBe(true);

    const awaitingConfirm = unexpiredReplacePending({
      pending_resolution_payload: {
        source: "sms_inbound",
        sms_state: "awaiting_confirmation",
        detected_intent: "sms_replace_request",
        raw_user_text: "lift twice a week",
        inbound_message_sid: "SMconfirm",
        ai_confidence: null,
        candidate_behavior_statement: "Lift weights twice a week",
        candidate_new_bar: "Lift weights twice a week",
        confirmation_prompt_sent_at: "2026-07-14T13:00:00.000Z",
      },
    });
    expect(hasUnexpiredPendingResolutionForDailyRoute(awaitingConfirm, NOW_MS)).toBe(true);
    expect(isSmsInboundPendingResolutionActionable(awaitingConfirm, NOW_MS)).toBe(true);
  });

  it("clearPendingResolutionIfExpired is a no-op when unexpired", async () => {
    const row = unexpiredReplacePending();
    const cleared = await clearPendingResolutionIfExpired(row.id, row, NOW_MS);
    expect(cleared).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("incomplete pending (missing expires) is not daily-routable and not expire-cleared", async () => {
    const incomplete = baseCommitment({
      pending_resolution_kind: "commitment_replace",
      pending_resolution_created_at: CREATED_OLD,
      pending_resolution_expires_at: null,
      pending_resolution_payload: {
        source: "sms_inbound",
        sms_state: "awaiting_candidate",
        detected_intent: "sms_replace_request",
        raw_user_text: "change",
        inbound_message_sid: "SMincomplete",
        ai_confidence: null,
      },
    });
    expect(getPendingResolutionOrNull(incomplete)).toBeNull();
    expect(hasUnexpiredPendingResolutionForDailyRoute(incomplete, NOW_MS)).toBe(false);
    expect(isSmsInboundPendingResolutionActionable(incomplete, NOW_MS)).toBe(false);
    const cleared = await clearPendingResolutionIfExpired(incomplete.id, incomplete, NOW_MS);
    expect(cleared).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });
});

describe("inbound / daily wiring — expire clear before actionable gate", () => {
  const repoRoot = path.resolve(__dirname, "../..");

  it("processV2SmsInboundPendingResolution clears expired pending before actionable early-return", () => {
    const route = fs.readFileSync(
      path.join(repoRoot, "src/app/api/cron/sms-inbound-coach/route.ts"),
      "utf8"
    );
    const start = route.indexOf("async function processV2SmsInboundPendingResolution");
    expect(start).toBeGreaterThan(-1);
    const end = route.indexOf("\nasync function ", start + 1);
    const body = end > start ? route.slice(start, end) : route.slice(start, start + 2500);

    const clearIdx = body.indexOf("clearPendingResolutionIfExpired");
    const actionableIdx = body.indexOf("isSmsInboundPendingResolutionActionable");
    expect(clearIdx).toBeGreaterThan(-1);
    expect(actionableIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeLessThan(actionableIdx);
  });

  it("daily-sms-build uses unexpired pending gate (not expired pending_resolution)", () => {
    const daily = fs.readFileSync(
      path.join(repoRoot, "src/lib/daily-sms-build.ts"),
      "utf8"
    );
    expect(daily).toContain("clearPendingResolutionIfExpired");
    expect(daily).toContain("hasUnexpiredPendingResolutionForDailyRoute");
    expect(daily).toMatch(
      /hasUnexpiredPendingResolutionForDailyRoute\(\s*active,\s*now\.getTime\(\)\s*\)/
    );
  });

  it("sunday pre-writer uses same unexpired pending gate", () => {
    const sunday = fs.readFileSync(
      path.join(repoRoot, "src/lib/sms-daily-sunday-before-writer.ts"),
      "utf8"
    );
    expect(sunday).toContain("hasUnexpiredPendingResolutionForDailyRoute");
    expect(sunday).not.toContain("isPendingResolutionExpired");
  });
});
