import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.hoisted(() => vi.fn());
const insertEventMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/marketing-collect", () => ({
  readMarketingCookiesFromStore: (...args: unknown[]) => cookiesMock(...args),
  insertMarketingEventFailOpen: (...args: unknown[]) => insertEventMock(...args),
}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { linkMarketingVisitorToClerkUser } from "@/lib/marketing-account-link";

const VISITOR = "3b241101-e2bb-4255-8caf-4136c566a962";
const ATTR = {
  v: 1 as const,
  first_touch_at: "2026-09-01T12:00:00.000Z",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "brand",
  utm_content: null,
  gclid_present: true,
  fbclid_present: false,
  referrer_host: null,
  source_normalized: "google" as const,
  is_paid_acquisition: true,
  source_detail: null,
};

describe("linkMarketingVisitorToClerkUser", () => {
  beforeEach(() => {
    cookiesMock.mockReset();
    insertEventMock.mockReset();
    fromMock.mockReset();
    insertEventMock.mockResolvedValue("ok");
    fromMock.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it("does not invent Direct attribution when cookies are missing", async () => {
    cookiesMock.mockResolvedValue({ visitorId: null, attribution: null });
    await linkMarketingVisitorToClerkUser("user_1");
    expect(fromMock).not.toHaveBeenCalled();
    expect(insertEventMock).not.toHaveBeenCalled();
  });

  it("copies first touch once and writes account_created", async () => {
    cookiesMock.mockResolvedValue({ visitorId: VISITOR, attribution: ATTR });
    await linkMarketingVisitorToClerkUser("user_1");
    expect(fromMock).toHaveBeenCalledWith("marketing_attribution");
    const insert = fromMock.mock.results[0].value.insert as ReturnType<typeof vi.fn>;
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        clerk_user_id: "user_1",
        visitor_id: VISITOR,
        source_normalized: "google",
        is_paid_acquisition: true,
      })
    );
    expect(insertEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "account_created",
        clerk_user_id: "user_1",
        visitor_id: VISITOR,
      })
    );
  });

  it("is idempotent on unique-conflict and never throws", async () => {
    cookiesMock.mockResolvedValue({ visitorId: VISITOR, attribution: ATTR });
    fromMock.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { code: "23505", message: "dup" } }),
    });
    await expect(linkMarketingVisitorToClerkUser("user_1")).resolves.toBeUndefined();
    fromMock.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(linkMarketingVisitorToClerkUser("user_1")).resolves.toBeUndefined();
  });
});
