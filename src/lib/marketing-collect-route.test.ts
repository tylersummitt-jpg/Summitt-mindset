import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const insertMock = vi.hoisted(() => vi.fn());
const cookiesMock = vi.hoisted(() => vi.fn());
const nativeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/marketing-collect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marketing-collect")>();
  return {
    ...actual,
    insertMarketingEventFailOpen: (...args: unknown[]) => insertMock(...args),
    readMarketingCookiesFromRequest: (...args: unknown[]) => cookiesMock(...args),
  };
});

vi.mock("@/lib/native-app/is-native-summitt-mindset-app-request", () => ({
  isNativeSummittMindsetAppRequestFromRequest: (...args: unknown[]) =>
    nativeMock(...args),
}));

import { POST } from "@/app/api/marketing/collect/route";
import {
  CLIENT_COLLECT_EVENT_TYPES,
  MARKETING_EVENT_TYPES,
  type MarketingEventType,
} from "@/lib/marketing-collect";

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
  meta_fbclid: null,
  meta_fbclid_observed_at: null,
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/marketing/collect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SERVER_AUTHORITATIVE_EVENT_TYPES = [
  "account_created",
  "plan_selected",
  "auth_completed",
  "checkout_opened",
  "trial_created",
  "identity_completed",
  "goal_completed",
  "sms_consent_completed",
  "setup_completed",
  "first_reply_received",
] as const satisfies readonly MarketingEventType[];

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

  it("fail-opens without insert when visitor or attribution cookies are missing", async () => {
    cookiesMock.mockResolvedValueOnce({
      visitorId: null,
      attribution: null,
      coachCookie: null,
    });
    const res = await POST(req({ event_type: "page_viewed", path: "/" }));
    expect(res.status).toBe(204);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does not insert for native-app User-Agent", async () => {
    nativeMock.mockReturnValueOnce(true);
    const res = await POST(req({ event_type: "page_viewed", path: "/" }));
    expect(res.status).toBe(204);
    expect(insertMock).not.toHaveBeenCalled();
    expect(cookiesMock).not.toHaveBeenCalled();
  });

  it("does not insert page_viewed for /sign-up or nested Clerk signup", async () => {
    expect((await POST(req({ event_type: "page_viewed", path: "/sign-up" }))).status).toBe(
      204
    );
    expect(
      (await POST(req({ event_type: "page_viewed", path: "/sign-up/sso-callback" }))).status
    ).toBe(204);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("accepts homepage video milestones only with a 6 to 20 digit Vimeo id", async () => {
    for (const eventType of [
      "homepage_video_reached",
      "homepage_video_started",
      "homepage_video_50",
      "homepage_video_completed",
    ]) {
      insertMock.mockClear();
      const res = await POST(
        req({
          event_type: eventType,
          path: "/",
          vimeo_video_id: " 1234567890 ",
          email: "hidden@example.com",
          cta_surface: "hero",
        })
      );
      expect(res.status).toBe(204);
      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(insertMock.mock.calls[0][0].metadata).toEqual({
        vimeo_video_id: "1234567890",
      });
      expect(JSON.stringify(insertMock.mock.calls[0][0])).not.toMatch(/hidden@example.com/);
    }
  });

  it("fail-opens without inserting an invalid or unknown video event", async () => {
    for (const vimeoVideoId of [
      "https://vimeo.com/1234567890",
      "abc123456",
      "",
      "   ",
      "12345",
      "123456789012345678901",
    ]) {
      insertMock.mockClear();
      const res = await POST(
        req({
          event_type: "homepage_video_reached",
          path: "/",
          vimeo_video_id: vimeoVideoId,
        })
      );
      expect(res.status).toBe(204);
      expect(insertMock).not.toHaveBeenCalled();
    }
    const unknown = await POST(
      req({ event_type: "homepage_video_25", path: "/", vimeo_video_id: "123456" })
    );
    expect(unknown.status).toBe(204);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("accepts the homepage_video CTA surface and still stores other allowlisted surfaces", async () => {
    const video = await POST(
      req({ event_type: "trial_cta_clicked", path: "/", cta_surface: "homepage_video" })
    );
    expect(video.status).toBe(204);
    expect(insertMock.mock.calls[0][0].metadata).toEqual({ cta_surface: "homepage_video" });

    insertMock.mockClear();
    const hero = await POST(
      req({ event_type: "trial_cta_clicked", path: "/", cta_surface: "hero" })
    );
    expect(hero.status).toBe(204);
    expect(insertMock.mock.calls[0][0].metadata).toEqual({ cta_surface: "hero" });

    insertMock.mockClear();
    const unknown = await POST(
      req({ event_type: "trial_cta_clicked", path: "/", cta_surface: "not_a_surface" })
    );
    expect(unknown.status).toBe(204);
    expect(insertMock.mock.calls[0][0].metadata).toBeNull();
  });

  it("does not insert a homepage video event for the native app", async () => {
    nativeMock.mockReturnValueOnce(true);
    const res = await POST(
      req({
        event_type: "homepage_video_started",
        path: "/",
        vimeo_video_id: "1234567890",
      })
    );
    expect(res.status).toBe(204);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects server-authoritative event types from the public collect route", async () => {
    for (const eventType of SERVER_AUTHORITATIVE_EVENT_TYPES) {
      insertMock.mockClear();
      const res = await POST(req({ event_type: eventType, path: "/" }));
      expect(res.status).toBe(204);
      expect(insertMock).not.toHaveBeenCalled();
    }
  });
});

describe("internal marketing event types", () => {
  it("accepts existing client events plus future server milestones internally", () => {
    expect(CLIENT_COLLECT_EVENT_TYPES).toEqual([
      "page_viewed",
      "trial_cta_clicked",
      "homepage_video_reached",
      "homepage_video_started",
      "homepage_video_50",
      "homepage_video_completed",
    ]);
    expect(MARKETING_EVENT_TYPES).toEqual([
      "page_viewed",
      "trial_cta_clicked",
      "account_created",
      "plan_selected",
      "auth_completed",
      "checkout_opened",
      "trial_created",
      "identity_completed",
      "goal_completed",
      "sms_consent_completed",
      "setup_completed",
      "first_reply_received",
      "homepage_video_reached",
      "homepage_video_started",
      "homepage_video_50",
      "homepage_video_completed",
    ]);
    expect(SERVER_AUTHORITATIVE_EVENT_TYPES).toHaveLength(10);
  });
});
