import type { Metadata } from "next";
import Link from "next/link";
import AccountDeletionAvailabilityNotice from "@/components/legal/AccountDeletionAvailabilityNotice";
import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
  getAccountDeletionPublicAvailability,
} from "@/lib/legal/account-deletion-public-availability";
import { PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE } from "@/lib/legal/public-legal-effective-dates";

export const metadata: Metadata = {
  title: "Data Deletion | Summitt Mindset",
  description:
    "How Summitt Mindset handles account deletion requests, what is removed, and what limited records may be retained.",
};

export default function DataDeletionPage() {
  const availability = getAccountDeletionPublicAvailability();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-3">
        <p className="text-sm text-[var(--muted)]">
          Updated {PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--text)] sm:text-4xl">
          Data deletion
        </h1>
        <p className="text-base leading-7 text-[var(--muted)] sm:text-lg">
          This page explains how Summitt Mindset account deletion works, what
          happens to your membership and app data, and how to get help.
        </p>
      </header>

      <div className="mt-8 space-y-8 text-[var(--text)]">
        <AccountDeletionAvailabilityNotice />

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            {availability.howToDeleteHeading}
          </h2>
          <p className="text-base leading-7 text-[var(--muted)]">
            {availability.howToDeleteBody}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Cancellation is not deletion
          </h2>
          <p className="text-base leading-7 text-[var(--muted)]">
            Canceling membership stops future billing and ends paid access, but
            it does not delete your account, journals, progress, or sign-in.
            Account deletion is a separate, permanent action.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            What happens when an account is deleted
          </h2>
          <p className="text-base leading-7 text-[var(--muted)]">
            Account deletion is permanent. When a deletion request is completed,
            Summitt Mindset:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
            <li>Stops Summitt Mindset text messages for that account</li>
            <li>Cancels an active or paused Summitt Mindset membership</li>
            <li>
              Deletes journals, progress, coaching history, preferences,
              Leadership Kit shipping addresses stored in our application
              database, and related app data owned by the account
            </li>
            <li>Deletes the sign-in identity used to access the service</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Limited records that may be retained
          </h2>
          <p className="text-base leading-7 text-[var(--muted)]">
            We do not claim that every record is instantly or universally erased.
            Limited information may be retained when required for:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
            <li>
              Payment, tax, fraud, dispute, accounting, or other legal
              obligations (including records retained by Stripe or other
              providers)
            </li>
            <li>SMS opt-out and messaging-compliance evidence</li>
            <li>Account-deletion orchestration or audit evidence</li>
            <li>Enforcement of deletion or messaging preferences</li>
            <li>
              Security, abuse-prevention, or operational emails and
              provider-side records subject to provider or legal retention
            </li>
          </ul>
          <p className="text-base leading-7 text-[var(--muted)]">
            More detail is in our{" "}
            <Link
              href="/privacy"
              className="underline underline-offset-4"
            >
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Need help?</h2>
          <p className="text-base leading-7 text-[var(--muted)]">
            Email{" "}
            <a
              href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
              className="underline underline-offset-4 break-all"
            >
              {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
            </a>
            . Include the email address on your account so we can locate the
            right request.
          </p>
        </section>
      </div>
    </main>
  );
}
