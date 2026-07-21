import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE,
  ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE,
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
  getAccountDeletionPublicAvailability,
} from "@/lib/legal/account-deletion-public-availability";

const root = process.cwd();

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const INTERNAL_LEAK_PATTERNS = [
  /ACCOUNT_DELETION_INITIATION_ENABLED/,
  /ACCOUNT_DELETION_SCHEDULER_ENABLED/,
  /ACCOUNT_DELETION_TEST_MODE/,
  /designated.?test.?account/i,
  /request_id|requestId/,
  /sk_live|sk_test|whsec_|OPENAI_API_KEY/,
  /user_[a-zA-Z0-9]{20,}/,
  /cus_[a-zA-Z0-9]+/,
  /sub_[a-zA-Z0-9]+/,
];

describe("store-facing account deletion disclosures", () => {
  it("public in-app deletion availability is active in copy", () => {
    expect(ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE).toBe(true);
    const availability = getAccountDeletionPublicAvailability();
    expect(availability.inAppAvailable).toBe(true);
    expect(availability.statusBody).toMatch(/Delete account/i);
    expect(availability.statusBody).toMatch(/Danger zone/i);
    expect(availability.statusBody).toMatch(/Account/i);
    expect(availability.statusBody).toMatch(/Membership required/i);
    expect(availability.statusBody).toMatch(/permanent/i);
    expect(availability.statusBody).toMatch(/may take time/i);
    expect(availability.statusBody).not.toMatch(
      /being finalized for public availability/i
    );
    expect(availability.statusBody).not.toMatch(
      /not shown to every member yet/i
    );
    expect(availability.howToDeleteBody).toMatch(/Canceling membership/i);
    expect(availability.howToDeleteBody).toMatch(
      /Limited legally required records/i
    );
    expect(availability.howToDeleteBody).toContain(
      ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY
    );
  });

  it("renders truthful activated /data-deletion copy", () => {
    const page = readSrc("src/app/data-deletion/page.tsx");
    const notice = readSrc(
      "src/components/legal/AccountDeletionAvailabilityNotice.tsx"
    );
    const availabilitySrc = readSrc(
      "src/lib/legal/account-deletion-public-availability.ts"
    );

    expect(page).toContain('href="/privacy"');
    expect(page).toContain("Cancellation is not deletion");
    expect(page).toContain("permanent");
    expect(page).toContain("Stops Summitt Mindset text messages");
    expect(page).toContain("Cancels an active or paused");
    expect(page).toContain("journals, progress, coaching history");
    expect(page).toContain("sign-in identity");
    expect(page).toContain("Limited records that may be retained");
    expect(page).toMatch(/[Pp]ayment, tax, fraud, dispute/);
    expect(page).toContain("SMS opt-out");
    expect(page).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY");
    expect(page).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_HREF");
    expect(page).toContain("AccountDeletionAvailabilityNotice");
    expect(notice).toContain("getAccountDeletionPublicAvailability");
    expect(availabilitySrc).toContain(ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY);
    expect(availabilitySrc).toContain("Membership required");
    expect(ACCOUNT_DELETION_SUPPORT_EMAIL_HREF).toBe(
      "mailto:support@summittmindset.com"
    );
  });

  it("privacy policy covers deletion, retention, providers, and contact", () => {
    const privacy = readSrc("src/app/privacy/page.tsx");

    expect(ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE).toBe("July 21, 2026");
    expect(privacy).toContain("ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE");
    expect(privacy).toContain("Account deletion");
    expect(privacy).toContain("Danger zone");
    expect(privacy).toContain("Membership required");
    expect(privacy).toContain("Limited retained records");
    expect(privacy).toContain("Clerk");
    expect(privacy).toContain("Supabase");
    expect(privacy).toContain("Stripe");
    expect(privacy).toContain("Twilio");
    expect(privacy).toContain("Vercel");
    expect(privacy).toContain("OpenAI");
    expect(privacy).toMatch(/do not sell personal information/i);
    expect(privacy).toContain("STOP");
    expect(privacy).toContain('href="/data-deletion"');
    expect(privacy).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY");
    expect(privacy).not.toMatch(/OpenAI trains on/i);
    expect(privacy).not.toMatch(/being finalized for public availability/i);
  });

  it("terms distinguish cancellation from deletion without inventing refunds", () => {
    const terms = readSrc("src/app/terms/page.tsx");

    expect(terms).toContain("Membership cancellation and account deletion");
    expect(terms).toContain("does not delete your account");
    expect(terms).toContain("active or paused");
    expect(terms).toContain("do not create a new refund promise");
    expect(terms).toContain('href="/data-deletion"');
  });

  it("public footer includes Privacy, Terms, and Data Deletion links", () => {
    const layout = readSrc("src/app/layout.tsx");
    expect(layout).toContain('href="/privacy"');
    expect(layout).toContain('href="/terms"');
    expect(layout).toContain('href="/data-deletion"');
    expect(layout).toContain("Data Deletion");
  });

  it("keeps /data-deletion on the public middleware allowlist", () => {
    const middleware = readSrc("src/middleware.ts");
    expect(middleware).toMatch(/["']\/data-deletion["']/);
  });

  it("does not expose internal IDs, flag names, or secrets on legal pages", () => {
    const surfaces = [
      readSrc("src/app/data-deletion/page.tsx"),
      readSrc("src/app/privacy/page.tsx"),
      readSrc("src/app/terms/page.tsx"),
      readSrc("src/components/legal/AccountDeletionAvailabilityNotice.tsx"),
      readSrc("src/lib/legal/account-deletion-public-availability.ts"),
    ].join("\n");

    for (const pattern of INTERNAL_LEAK_PATTERNS) {
      expect(surfaces, String(pattern)).not.toMatch(pattern);
    }
  });

  it("rollback copy path still available via helper argument", () => {
    const transitional = getAccountDeletionPublicAvailability(false);
    expect(transitional.inAppAvailable).toBe(false);
    expect(transitional.statusBody).toMatch(
      /being finalized for public availability/i
    );
  });
});
