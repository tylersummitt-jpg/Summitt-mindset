import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(process.cwd(), "src/components/Navbar.tsx"),
  "utf8"
);

function slice(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Navbar explicit Home item", () => {
  const publicBlock = slice("const publicLinks", "const appLinks");
  const appBlock = slice("const appLinks", "const navLinks");

  it("logged-out navigation still includes Home", () => {
    expect(publicBlock).toContain('{ href: "/", label: "Home", key: "home" }');
  });

  it("signed-in unsubscribed navigation still includes Home, including paused and ended", () => {
    expect(appBlock).toContain("...(!isSubscribed");
    expect(appBlock).toContain('{ href: "/", label: "Home", key: "home" }');
    expect(source).toContain('const isPaused = plan === "paused"');
    expect(source).not.toMatch(/isPaused[\s\S]{0,80}label: "Home"/);
  });

  it("signed-in subscribed navigation omits Home using the existing isSubscribed rule", () => {
    expect(source).toContain(
      'subscribedRaw === true ||\n    subscribedRaw === "true" ||\n    plan === "monthly" ||\n    plan === "annual"'
    );
    expect(appBlock).toContain("...(!isSubscribed");
    expect(appBlock).not.toMatch(
      /const appLinks = \[\s*\{ href: "\/", label: "Home"/
    );
  });

  it("wordmark still links to /", () => {
    expect(source).toContain(
      '<Link href="/" className="font-semibold text-lg tracking-tight text-[var(--text)]">'
    );
  });

  it("desktop and mobile both render the shared navLinks list", () => {
    expect(source).toContain("const navLinks = isSignedIn ? appLinks : publicLinks");
    const desktop = source.indexOf('className="hidden md:flex gap-4 text-sm"');
    const mobile = source.indexOf('className="md:hidden border-t border-[var(--border)]');
    expect(desktop).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(desktop);
    expect(source.slice(desktop, mobile)).toContain("{navLinks.map((link) => (");
    expect(source.slice(mobile)).toContain("{navLinks.map((link) => (");
  });

  it("keeps Victory Room, Ask Pat, Film Room, Programs, Account, and conditional Subscribe", () => {
    expect(appBlock).toContain('href: "/dashboard/victory-room", label: "Victory Room"');
    expect(appBlock).toContain('href: "/ask-pat", label: "Ask Pat"');
    expect(appBlock).toContain('href: "/film-room", label: "Film Room"');
    expect(appBlock).toContain('href: "/programs", label: "Programs"');
    expect(appBlock).toContain('href: "/user", label: "Account"');
    expect(appBlock).toContain("!isNativeApp && !isSubscribed && !isPaused");
    expect(appBlock).toContain('href: "/subscribe", label: "Subscribe"');
  });
});

describe("root and post-sign-in routing stay independent of Home visibility", () => {
  it("does not change / or /post-sign-in", () => {
    const home = readFileSync(
      path.join(process.cwd(), "src/app/page.tsx"),
      "utf8"
    );
    const post = readFileSync(
      path.join(process.cwd(), "src/app/post-sign-in/page.tsx"),
      "utf8"
    );
    expect(home).toContain("isSubscribedFromPublicMetadata(user.publicMetadata)");
    expect(home).toContain('redirect("/post-sign-in")');
    expect(post).toContain("redirect(MEMBER_APP_HOME_PATH)");
    expect(source).not.toContain("post-sign-in");
    expect(source).not.toContain("MEMBER_APP_HOME_PATH");
  });
});
