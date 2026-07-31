import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const clearPendingMock = vi.hoisted(() => vi.fn());
const abandonRefreshMock = vi.hoisted(() => vi.fn());
const getActiveCommitmentMock = vi.hoisted(() => vi.fn());
const parseRefreshSessionMock = vi.hoisted(() => vi.fn());
const shouldAbandonMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-guided-resolution", () => ({
  clearPendingResolutionIfExpired: clearPendingMock,
}));

vi.mock("@/lib/v2-refresh-session", () => ({
  abandonRefreshSessionTimeout: abandonRefreshMock,
  parseRefreshSession: parseRefreshSessionMock,
  shouldAbandonStaleIdentityStep: shouldAbandonMock,
}));

vi.mock("@/lib/v2-commitment", () => ({
  getActiveCommitment: getActiveCommitmentMock,
}));

import { runMorningTtoPreSendCanonicalStateMaintenance } from "@/lib/morning-tto-canonical-state-maintenance";
import type { ActiveV2CommitmentRow } from "@/lib/v2-commitment";

function commitment(overrides: Partial<ActiveV2CommitmentRow> = {}): ActiveV2CommitmentRow {
  return {
    id: "c1",
    clerk_user_id: "u1",
    behavior_statement: "Walk 20 minutes",
    updated_at: "2026-07-31T10:00:00.000Z",
    refresh_session: null,
    ...overrides,
  } as ActiveV2CommitmentRow;
}

describe("runMorningTtoPreSendCanonicalStateMaintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingMock.mockResolvedValue(false);
    abandonRefreshMock.mockResolvedValue(undefined);
    getActiveCommitmentMock.mockResolvedValue(null);
    parseRefreshSessionMock.mockReturnValue(null);
    shouldAbandonMock.mockReturnValue(false);
  });

  it("source module has no OpenAI, prose inspection, or body mutation", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/morning-tto-canonical-state-maintenance.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/from ["']openai["']/);
    expect(src).not.toContain("OpenAI");
    expect(src).not.toContain("buildDailySmsContent");
    expect(src).not.toContain("writeMorningTtoBody");
    expect(src).not.toContain("sendSMS");
  });

  it("clears expired pending resolution and reloads commitment", async () => {
    const before = commitment({
      pending_resolution_kind: "sms_goal_change",
      pending_resolution_expires_at: "2026-07-30T00:00:00.000Z",
    });
    const after = commitment({ pending_resolution_kind: null });
    clearPendingMock.mockResolvedValue(true);
    getActiveCommitmentMock.mockResolvedValue(after);

    const result = await runMorningTtoPreSendCanonicalStateMaintenance({
      clerkUserId: "u1",
      commitment: before,
      nowMs: Date.parse("2026-07-31T12:00:00.000Z"),
    });

    expect(clearPendingMock).toHaveBeenCalledWith(
      "c1",
      before,
      Date.parse("2026-07-31T12:00:00.000Z")
    );
    expect(result.pending_expired_cleared).toBe(true);
    expect(result.commitment).toBe(after);
  });

  it("does not clear non-expired pending resolution", async () => {
    const row = commitment({
      pending_resolution_kind: "sms_goal_change",
      pending_resolution_expires_at: "2026-08-01T00:00:00.000Z",
    });
    clearPendingMock.mockResolvedValue(false);

    const result = await runMorningTtoPreSendCanonicalStateMaintenance({
      clerkUserId: "u1",
      commitment: row,
      nowMs: Date.parse("2026-07-31T12:00:00.000Z"),
    });

    expect(clearPendingMock).toHaveBeenCalledOnce();
    expect(result.pending_expired_cleared).toBe(false);
    expect(result.commitment).toBe(row);
    expect(getActiveCommitmentMock).not.toHaveBeenCalled();
  });

  it("abandons timed-out refresh identity session and reloads", async () => {
    const session = {
      session_id: "s1",
      step: "identity" as const,
      started_at: "2026-07-01T00:00:00.000Z",
      channel: "sms" as const,
      clarifications_remaining: 1,
      commitment_prompt_delivered: false,
    };
    const before = commitment({ refresh_session: session as unknown as Record<string, unknown> });
    const after = commitment({ refresh_session: null });
    parseRefreshSessionMock.mockReturnValue(session);
    shouldAbandonMock.mockReturnValue(true);
    getActiveCommitmentMock.mockResolvedValue(after);

    const result = await runMorningTtoPreSendCanonicalStateMaintenance({
      clerkUserId: "u1",
      commitment: before,
      nowMs: Date.parse("2026-07-31T12:00:00.000Z"),
    });

    expect(abandonRefreshMock).toHaveBeenCalledWith({
      commitmentId: "c1",
      clerkUserId: "u1",
      session,
    });
    expect(result.refresh_timeout_abandoned).toBe(true);
    expect(result.commitment).toBe(after);
  });

  it("does not abandon an active refresh session", async () => {
    const session = {
      session_id: "s2",
      step: "identity" as const,
      started_at: "2026-07-30T00:00:00.000Z",
      channel: "sms" as const,
      clarifications_remaining: 1,
      commitment_prompt_delivered: false,
    };
    const row = commitment({ refresh_session: session as unknown as Record<string, unknown> });
    parseRefreshSessionMock.mockReturnValue(session);
    shouldAbandonMock.mockReturnValue(false);

    const result = await runMorningTtoPreSendCanonicalStateMaintenance({
      clerkUserId: "u1",
      commitment: row,
      nowMs: Date.parse("2026-07-31T12:00:00.000Z"),
    });

    expect(abandonRefreshMock).not.toHaveBeenCalled();
    expect(result.refresh_timeout_abandoned).toBe(false);
    expect(result.commitment).toBe(row);
  });

  it("does not accept or rewrite SMS body arguments", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/morning-tto-canonical-state-maintenance.ts"),
      "utf8"
    );
    expect(src).not.toContain("smsBody");
    expect(src).not.toContain("current_body_to_send");
    expect(src).not.toContain("sentBody");
    await runMorningTtoPreSendCanonicalStateMaintenance({
      clerkUserId: "u1",
      commitment: commitment(),
    });
    expect(clearPendingMock).toHaveBeenCalled();
  });

  it("daily-sms invokes pre-send maintenance before Twilio attempt helpers", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/cron/daily-sms/route.ts"),
      "utf8"
    );
    expect(route).toContain("runMorningTtoPreSendCanonicalStateMaintenance");
    const firstMaint = route.indexOf("runMorningTtoPreSendCanonicalStateMaintenance");
    const firstAttempt = route.indexOf("attemptMorningTtoTwilioSend(");
    expect(firstMaint).toBeGreaterThan(-1);
    expect(firstAttempt).toBeGreaterThan(firstMaint);
  });
});
