import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const claimMock = vi.hoisted(() => vi.fn());
const publishMock = vi.hoisted(() => vi.fn());
const failMock = vi.hoisted(() => vi.fn());
const loadMock = vi.hoisted(() => vi.fn());
const subsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  requireTylerAdmin: () => authMock(),
}));

vi.mock("@/lib/retention-report.server", () => ({
  claimRetentionReport: (...args: unknown[]) => claimMock(...args),
  publishRetentionReport: (...args: unknown[]) => publishMock(...args),
  failRetentionReport: (...args: unknown[]) => failMock(...args),
}));

vi.mock("@/lib/retention-intelligence.server", () => ({
  loadRetentionIntelligence: (...args: unknown[]) => loadMock(...args),
}));

vi.mock("@/lib/admin-subscriber-growth", () => ({
  loadRetentionSubscriptionInputs: (...args: unknown[]) => subsMock(...args),
}));

import { RETENTION_REPORT_TIME_BUDGET_MS } from "@/lib/retention-report";

import { POST } from "./route";

const ready = {
  status: "ready",
  withheld: null,
  definition: "Monthly paid retention.",
  milestones: [],
  annual: { members: 0, continuing: 0, ended: 0, unknown: 0 },
};

beforeEach(() => {
  authMock.mockReset();
  claimMock.mockReset();
  publishMock.mockReset();
  failMock.mockReset();
  loadMock.mockReset();
  subsMock.mockReset();
  process.env.TYLER_CLERK_USER_ID = "user_tyler";
  authMock.mockResolvedValue({ userId: "user_tyler" });
  claimMock.mockResolvedValue("claimed");
  subsMock.mockResolvedValue({ complete: true, subs: [] });
  loadMock.mockResolvedValue(ready);
  publishMock.mockResolvedValue("published");
  failMock.mockResolvedValue(undefined);
});

describe("POST /api/admin/retention-report", () => {
  it("rejects anyone who is not Tyler before a claim", async () => {
    authMock.mockResolvedValue({ userId: "user_brooke" });
    const response = await POST();
    expect(response.status).toBe(403);
    expect(claimMock).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("does not start a second read while a claim is held", async () => {
    claimMock.mockResolvedValue("busy");
    const response = await POST();
    expect(response.status).toBe(409);
    expect(loadMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("does not publish a withheld invoice result", async () => {
    loadMock.mockResolvedValue({
      ...ready,
      withheld: "Paid invoices stopped before the full history, newest first.",
    });
    const response = await POST();
    expect(response.status).toBe(422);
    expect(publishMock).not.toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith(
      expect.any(String),
      "Paid invoices stopped before the full history, newest first."
    );
  });

  it("starts one time budget before the subscription read", async () => {
    const start = Date.now();
    const response = await POST();
    expect(response.status).toBe(200);
    expect(subsMock).toHaveBeenCalledTimes(1);
    const deadline = subsMock.mock.calls[0]?.[0];
    expect(deadline).toBe(loadMock.mock.calls[0]?.[2]);
    expect(deadline).toBeGreaterThanOrEqual(start + RETENTION_REPORT_TIME_BUDGET_MS);
    expect(deadline).toBeLessThanOrEqual(Date.now() + RETENTION_REPORT_TIME_BUDGET_MS);
    expect(subsMock.mock.invocationCallOrder[0]).toBeLessThan(loadMock.mock.invocationCallOrder[0]);
  });

  it("publishes a finished report and refuses a lost claim", async () => {
    const saved = await POST();
    expect(saved.status).toBe(200);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith(expect.any(String), ready);
    const savedBody = await saved.json();
    expect(savedBody).toEqual({ ok: true });

    publishMock.mockResolvedValue("lost");
    const lost = await POST();
    expect(lost.status).toBe(409);
    expect(failMock).toHaveBeenCalled();
    const lostBody = await lost.json();
    expect(lostBody.error).toContain("not replaced");
  });
});
