import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE,
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
  getAccountDeletionPublicAvailability,
} from "@/lib/legal/account-deletion-public-availability";
import {
  PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE,
  TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE,
} from "@/lib/legal/public-legal-effective-dates";

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

function assertSharedRetentionCategories(page: string): void {
  expect(page).toMatch(/Stripe|payment.?provider|providers/i);
  expect(page).toMatch(/SMS opt-out|STOP|messaging-compliance|opt-out/i);
  expect(page).toMatch(/Account-deletion orchestration or audit|audit evidence/i);
  expect(page).toMatch(
    /operational emails|provider-side records|provider or legal retention/i
  );
  expect(page).toMatch(
    /Payment, tax, fraud, dispute, accounting|tax, fraud, dispute, accounting|legal obligations/i
  );
  expect(page).toMatch(/Security, abuse-prevention|fraud|abuse|security/i);
}

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

  it("keeps Privacy/Data Deletion dates separate from Terms", () => {
    const privacy = readSrc("src/app/privacy/page.tsx");
    const dataDeletion = readSrc("src/app/data-deletion/page.tsx");
    const terms = readSrc("src/app/terms/page.tsx");
    const dates = readSrc("src/lib/legal/public-legal-effective-dates.ts");

    expect(PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE).toBe(
      "July 28, 2026"
    );
    expect(TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE).toBe("July 21, 2026");
    expect(PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE).not.toBe(
      TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE
    );

    expect(privacy).toContain("PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE");
    expect(privacy).not.toContain("TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE");
    expect(dataDeletion).toContain(
      "PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE"
    );
    expect(dataDeletion).not.toContain("TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE");
    expect(terms).toContain("TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE");
    expect(terms).not.toContain(
      "PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE"
    );

    expect(dates).toMatch(
      /PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE\s*=\s*"July 28, 2026"/
    );
    expect(dates).toMatch(
      /TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE\s*=\s*"July 21, 2026"/
    );
    expect(dates).not.toContain("ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE");
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
    expect(page).toMatch(
      /Leadership Kit shipping addresses stored in our application\s+database/i
    );
    expect(page).not.toMatch(
      /delete[^.]*Leadership Kit[^.]*email|delete[^.]*Resend/i
    );
    expect(page).toContain("sign-in identity");
    expect(page).toContain("Limited records that may be retained");
    expect(page).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY");
    expect(page).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_HREF");
    expect(page).toContain("AccountDeletionAvailabilityNotice");
    expect(notice).toContain("getAccountDeletionPublicAvailability");
    expect(availabilitySrc).toContain(ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY);
    expect(availabilitySrc).toContain("Membership required");
    expect(availabilitySrc).not.toContain(
      "ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE"
    );
    expect(ACCOUNT_DELETION_SUPPORT_EMAIL_HREF).toBe(
      "mailto:support@summittmindset.com"
    );
  });

  it("keeps Privacy and Data Deletion retained-record categories aligned", () => {
    const privacy = readSrc("src/app/privacy/page.tsx");
    const dataDeletion = readSrc("src/app/data-deletion/page.tsx");

    assertSharedRetentionCategories(privacy);
    assertSharedRetentionCategories(dataDeletion);

    expect(privacy).toMatch(
      /records retained by Stripe or other\s+providers/i
    );
    expect(dataDeletion).toMatch(
      /records retained by Stripe or other\s+providers/i
    );
    expect(privacy).toMatch(
      /operational emails and provider-side\s+records subject to provider or legal retention/i
    );
    expect(dataDeletion).toMatch(
      /operational emails and\s+provider-side records subject to provider or legal retention/i
    );
  });

  it("privacy policy covers deletion, retention, providers, Meta Pixel, and contact", () => {
    const privacy = readSrc("src/app/privacy/page.tsx");

    expect(privacy).toContain("PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE");
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
    expect(privacy).toContain("Resend");
    expect(privacy).toMatch(/Meta Platforms, Inc\.|Meta Pixel/);
    expect(privacy).toMatch(/website analytics|marketing performance/i);
    expect(privacy).toMatch(/cookies or similar identifiers/i);
    expect(privacy).toMatch(
      /Meta Pixel is not loaded in the Summitt Mindset iOS app\s+or the Summitt Mindset Android app/i
    );
    expect(privacy).toMatch(
      /Leadership\s+Kit shipping addresses stored in our application\s+database/i
    );
    expect(privacy).toMatch(/advanced matching/i);
    expect(privacy).toMatch(/do not sell personal information/i);
    expect(privacy).toContain("STOP");
    expect(privacy).toContain('href="/data-deletion"');
    expect(privacy).toContain("ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY");
    expect(privacy).not.toMatch(/OpenAI trains on/i);
    expect(privacy).not.toMatch(/being finalized for public availability/i);
    expect(privacy).not.toMatch(/Meta receives no personal data/i);
    expect(privacy).not.toMatch(/GDPR compliant|CCPA compliant/i);
    expect(privacy).not.toMatch(/Apple approved|Google approved/i);
  });

  it("terms distinguish cancellation from deletion without inventing refunds", () => {
    const terms = readSrc("src/app/terms/page.tsx");

    expect(terms).toContain("Membership cancellation and account deletion");
    expect(terms).toContain("does not delete your account");
    expect(terms).toContain("active or paused");
    expect(terms).toContain("do not create a new refund promise");
    expect(terms).toContain('href="/data-deletion"');
    expect(terms).toContain("TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE");
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
      readSrc("src/lib/legal/public-legal-effective-dates.ts"),
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
