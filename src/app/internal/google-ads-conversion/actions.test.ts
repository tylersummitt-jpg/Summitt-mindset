import { beforeEach, describe, expect, it, vi } from "vitest";

const { assertMock, previewMock, confirmMock } = vi.hoisted(() => ({
  assertMock: vi.fn(),
  previewMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock("@/lib/operator-console-allowlist", () => ({
  assertOperatorConsoleAccess: () => assertMock(),
}));

vi.mock("@/lib/google-ads/stripe-conversions", () => ({
  previewOperatorGoogleAdsTrial: (...args: unknown[]) => previewMock(...args),
  confirmOperatorGoogleAdsTrial: (...args: unknown[]) => confirmMock(...args),
}));

import {
  confirmOperatorGoogleAdsTrialAction,
  previewOperatorGoogleAdsTrialAction,
} from "./actions";

const view = {
  eligibility: "eligible" as const,
  subscriptionId: "sub_1",
  clickType: "gclid" as const,
  requestCountry: "US",
  transactionId: "start_trial:sub_1",
  deliveryStatus: "not_sent",
  requestId: null,
};

describe("Google Ads single-trial actions", () => {
  beforeEach(() => {
    assertMock.mockReset();
    previewMock.mockReset();
    confirmMock.mockReset();
    assertMock.mockResolvedValue({ clerkUserId: "user_operator", primaryEmail: null });
  });

  it("denies preview before any subscription read when the operator check fails", async () => {
    assertMock.mockRejectedValue(new Error("not_found"));
    const form = new FormData();
    form.set("subscriptionId", "sub_1");
    await expect(previewOperatorGoogleAdsTrialAction(null, form)).rejects.toThrow("not_found");
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("previews only the subscription id and drops a submitted click id", async () => {
    previewMock.mockResolvedValue(view);
    const form = new FormData();
    form.set("subscriptionId", "sub_1");
    form.set("google_click_id", "EAIaIQobChMI_test");
    form.set("gclid", "EAIaIQobChMI_test");
    const result = await previewOperatorGoogleAdsTrialAction(null, form);
    expect(assertMock).toHaveBeenCalledOnce();
    expect(previewMock).toHaveBeenCalledWith("sub_1");
    expect(JSON.stringify(result)).not.toContain("EAIaIQobChMI_test");
  });

  it("confirms only after the operator check and only with the subscription id", async () => {
    assertMock.mockRejectedValueOnce(new Error("not_found"));
    const denied = new FormData();
    denied.set("subscriptionId", "sub_1");
    await expect(confirmOperatorGoogleAdsTrialAction(null, denied)).rejects.toThrow("not_found");
    expect(confirmMock).not.toHaveBeenCalled();

    assertMock.mockResolvedValue({ clerkUserId: "user_operator", primaryEmail: null });
    confirmMock.mockResolvedValue({ ...view, deliveryStatus: "ingestion_accepted", requestId: "req-1" });
    const form = new FormData();
    form.set("subscriptionId", "sub_1");
    form.set("google_click_id", "EAIaIQobChMI_test");
    const result = await confirmOperatorGoogleAdsTrialAction(null, form);
    expect(confirmMock).toHaveBeenCalledWith("sub_1");
    expect(result.requestId).toBe("req-1");
    expect(JSON.stringify(result)).not.toContain("EAIaIQobChMI_test");
  });
});
