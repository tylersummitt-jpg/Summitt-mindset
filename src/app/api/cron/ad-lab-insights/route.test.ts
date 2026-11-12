import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const importMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ad-lab-import", () => ({
  runAdLabImport: (...args: unknown[]) => importMock(...args),
}));

import { GET } from "@/app/api/cron/ad-lab-insights/route";

afterEach(() => {
  importMock.mockReset();
  delete process.env.CRON_SECRET;
});

describe("ad lab insights cron", () => {
  it("rejects a missing cron secret before importing", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    const response = await GET(new Request("https://example.com/api/cron/ad-lab-insights"));
    expect(response.status).toBe(401);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("imports the default window for a valid bearer secret", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    importMock.mockResolvedValueOnce({
      ok: true,
      since: "2026-11-10",
      until: "2026-11-11",
      timezone: "America/New_York",
      currency: "USD",
      ads: 2,
      days: 2,
      statusUpdated: true,
    });
    const response = await GET(
      new Request("https://example.com/api/cron/ad-lab-insights", {
        headers: { authorization: "Bearer cron-test-secret" },
      })
    );
    expect(response.status).toBe(200);
    expect(importMock).toHaveBeenCalledWith({});
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain("access_token");
  });

  it("rejects a backfill longer than 7 days", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    const response = await GET(
      new Request(
        "https://example.com/api/cron/ad-lab-insights?since=2026-10-01&until=2026-11-01",
        { headers: { "x-cron-secret": "cron-test-secret" } }
      )
    );
    expect(response.status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
  });
});
