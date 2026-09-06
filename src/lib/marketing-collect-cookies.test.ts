import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const insertMock = vi.hoisted(() => vi.fn());
const nativeMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/marketing-collect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/marketing-collect")>();
  return {
    ...actual,
    insertMarketingEventFailOpen: (...args: unknown[]) => insertMock(...args),
  };
});

vi.mock("@/lib/native-app/is-native-summitt-mindset-app-request", () => ({
  isNativeSummittMindsetAppRequestFromRequest: (...args: unknown[]) =>
    nativeMock(...args),
}));

import { POST } from "@/app/api/marketing/collect/route";
import { attachMarketingCookies } from "@/lib/marketing-middleware-cookies";
import { readMarketingCookiesFromRequest } from "@/lib/marketing-collect";
import { SM_ACQ_COOKIE, SM_VISITOR_COOKIE } from "@/lib/marketing-attribution-pure";

function browserCookieHeaderFromSetCookie(res: NextResponse): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function mintHomepageCookies() {
  const pageReq = new NextRequest("https://summittmindset.com/");
  const minted = attachMarketingCookies(pageReq, NextResponse.next());
  const cookieHeader = browserCookieHeaderFromSetCookie(minted);
  return { minted, cookieHeader };
}

describe("collect cookie decode matches middleware Set-Cookie", () => {
  beforeEach(() => {
    insertMock.mockReset();
    nativeMock.mockReset();
    nativeMock.mockReturnValue(false);
    insertMock.mockResolvedValue("ok");
  });

  it("parses sm_visitor + sm_acq from the browser Cookie header after middleware mint", async () => {
    const { cookieHeader } = mintHomepageCookies();
    expect(cookieHeader).toMatch(new RegExp(`${SM_VISITOR_COOKIE}=[0-9a-f-]{36}`, "i"));
    // serializeAcquisitionCookie encodes; Next Set-Cookie encodes again (%25).
    expect(cookieHeader).toContain(`${SM_ACQ_COOKIE}=%25`);

    const collectReq = new NextRequest("https://summittmindset.com/api/marketing/collect", {
      method: "POST",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
    });
    const parsed = await readMarketingCookiesFromRequest(collectReq);
    expect(parsed.visitorId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(parsed.attribution).not.toBeNull();
    expect(parsed.attribution?.source_normalized).toBe("direct");
  });

  it("plain Request Cookie header (no Next cookies API) still decodes sm_acq", async () => {
    const { cookieHeader } = mintHomepageCookies();
    const req = new Request("https://summittmindset.com/api/marketing/collect", {
      method: "POST",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
    });
    const parsed = await readMarketingCookiesFromRequest(req);
    expect(parsed.visitorId).toBeTruthy();
    expect(parsed.attribution?.source_normalized).toBe("direct");
  });

  it("POSTs page_viewed and trial_cta_clicked using those cookies", async () => {
    const { cookieHeader } = mintHomepageCookies();

    const page = await POST(
      new NextRequest("https://summittmindset.com/api/marketing/collect", {
        method: "POST",
        headers: { cookie: cookieHeader, "content-type": "application/json" },
        body: JSON.stringify({ event_type: "page_viewed", path: "/" }),
      })
    );
    expect(page.status).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0].event_type).toBe("page_viewed");
    expect(insertMock.mock.calls[0][0].visitor_id).toBeTruthy();
    expect(insertMock.mock.calls[0][0].attribution.source_normalized).toBe("direct");

    insertMock.mockClear();
    const click = await POST(
      new NextRequest("https://summittmindset.com/api/marketing/collect", {
        method: "POST",
        headers: { cookie: cookieHeader, "content-type": "application/json" },
        body: JSON.stringify({
          event_type: "trial_cta_clicked",
          path: "/",
          cta_surface: "hero",
          href: "/sign-up?redirect_url=/checkout/start",
        }),
      })
    );
    expect(click.status).toBe(204);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0].event_type).toBe("trial_cta_clicked");
    expect(insertMock.mock.calls[0][0].metadata).toEqual({ cta_surface: "hero" });
  });
});
