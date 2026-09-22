import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Navbar Programs link", () => {
  it("places Programs after Film Room and before Account for signed-in members only", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/Navbar.tsx"), "utf8");
    const publicStart = source.indexOf("const publicLinks");
    const appStart = source.indexOf("const appLinks");
    const navStart = source.indexOf("const navLinks");
    const publicBlock = source.slice(publicStart, appStart);
    const appBlock = source.slice(appStart, navStart);

    expect(publicBlock).not.toContain("/programs");
    const film = appBlock.indexOf('href: "/film-room"');
    const programs = appBlock.indexOf('href: "/programs"');
    const account = appBlock.indexOf('href: "/user"');
    expect(film).toBeGreaterThan(-1);
    expect(programs).toBeGreaterThan(film);
    expect(account).toBeGreaterThan(programs);
  });
});
