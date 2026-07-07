import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCheckSentIdempotencyKey,
  checkSentIdempotencyKey,
  legacyCheckSentIdempotencyKey,
} from "@/lib/v2-check-sent-slot";
import {
  hasCheckSentForCommitmentDaySlot,
  insertV2CheckSentEventBestEffort,
} from "@/lib/v2-outbound-check-sent";

const COMMITMENT = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-07-07";
const CLERK = "user_abc";

const maybeSingleMock = vi.fn();
const insertMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: (...args: unknown[]) => maybeSingleMock(...args),
            }),
          }),
        }),
      }),
      insert: (...args: unknown[]) => insertMock(...args),
    }),
  },
}));

describe("check_sent idempotency — slot dedup matrix", () => {
  it("duplicate morning keys collide", () => {
    const a = checkSentIdempotencyKey(COMMITMENT, DAY, "morning");
    const b = checkSentIdempotencyKey(COMMITMENT, DAY, "morning");
    expect(a).toBe(b);
  });

  it("duplicate evening keys collide", () => {
    const a = checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin");
    const b = checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin");
    expect(a).toBe(b);
  });

  it("morning and evening keys do not collide", () => {
    expect(
      checkSentIdempotencyKey(COMMITMENT, DAY, "morning")
    ).not.toBe(checkSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin"));
  });

  it("buildCheckSentIdempotencyKey is the slot-scoped writer alias", () => {
    expect(buildCheckSentIdempotencyKey(COMMITMENT, DAY, "morning")).toBe(
      `v2_check_sent:${COMMITMENT}:${DAY}:morning`
    );
    expect(buildCheckSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin")).toBe(
      `v2_check_sent:${COMMITMENT}:${DAY}:evening_checkin`
    );
    expect(buildCheckSentIdempotencyKey(COMMITMENT, DAY, "morning")).not.toBe(
      legacyCheckSentIdempotencyKey(COMMITMENT, DAY)
    );
  });
});

describe("insertV2CheckSentEventBestEffort", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
  });

  it("writes slot-scoped idempotency_key and send_slot morning", async () => {
    maybeSingleMock.mockResolvedValue({ data: null });

    await insertV2CheckSentEventBestEffort({
      commitmentId: COMMITMENT,
      clerkUserId: CLERK,
      dayKey: DAY,
      templateId: 12,
      messageSid: "SM_test_morning",
      bodyPreview: "Morning check",
      templateFamily: "standard",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]?.[0] as {
      idempotency_key: string;
      payload_json: Record<string, unknown>;
    };
    expect(row.idempotency_key).toBe(
      buildCheckSentIdempotencyKey(COMMITMENT, DAY, "morning")
    );
    expect(row.payload_json.send_slot).toBe("morning");
    expect(row.idempotency_key).not.toBe(legacyCheckSentIdempotencyKey(COMMITMENT, DAY));
  });

  it("writes evening_checkin slot key when sendSlot is evening_checkin", async () => {
    maybeSingleMock.mockResolvedValue({ data: null });

    await insertV2CheckSentEventBestEffort({
      commitmentId: COMMITMENT,
      clerkUserId: CLERK,
      dayKey: DAY,
      templateId: 12,
      messageSid: "SM_test_evening",
      bodyPreview: "Evening check",
      templateFamily: "standard",
      sendSlot: "evening_checkin",
    });

    const row = insertMock.mock.calls[0]?.[0] as {
      idempotency_key: string;
      payload_json: Record<string, unknown>;
    };
    expect(row.idempotency_key).toBe(
      buildCheckSentIdempotencyKey(COMMITMENT, DAY, "evening_checkin")
    );
    expect(row.payload_json.send_slot).toBe("evening_checkin");
  });

  it("skips insert when legacy morning key already exists", async () => {
    maybeSingleMock.mockImplementation(async () => {
      const callIndex = maybeSingleMock.mock.calls.length;
      if (callIndex === 1) {
        return { data: null };
      }
      return { data: { id: "legacy-row" } };
    });

    await insertV2CheckSentEventBestEffort({
      commitmentId: COMMITMENT,
      clerkUserId: CLERK,
      dayKey: DAY,
      templateId: 12,
      messageSid: "SM_test_dedupe",
      bodyPreview: "Morning check",
      templateFamily: "standard",
    });

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("treats unique violation as deduped", async () => {
    maybeSingleMock.mockResolvedValue({ data: null });
    insertMock.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });

    await expect(
      insertV2CheckSentEventBestEffort({
        commitmentId: COMMITMENT,
        clerkUserId: CLERK,
        dayKey: DAY,
        templateId: 12,
        messageSid: "SM_test_conflict",
        bodyPreview: "Morning check",
        templateFamily: "standard",
      })
    ).resolves.toBeUndefined();
  });
});

describe("hasCheckSentForCommitmentDaySlot", () => {
  beforeEach(() => {
    maybeSingleMock.mockReset();
  });

  it("morning returns true when only legacy key exists", async () => {
    maybeSingleMock
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { id: "legacy" } });

    const exists = await hasCheckSentForCommitmentDaySlot({
      commitmentId: COMMITMENT,
      dayKey: DAY,
      sendSlot: "morning",
    });

    expect(exists).toBe(true);
  });
});

describe("daily-sms route wiring", () => {
  it("delegates direct check_sent insert to v2-outbound-check-sent", () => {
    const src = readFileSync("src/app/api/cron/daily-sms/route.ts", "utf8");
    expect(src).toContain("insertV2CheckSentEventBestEffort");
    expect(src).toContain('from "@/lib/v2-outbound-check-sent"');
    expect(src).not.toMatch(/idempotency_key:\s*`v2_check_sent:\$\{/);
    expect(src).not.toMatch(/async function insertV2CheckSentEventBestEffort/);
  });
});
