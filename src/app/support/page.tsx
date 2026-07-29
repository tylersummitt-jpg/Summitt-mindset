import type { Metadata } from "next";
import Link from "next/link";
import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
} from "@/lib/legal/account-deletion-public-availability";

export const metadata: Metadata = {
  title: "Support | Summitt Mindset",
  description:
    "Contact Summitt Mindset support for account access, SMS, billing, app help, privacy, and account deletion questions.",
};

export default function SupportPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Support
        </h1>
        <p className="text-base leading-7 text-[var(--muted)] sm:text-lg">
          This is the official Summitt Mindset support page. You do not need an
          account or membership to view it or to email us for help.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Contact support</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          Email{" "}
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="font-medium text-[var(--text)] underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
          . Include the email address on your account when you can, so we can
          locate the right request. Response times may vary.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">What we can help with</h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>Sign-in help and account access</li>
          <li>SMS coaching questions and messaging preferences</li>
          <li>Subscription, billing, or membership questions</li>
          <li>App or website issues</li>
          <li>Privacy questions and account deletion requests</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">SMS opt-out</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          If you receive Summitt Mindset text messages and want to stop them,
          reply{" "}
          <strong className="text-[var(--text)]">STOP</strong> to the message.
          You can also email support if you need help with messaging
          preferences.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Account deletion</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          Signed-in members can delete their account in the app from Account →
          Danger zone → Delete account. Members without an active membership can
          start the same flow from the Membership required screen. Canceling
          membership alone is different from deleting your account. For full
          details, see our{" "}
          <Link
            href="/data-deletion"
            className="underline underline-offset-4"
          >
            Data Deletion
          </Link>{" "}
          page. If you need help with a deletion request, email{" "}
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Policies</h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>
            <Link href="/privacy" className="underline underline-offset-4">
              Privacy Policy
            </Link>
          </li>
          <li>
            <Link
              href="/data-deletion"
              className="underline underline-offset-4"
            >
              Data Deletion
            </Link>
          </li>
          <li>
            <Link href="/terms" className="underline underline-offset-4">
              Terms of Service
            </Link>
          </li>
        </ul>
      </section>
    </main>
  );
}
