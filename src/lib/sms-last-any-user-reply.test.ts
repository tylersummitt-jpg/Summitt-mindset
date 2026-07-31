import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());
const isComplianceMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: fromMock },
}));

vi.mock("@/lib/v2-commitment-sms-thread-memory", () => ({
  isSmsComplianceOnlyInbound: isComplianceMock,
}));

import { fetchLastAnyUserReplyAt } from "@/lib/sms-last-any-user-reply";

type InboundRow = { received_at: string; raw_body: string };

function mockInboundPages(pages: InboundRow[][]) {
  let call = 0;
  fromMock.mockImplementation(() => {
    const page = pages[call] ?? [];
    call += 1;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.range = vi.fn(async () => ({ data: page, error: null }));
    return chain;
  });
}

describe("fetchLastAnyUserReplyAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isComplianceMock.mockImplementation((body: string) =>
      /^(stop|start|help|unstop|cancel)$/i.test(body.trim())
    );
  });

  it("returns the latest non-compliance reply", async () => {
    mockInboundPages([
      [
        { received_at: "2026-07-31T15:00:00.000Z", raw_body: "Did the walk" },
        { received_at: "2026-07-30T15:00:00.000Z", raw_body: "Earlier" },
      ],
    ]);
    await expect(fetchLastAnyUserReplyAt("user_1")).resolves.toBe("2026-07-31T15:00:00.000Z");
  });

  it("skips latest compliance rows and returns older valid response", async () => {
    mockInboundPages([
      [
        { received_at: "2026-07-31T16:00:00.000Z", raw_body: "STOP" },
        { received_at: "2026-07-31T15:00:00.000Z", raw_body: "HELP" },
        { received_at: "2026-07-20T12:00:00.000Z", raw_body: "Real reply" },
      ],
    ]);
    await expect(fetchLastAnyUserReplyAt("user_1")).resolves.toBe("2026-07-20T12:00:00.000Z");
  });

  it("pages past more than 50 compliance rows to find a valid response", async () => {
    const compliancePage = Array.from({ length: 100 }, (_, i) => ({
      received_at: new Date(Date.UTC(2026, 6, 31, 20, 0, i)).toISOString(),
      raw_body: "STOP",
    }));
    const secondPage = [
      ...Array.from({ length: 20 }, (_, i) => ({
        received_at: new Date(Date.UTC(2026, 6, 30, 20, 0, i)).toISOString(),
        raw_body: "START",
      })),
      { received_at: "2026-06-01T10:00:00.000Z", raw_body: "Still engaged" },
    ];
    mockInboundPages([compliancePage, secondPage]);
    await expect(fetchLastAnyUserReplyAt("user_1")).resolves.toBe("2026-06-01T10:00:00.000Z");
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when there is no valid non-compliance response", async () => {
    mockInboundPages([
      [
        { received_at: "2026-07-31T16:00:00.000Z", raw_body: "STOP" },
        { received_at: "2026-07-30T16:00:00.000Z", raw_body: "HELP" },
      ],
    ]);
    await expect(fetchLastAnyUserReplyAt("user_1")).resolves.toBeNull();
  });

  it("orders by received_at descending via query", async () => {
    mockInboundPages([[{ received_at: "2026-07-31T15:00:00.000Z", raw_body: "Hi" }]]);
    await fetchLastAnyUserReplyAt("user_1");
    const chain = fromMock.mock.results[0]?.value as {
      order: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
    };
    expect(chain.eq).toHaveBeenCalledWith("clerk_user_id", "user_1");
    expect(chain.order).toHaveBeenCalledWith("received_at", { ascending: false });
  });

  it("returns null for empty clerk id without querying", async () => {
    await expect(fetchLastAnyUserReplyAt("   ")).resolves.toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });
});
