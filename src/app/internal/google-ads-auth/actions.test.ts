import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertMock, probeMock } = vi.hoisted(() => ({
  assertMock: vi.fn(),
  probeMock: vi.fn(),
}));

vi.mock("@/lib/operator-console-allowlist", () => ({
  assertOperatorConsoleAccess: () => assertMock(),
}));

vi.mock("@/lib/google-ads/federation-probe", () => ({
  probeGoogleAdsFederation: (...args: unknown[]) => probeMock(...args),
}));

import { runGoogleAdsAuthProbeAction } from "./actions";

describe("Google Ads auth probe action", () => {
  beforeEach(() => {
    assertMock.mockReset();
    probeMock.mockReset();
  });

  it("denies the probe before any authentication call when the operator check fails", async () => {
    assertMock.mockRejectedValue(new Error("not_found"));
    await expect(runGoogleAdsAuthProbeAction(null, new FormData())).rejects.toThrow("not_found");
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("runs the probe only after the operator check", async () => {
    assertMock.mockResolvedValue({ clerkUserId: "user_operator", primaryEmail: null });
    probeMock.mockResolvedValue({
      ok: true,
      stage: "ready",
      ingestEnabled: false,
      issuerOk: true,
      subjectOk: true,
      audienceOk: true,
      stsStatus: 200,
      impersonationStatus: 200,
      tokenAccepted: true,
      expiresInSeconds: 3600,
    });
    const result = await runGoogleAdsAuthProbeAction(null, new FormData());
    expect(assertMock).toHaveBeenCalledOnce();
    expect(probeMock).toHaveBeenCalledOnce();
    expect(result.tokenAccepted).toBe(true);
    expect(JSON.stringify(result)).not.toContain("ya29");
  });
});
