import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const privacy = readSrc("src/app/privacy/page.tsx");
const layout = readSrc("src/app/layout.tsx");

const SECTION_HEADINGS = [
  "1. Information we collect",
  "2. How we use information",
  "3. SMS privacy and consent",
  "4. Service providers",
  "5. Website analytics and advertising measurement",
  "6. Embedded video (Vimeo)",
  "7. Hosting, technical logs, and approximate location",
  "8. Account deletion",
  "9. Limited retained records",
  "10. Your choices",
  "11. Contact",
];

describe("privacy policy Google advertising measurement disclosure", () => {
  it("keeps every existing section and the page typography classes", () => {
    for (const heading of SECTION_HEADINGS) {
      expect(privacy).toContain(heading);
    }
    expect(privacy).toContain(
      'className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14"'
    );
    expect(privacy).toContain(
      'className="text-3xl font-semibold tracking-tight sm:text-4xl"'
    );
    expect(privacy).toContain('className="text-sm text-[var(--muted)]"');
    expect(privacy).toContain('className="text-xl font-semibold"');
    expect(privacy).toContain(
      'className="space-y-4 text-base leading-7 text-[var(--muted)]"'
    );
    expect(privacy).toContain('className="text-base leading-7 text-[var(--muted)]"');
    expect(privacy).toContain('className="underline underline-offset-4"');
    expect(privacy).toContain(
      'className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]"'
    );
    expect(privacy).not.toMatch(/font-serif|font-mono|fontFamily|next\/font/);
    expect(layout).toContain("const inter = Inter(");
    expect(layout).toContain("${inter.className}");
  });

  it("discloses limited United States Google conversion measurement", () => {
    expect(privacy).toContain("Google LLC");
    expect(privacy).toContain("gclid");
    expect(privacy).toContain("wbraid");
    expect(privacy).toContain("gbraid");
    expect(privacy).toMatch(/gclid when present, otherwise wbraid,\s+otherwise gbraid/);
    expect(privacy).toMatch(
      /For an eligible United\s+States checkout, we may send Google one conversion for a verified\s+free-trial start and one for the first successful subscription\s+payment/
    );
    expect(privacy).toMatch(
      /When the checkout country is the United States, we may send Google a\s+conversion for a verified free-trial start or a first successful\s+subscription payment/
    );
    expect(privacy).toMatch(/actual US dollar amount of that\s+first payment/);
    expect(privacy).toMatch(/do not\s+enable enhanced conversions or\s+customer matching/);
    expect(privacy).toMatch(
      /We do not send that country, or the IP address\s+it came from, to Google/
    );
    expect(privacy).not.toMatch(/do not currently send/);
    expect(privacy).not.toMatch(/If a conversion\s+is sent later/);
    expect(privacy).not.toMatch(/Google has (already )?(processed|attributed|received)/i);
    expect(privacy).toMatch(/There is no separate on-site switch for Google measurement\./);
    expect(privacy).not.toMatch(/on-site switch for Google measurement yet/);
    expect(privacy).not.toMatch(/consent choice/);
    expect(privacy).not.toMatch(/record of that visitor/);
    expect(privacy).not.toMatch(/unless we\s+have a record/);
    expect(privacy).not.toMatch(/enhanced conversions are enabled/i);
    expect(privacy).not.toMatch(/we (use|enable) Customer Match\b/i);
    expect(privacy).toContain("https://business.safety.google/privacy/");
    expect(privacy).toContain("How Google uses information from sites or apps that use our services");
    expect(privacy).toMatch(/name, email address, phone\s+number, IP address/);
    expect(privacy).toMatch(/SMS messages,\s+journals, goals, Victory Room\s+content/);
    expect(privacy).toMatch(/do not load a\s+Google tag, Google Analytics, or Google Tag Manager/);
    expect(privacy).toMatch(
      /remove a Google click identifier stored\s+on checkout records/
    );
    expect(privacy).toMatch(/at least seven days after the trial ends/);
    expect(privacy).toMatch(/eligible for Google Ads\s+conversion measurement/);
    expect(privacy).toMatch(/except the IP-derived country\s+saved when website checkout begins/);
    expect(privacy).not.toMatch(/we currently send conversion events to Google/i);
    expect(privacy).not.toMatch(/Google approved|GDPR compliant|CCPA compliant/i);
  });

  it("leaves the existing Meta, Vimeo, SMS, and no-sale disclosures in place", () => {
    expect(privacy).toContain("Meta Platforms, Inc.");
    expect(privacy).toContain("Conversions API");
    expect(privacy).toMatch(/advanced matching/i);
    expect(privacy).toMatch(/do not sell personal information/i);
    expect(privacy).toContain("Embedded video (Vimeo)");
    expect(privacy).toContain("STOP");
    expect(privacy).toContain('href="/data-deletion"');
    expect(privacy).toMatch(
      /Meta Pixel is not loaded in the Summitt Mindset iOS app\s+or the Summitt Mindset Android app/
    );
  });
});
