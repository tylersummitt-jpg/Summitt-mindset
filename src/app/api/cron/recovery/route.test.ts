import { beforeEach, describe, expect, it, vi } from "vitest";

const recoveryMock = vi.fn();
const strandedMock = vi.fn();
const metaMock = vi.fn();

vi.mock("@/lib/recovery.server", () => ({
  runRecoveryCron: () => recoveryMock(),
}));

vi.mock("@/lib/stripe-first-checkout/stranded-trial", () => ({
  alertStrandedNewCustomerTrials: () => strandedMock(),
}));

vi.mock("@/lib/meta-capi-stripe-conversions", () => ({
  runHourlyMetaConversionMaintenance: () => metaMock(),
}));

import { GET } from "@/app/api/cron/recovery/route";

describe("recovery cron Meta maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-test-secret";
    recoveryMock.mockResolvedValue({ checked: 1 });
    strandedMock.mockResolvedValue(undefined);
    metaMock.mockResolvedValue(undefined);
  });

  it("runs Meta maintenance after recovery and still returns the recovery result when it throws", async () => {
    metaMock.mockRejectedValue(new Error("meta maintenance down"));
    const res = await GET(
      new Request("https://summittmindset.com/api/cron/recovery", {
        headers: { "x-cron-secret": "cron-test-secret" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 1 });
    expect(recoveryMock).toHaveBeenCalledTimes(1);
    expect(strandedMock).toHaveBeenCalledTimes(1);
    expect(metaMock).toHaveBeenCalledTimes(1);
  });
});
