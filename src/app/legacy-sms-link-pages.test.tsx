import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/pulse/pulse-client", () => ({
  default: ({ token }: { token: string | null }) => <p>pulse:{token ?? ""}</p>,
}));

vi.mock("@/app/rescue/rescue-client", () => ({
  default: ({ token }: { token: string | null }) => <p>rescue:{token ?? ""}</p>,
}));

vi.mock("@/app/winback/winback-client", () => ({
  default: ({ token }: { token: string | null }) => <p>winback:{token ?? ""}</p>,
}));

import PulsePage from "@/app/pulse/page";
import RescuePage from "@/app/rescue/page";
import WinbackPage from "@/app/winback/page";

describe("legacy SMS link pages", () => {
  it("reads the token from a Promise searchParams", async () => {
    const token = "sms_token_1";
    const pulse = renderToStaticMarkup(
      await PulsePage({ searchParams: Promise.resolve({ t: token }) })
    );
    const rescue = renderToStaticMarkup(
      await RescuePage({ searchParams: Promise.resolve({ t: token }) })
    );
    const winback = renderToStaticMarkup(
      await WinbackPage({ searchParams: Promise.resolve({ t: token }) })
    );
    expect(pulse).toContain("Quick check-in");
    expect(pulse).toContain(`pulse:${token}`);
    expect(rescue).toContain("A smaller version?");
    expect(rescue).toContain(`rescue:${token}`);
    expect(winback).toContain("One honest question");
    expect(winback).toContain(`winback:${token}`);
  });

  it("passes no token when the query is missing", async () => {
    const rescue = renderToStaticMarkup(await RescuePage({ searchParams: Promise.resolve({}) }));
    const pulse = renderToStaticMarkup(await PulsePage({}));
    const winback = renderToStaticMarkup(await WinbackPage({}));
    expect(rescue).toContain("rescue:");
    expect(rescue).not.toContain("sms_token_1");
    expect(pulse).toContain("pulse:");
    expect(winback).toContain("winback:");
  });
});
