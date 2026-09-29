import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const currentUserMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: unknown;
    href: string;
  }) => <a href={href}>{children as never}</a>,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_1" }),
  currentUser: () => currentUserMock(),
}));

vi.mock("@clerk/nextjs", () => ({
  SignOutButton: ({
    children,
    redirectUrl,
  }: {
    children: unknown;
    redirectUrl?: string;
  }) => <div data-redirect-url={redirectUrl}>{children as never}</div>,
  useUser: () => ({ user: null }),
}));

vi.mock("@/lib/native-app/is-native-summitt-mindset-app-request", () => ({
  detectSummittMindsetPlatformRequest: async () => "ios",
  isNativeSummittMindsetAppRequest: async () => true,
}));

vi.mock(
  "@/lib/account-deletion/account-deletion-initiation-access.server",
  () => ({
    shouldShowAccountDeletionDangerZone: () => false,
  })
);

vi.mock("@/components/ios-apple-membership-panel", () => ({
  default: function ApplePanelMarker() {
    return <div>APPLE_PANEL_MARKER</div>;
  },
}));

vi.mock("@/components/account-deletion-danger-zone", () => ({
  default: () => null,
}));

vi.mock("@/components/resume-membership-button", () => ({
  default: () => null,
}));

import AppMembershipPage from "@/app/app/membership/page";

describe("/app/membership existing-member recovery", () => {
  afterEach(() => {
    cleanup();
    currentUserMock.mockReset();
  });

  it("shows the signed-in email and puts account recovery above Apple", async () => {
    currentUserMock.mockResolvedValue({
      primaryEmailAddressId: "idn_1",
      emailAddresses: [{ id: "idn_1", emailAddress: "member@example.com" }],
      publicMetadata: {},
    });

    render(await AppMembershipPage());

    expect(
      screen.getByRole("heading", { name: "Let's find your membership" })
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Membership required" })).toBeNull();
    expect(screen.getByText("Signed in as:")).toBeTruthy();
    expect(screen.getByText("member@example.com")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Already a member?" })).toBeTruthy();
    expect(
      screen.getByText(
        "Sign in with the same email you used for Summitt Mindset on the website."
      )
    ).toBeTruthy();
    const switchAccount = screen.getByRole("button", {
      name: "Sign in with another email",
    });
    expect(switchAccount.className).toContain("bg-[var(--text)]");
    expect(switchAccount.closest("[data-redirect-url]")?.getAttribute("data-redirect-url")).toBe(
      "/app/sign-in"
    );
    expect(screen.getByRole("link", { name: "Sign out" }).getAttribute("href")).toBe(
      "/sign-out"
    );
    expect(document.body.textContent).not.toContain("user_");

    const body = document.body.textContent ?? "";
    expect(body.indexOf("Already a member?")).toBeLessThan(
      body.indexOf("APPLE_PANEL_MARKER")
    );
    expect(body.indexOf("Sign in with another email")).toBeLessThan(
      body.indexOf("APPLE_PANEL_MARKER")
    );
    expect(body.indexOf("Let's find your membership")).toBeLessThan(
      body.indexOf("Already a member?")
    );
  });

  it("does not invent an email when Clerk has none", async () => {
    currentUserMock.mockResolvedValue({
      emailAddresses: [],
      publicMetadata: {},
    });

    render(await AppMembershipPage());

    expect(screen.queryByText("Signed in as:")).toBeNull();
    expect(screen.getByRole("heading", { name: "Already a member?" })).toBeTruthy();
  });
});
