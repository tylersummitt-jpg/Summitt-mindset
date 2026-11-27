import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
const recordMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
}));

vi.mock("@/lib/onboarding-journey-diagnostics.server", () => ({
  scheduleOnboardingDiagnostic: (...args: unknown[]) => recordMock(...args),
}));

import { POST } from "@/app/api/onboarding/diagnostic/route";

function request(body: unknown, userAgent = "Mozilla/5.0 Chrome/120.0.0.0"): Request {
  return new Request("http://localhost/api/onboarding/diagnostic", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": userAgent },
    body: JSON.stringify(body),
  });
}

describe("POST /api/onboarding/diagnostic", () => {
  beforeEach(() => {
    authMock.mockReset();
    recordMock.mockReset();
    authMock.mockResolvedValue({ userId: "user_real" });
    recordMock.mockResolvedValue(undefined);
  });

  it("rejects a signed-out beacon", async () => {
    authMock.mockResolvedValue({ userId: null });
    const res = await POST(request({ step: "identity", outcome: "client_initialized", attemptId: "a1", journeyId: "j1" }));
    expect(res.status).toBe(401);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("uses the verified Clerk id and ignores a body user id", async () => {
    const res = await POST(
      request({
        step: "identity",
        outcome: "client_initialized",
        errorCode: "none",
        attemptId: "attempt_1",
        journeyId: "journey_1",
        clerkUserId: "user_other",
        identity: "secret identity line",
      })
    );
    expect(res.status).toBe(204);
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: "user_real",
        step: "identity",
        outcome: "client_initialized",
        source: "client",
        attemptId: "attempt_1",
        journeyId: "journey_1",
      })
    );
    expect(JSON.stringify(recordMock.mock.calls[0])).not.toContain("secret identity");
    expect(JSON.stringify(recordMock.mock.calls[0])).not.toContain("user_other");
  });

  it("drops a client claim that a save failed", async () => {
    const res = await POST(
      request({
        step: "identity",
        outcome: "save_failed",
        errorCode: "persistence",
        attemptId: "attempt_1",
        journeyId: "journey_1",
      })
    );
    expect(res.status).toBe(204);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("still returns 204 when the recorder throws", async () => {
    recordMock.mockRejectedValue(new Error("db down"));
    const res = await POST(
      request({
        step: "texts",
        outcome: "submission_attempted",
        attemptId: "attempt_1",
        journeyId: "journey_1",
      })
    );
    expect(res.status).toBe(204);
  });
});
