/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signInUrlPreservingInternalRedirect } from "@/lib/safe-redirect";

const push = vi.fn();
const reload = vi.fn(async () => undefined);
const router = { push, replace: push };

let searchParams = new URLSearchParams("session_id=cs_test_abc");
let userState: {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: { reload: typeof reload } | null;
} = {
  isLoaded: true,
  isSignedIn: true,
  user: { reload },
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => searchParams,
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => userState,
}));

import SubscribeSuccessPage from "@/app/subscribe/success/page";

const VALID_SESSION = "cs_test_abc";
const VALID_SIGN_IN_HREF = signInUrlPreservingInternalRedirect(
  `/subscribe/success?session_id=${VALID_SESSION}`
);

describe("/subscribe/success post-Stripe recovery", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams(`session_id=${VALID_SESSION}`);
    userState = {
      isLoaded: true,
      isSignedIn: true,
      user: { reload },
    };
    reload.mockClear();
    push.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("Clerk loading → no confirm, no Sign In redirect", async () => {
    userState = { isLoaded: false, isSignedIn: false, user: null };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await waitFor(() => {
      expect(push).not.toHaveBeenCalled();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Sign In to Finish Setup" })).toBeNull();
  });

  it("signed in → confirm, reload, /post-sign-in", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/stripe/confirm-checkout");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      sessionId: VALID_SESSION,
    });
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
      expect(push).toHaveBeenCalledWith("/post-sign-in");
    });
  });

  it("signed-out return does not immediately router.push Sign In", async () => {
    userState = { isLoaded: true, isSignedIn: false, user: null };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    expect(screen.getByText("Your trial is started.")).toBeTruthy();
    expect(
      screen.getByText("Sign in to finish setting up Coach Pat.")
    ).toBeTruthy();
    await waitFor(() => {
      expect(push).not.toHaveBeenCalled();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signed-out recovery CTA uses sanitizer and exact success URL", async () => {
    userState = { isLoaded: true, isSignedIn: false, user: null };
    vi.stubGlobal("fetch", vi.fn());
    render(<SubscribeSuccessPage />);
    const link = screen.getByRole("link", { name: "Sign In to Finish Setup" });
    expect(link.getAttribute("href")).toBe(VALID_SIGN_IN_HREF);
    expect(link.getAttribute("href")).toContain(
      encodeURIComponent(`/subscribe/success?session_id=${VALID_SESSION}`)
    );
    expect(screen.queryByText("Set Up Coach Pat →")).toBeNull();
  });

  it("invalid session_id is not forwarded on Sign In", async () => {
    searchParams = new URLSearchParams("session_id=not_a_session");
    userState = { isLoaded: true, isSignedIn: false, user: null };
    vi.stubGlobal("fetch", vi.fn());
    render(<SubscribeSuccessPage />);
    const link = screen.getByRole("link", { name: "Sign In to Finish Setup" });
    expect(link.getAttribute("href")).toBe("/sign-in");
    expect(link.getAttribute("href")).not.toContain("not_a_session");
    expect(link.getAttribute("href")).not.toContain("redirect_url");
  });

  it("missing session_id does not confirm; unsigned stays on recovery", async () => {
    searchParams = new URLSearchParams();
    userState = { isLoaded: true, isSignedIn: false, user: null };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    await waitFor(() => {
      expect(push).not.toHaveBeenCalled();
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Sign In to Finish Setup" });
    expect(link.getAttribute("href")).toBe(
      signInUrlPreservingInternalRedirect("/subscribe/success")
    );
    expect(screen.queryByText("Set Up Coach Pat →")).toBeNull();
  });

  it("missing session_id while signed in continues to /post-sign-in without confirm", async () => {
    searchParams = new URLSearchParams();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/post-sign-in");
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirm 401 → auth recovery, does not bypass or go /post-sign-in", async () => {
    const fetchMock = vi.fn(
      async () => new Response("Unauthorized", { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Sign In to Finish Setup" })
      ).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalledWith("/post-sign-in");
    expect(screen.getByText("Your trial is started.")).toBeTruthy();
    expect(screen.queryByText("Set Up Coach Pat →")).toBeNull();
    const link = screen.getByRole("link", { name: "Sign In to Finish Setup" });
    expect(link.getAttribute("href")).toBe(VALID_SIGN_IN_HREF);
  });

  it("confirm 403 → fail closed, no onboarding continue", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("Session does not belong to user", { status: 403 })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    await waitFor(() => {
      expect(
        screen.getByText("We couldn't confirm this checkout")
      ).toBeTruthy();
    });
    expect(reload).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalledWith("/post-sign-in");
    expect(screen.queryByText("Set Up Coach Pat →")).toBeNull();
    const link = screen.getByRole("link", { name: "Sign In to Finish Setup" });
    expect(link.getAttribute("href")).toBe(VALID_SIGN_IN_HREF);
  });

  it("timeout unsigned → no bare /post-sign-in", async () => {
    vi.useFakeTimers();
    userState = { isLoaded: false, isSignedIn: false, user: null };
    vi.stubGlobal("fetch", vi.fn());
    render(<SubscribeSuccessPage />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(15000);
    expect(screen.getByText("Still starting your trial")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Sign In to Finish Setup" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText("Set Up Coach Pat →")).toBeNull();
    expect(push).not.toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Sign In to Finish Setup" });
    expect(link.getAttribute("href")).toBe(VALID_SIGN_IN_HREF);
  });

  it("generic confirm error while signed in keeps Set Up Coach Pat", async () => {
    const fetchMock = vi.fn(
      async () => new Response("Internal Server Error", { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SubscribeSuccessPage />);
    await waitFor(() => {
      expect(
        screen.getByText("Your trial is started. Next: set up Coach Pat.")
      ).toBeTruthy();
    });
    expect(screen.getByText("Set Up Coach Pat →")).toBeTruthy();
    await userEvent.click(screen.getByText("Set Up Coach Pat →"));
    expect(push).toHaveBeenCalledWith("/post-sign-in");
  });

  it("does not use sessionStorage, localStorage, or reload loops", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/subscribe/success/page.tsx", "utf8")
    );
    expect(src).not.toContain("sessionStorage");
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("window.location.reload");
    expect(src).not.toContain("router.refresh");
    expect(src).not.toContain("setActive");
    expect(src).toContain("signInUrlPreservingInternalRedirect");
    expect(src).not.toMatch(
      /if \(isLoaded && !isSignedIn\) \{\s*[\s\S]*router\.push\(/
    );
  });
});
