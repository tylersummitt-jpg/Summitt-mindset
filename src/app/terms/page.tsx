import type { Metadata } from "next";
import Link from "next/link";
import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
} from "@/lib/legal/account-deletion-public-availability";
import { TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE } from "@/lib/legal/public-legal-effective-dates";

export const metadata: Metadata = {
  title: "Terms of Service | Summitt Mindset",
  description:
    "Terms of Service for Summitt Mindset membership, SMS, and account use.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Terms of Service
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Effective / last updated: {TERMS_OF_SERVICE_PUBLIC_EFFECTIVE_DATE}
        </p>
      </header>

      <section className="space-y-4">
        <p className="text-base leading-7 text-[var(--muted)]">
          Welcome to Summitt Mindset. By using our platform, you agree to these
          Terms of Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Membership access</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          Access to Summitt Mindset requires a paid subscription unless we
          expressly provide another access path. You are responsible for
          maintaining your account credentials.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          2. Membership cancellation and account deletion
        </h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          Canceling membership stops future billing and ends paid access for that
          membership, but it does not delete your account, journals, progress, or
          sign-in. Account deletion is a separate, permanent action.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          When an account is deleted, an active or paused Summitt Mindset
          membership on that account is canceled as part of deletion. Deletion
          also stops Summitt Mindset text messages for that account and removes
          app data as described in our{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/data-deletion" className="underline underline-offset-4">
            Data Deletion
          </Link>{" "}
          page.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Refund handling remains governed by our existing billing practices and
          applicable law. These Terms do not create a new refund promise. Contact{" "}
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>{" "}
          with billing questions.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. SMS messaging terms</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          If you opt into SMS coaching, you agree to receive recurring
          membership-related messages from Summitt Mindset.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Message frequency varies. Message and data rates may apply. Reply{" "}
          <strong className="text-[var(--text)]">STOP</strong> to cancel. Reply{" "}
          <strong className="text-[var(--text)]">HELP</strong> for help.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Consent is not a condition of purchase. Carriers are not liable for
          delayed or undelivered messages. See our{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>{" "}
          for additional details.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Acceptable use</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          You agree not to misuse or exploit the platform for unlawful purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Disclaimer</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          Summitt Mindset provides educational and coaching-based tools, not
          medical or licensed professional advice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Contact</h2>
        <p className="text-base leading-7">
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="font-medium underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
        </p>
      </section>
    </main>
  );
}
