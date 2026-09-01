import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const insertMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const nativeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/marketing-collect", () => ({
  collectFailOpenResponse: () =>
    new Response(null, { status: 204 }),
  insertMarketingEventFailOpen: (...args: unknown[]) => insertMock(...args),
  readMarketingCookiesFromRequest: (...args: unknown[]) => cookiesMock(...args),
}));

vi.mock("@/lib/native-app/is-native-summitt-mindset-app-request", () => ({
  isNativeSummittMindsetAppRequestFromRequest: (...args: unknown[]) =>
    nativeMock(...args),
}));

import { POST } from "@/app/api/marketing/collect/route";

const VISITOR = "3b241101-e2bb-4255-8caf-4136c566a962";
const ATTR = {
  v: 1 as const,
  first_touch_at: "2026-09-01T12:00:00.000Z",
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  gclid_present: false,
  fbclid_present: false,
  referrer_host: null,
  source_normalized: "direct" as const,
  is_paid_acquisition: false,
  source_detail: null,
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/marketing/collect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/marketing/collect", () => {
  beforeEach(() => {
    insertMock.mockReset();
    cookiesMock.mockReset();
    nativeMock.mockReset();
    nativeMock.mockReturnValue(false);
    cookiesMock.mockResolvedValue({
      visitorId: VISITOR,
      attribution: ATTR,
      coachCookie: null,
    });
    insertMock.mockResolvedValue("ok");
  });

  it("stores page_viewed and trial_cta_clicked from cookies, not client source claims", async () => {
    const page = await POST(
      req({
        event_type: "page_viewed",
        path: "/",
        source_normalized: "meta",
        email: "hidden@example.com",
      })
    );
    expect(page.status).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(1);
    const pageRow = insertMock.mock.calls[0][0];
    expect(pageRow.event_type).toBe("page_viewed");
    expect(pageRow.attribution.source_normalized).toBe("direct");
    expect(JSON.stringify(pageRow)).not.toMatch(/hidden@example.com/);

    insertMock.mockClear();
    const click = await POST(
      req({ event_type: "trial_cta_clicked", path: "/", cta_surface: "hero" })
    );
    expect(click.status).toBe(204);
    expect(insertMock.mock.calls[0][0].event_type).toBe("trial_cta_clicked");
    expect(insertMock.mock.calls[0][0].metadata).toEqual({ cta_surface: "hero" });
  });

  it("does not accept account_created anonymously", async () => {
    const res = await POST(req({ event_type: "account_created", path: "/" }));
    expect(res.status).toBe(204);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("ignores invalid events and excluded paths", async () => {
    expect((await POST(req({ event_type: "unknown" }))).status).toBe(204);
    expect((await POST(req({ event_type: "page_viewed", path: "/admin" }))).status).toBe(
      204
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("fail-opens when insert throws", async () => {
    insertMock.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(req({ event_type: "page_viewed", path: "/" }));
    expect(res.status).toBe(204);
  });
});
