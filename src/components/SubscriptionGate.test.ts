import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GATE_SRC = readFileSync(
  join(process.cwd(), "src/components/SubscriptionGate.tsx"),
  "utf8"
);

describe("SubscriptionGate default redirect", () => {
  it("defaults redirectAfterSubscribe to MEMBER_APP_HOME_PATH", () => {
    expect(GATE_SRC).toContain('import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path"');
    expect(GATE_SRC).not.toContain('from "@/lib/onboarding-sob-gates"');
    expect(GATE_SRC).toContain("redirectAfterSubscribe = MEMBER_APP_HOME_PATH");
    expect(GATE_SRC).not.toMatch(/redirectAfterSubscribe\s*=\s*["']\/dashboard["']/);
  });

  it("still allows explicit redirectAfterSubscribe override via prop type", () => {
    expect(GATE_SRC).toContain("redirectAfterSubscribe?: string");
  });
});
