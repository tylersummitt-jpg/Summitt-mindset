import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const privacy = readFileSync(
  path.join(process.cwd(), "src/app/privacy/page.tsx"),
  "utf8"
);

describe("privacy policy Meta Pixel website disclosure", () => {
  it("names Meta and describes website analytics / marketing purposes", () => {
    expect(privacy).toContain("Meta Platforms, Inc.");
    expect(privacy).toContain("Meta Pixel");
    expect(privacy).toMatch(/measure website usage/i);
    expect(privacy).toMatch(/marketing performance/i);
    expect(privacy).toMatch(/marketing funnel/i);
    expect(privacy).toMatch(/advertising effectiveness/i);
  });

  it("describes browser/device/cookie interaction data conservatively", () => {
    expect(privacy).toMatch(/IP address/i);
    expect(privacy).toMatch(/browser or device/i);
    expect(privacy).toMatch(/cookies or similar identifiers/i);
    expect(privacy).toMatch(/page URLs/i);
    expect(privacy).toMatch(/page views/i);
    expect(privacy).toMatch(/not an exhaustive list/i);
  });

  it("states native iOS exclusion without internal UA tokens", () => {
    expect(privacy).toMatch(/not loaded in the Summitt Mindset iOS app/i);
    expect(privacy).not.toContain("SummittMindsetiOS");
    expect(privacy).not.toContain("User-Agent");
  });

  it("states no intentional advanced matching of email/phone/name and no coaching content to Pixel", () => {
    expect(privacy).toMatch(/advanced matching/i);
    expect(privacy).toMatch(/email address, phone number, or name/i);
    expect(privacy).toMatch(/journal entries/i);
    expect(privacy).toMatch(/Ask Pat/i);
    expect(privacy).toMatch(/SMS message content/i);
    expect(privacy).toMatch(/payment card numbers/i);
  });

  it("preserves core providers, no-sale, support contact, and avoids unsupported legal claims", () => {
    for (const provider of [
      "Clerk",
      "Supabase",
      "Stripe",
      "Twilio",
      "Vercel",
      "OpenAI",
    ]) {
      expect(privacy).toContain(provider);
    }
    expect(privacy).toMatch(/do not sell personal information/i);
    expect(privacy).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY");
    expect(privacy).toContain("Account deletion");
    expect(privacy).not.toMatch(/Meta receives no personal data/i);
    expect(privacy).not.toMatch(/\bno tracking\b/i);
    expect(privacy).not.toMatch(/\banonymous\b/i);
    expect(privacy).not.toMatch(/GDPR compliant|CCPA compliant/i);
    expect(privacy).not.toMatch(/Apple approved|Google approved/i);
  });
});
