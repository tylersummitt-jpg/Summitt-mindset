import type { Metadata } from "next";
import Link from "next/link";
import {
  ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE,
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
} from "@/lib/legal/account-deletion-public-availability";

export const metadata: Metadata = {
  title: "Privacy Policy | Summitt Mindset",
  description:
    "How Summitt Mindset collects, uses, shares, and deletes personal information.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Effective / last updated: {ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE}
        </p>
      </header>

      <section className="space-y-4 text-base leading-7 text-[var(--muted)]">
        <p>
          Summitt Mindset helps members hold one serious commitment with SMS
          accountability, optional in-app depth, and a record of real choices.
          This Privacy Policy explains what information we collect, how we use
          it, how we share it with service providers, and how account deletion
          works.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Information we collect</h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>
            <strong className="font-medium text-[var(--text)]">
              Account and authentication information
            </strong>
            — such as email address, name, and sign-in identity managed through
            our authentication provider.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Subscription and billing information
            </strong>
            — membership status and payment-related records processed through
            Stripe. We do not store full payment card numbers on our servers.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              SMS and messaging information
            </strong>
            — phone number, opt-in/consent status, message delivery and reply
            activity, and STOP/START (or equivalent) messaging preferences when
            you use Summitt Mindset texting.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              App and coaching content
            </strong>
            — journals, goals, reflections, coaching history, progress, and
            preferences you create or configure in the product (such as timezone
            or delivery timing).
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Technical and support information
            </strong>
            — limited device/browser or usage signals needed to operate and
            secure the service, and messages you send to support.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. How we use information</h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>Create and secure your account</li>
          <li>Provide membership, billing, and access control</li>
          <li>
            Deliver SMS and related coaching communications you have opted into
          </li>
          <li>
            Personalize coaching, commitment context, and optional in-app depth
          </li>
          <li>Operate AI-assisted coaching features where enabled</li>
          <li>Respond to support requests and protect against abuse or fraud</li>
          <li>Meet legal, tax, dispute, and compliance obligations</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. SMS privacy and consent</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          If you opt into SMS coaching, you consent to receive recurring messages
          from Summitt Mindset related to your membership. Message frequency
          varies. Message and data rates may apply. Reply{" "}
          <strong className="text-[var(--text)]">STOP</strong> to cancel. Reply{" "}
          <strong className="text-[var(--text)]">HELP</strong> for help. Reply{" "}
          <strong className="text-[var(--text)]">START</strong> (or follow
          carrier/program instructions) if you wish to resume where supported.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Account deletion also stops Summitt Mindset text messages for that
          account. Canceling membership alone does not delete your account; see
          our{" "}
          <Link href="/data-deletion" className="underline underline-offset-4">
            Data Deletion
          </Link>{" "}
          page.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Service providers</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          We use trusted service providers to operate Summitt Mindset. Depending
          on the feature, that may include:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>Clerk — authentication and sign-in identity</li>
          <li>Supabase — application data storage</li>
          <li>Stripe — subscription and payment processing</li>
          <li>Twilio — SMS delivery and related messaging infrastructure</li>
          <li>Vercel — application hosting and delivery</li>
          <li>
            OpenAI — AI processing used to generate or support coaching-related
            content where those features are enabled
          </li>
        </ul>
        <p className="text-base leading-7 text-[var(--muted)]">
          These providers process information only as needed to provide their
          services to us. We do not sell personal information. Text messaging
          originator opt-in data and consent are not shared with third parties
          for their marketing or promotional purposes.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          We do not claim that OpenAI or other AI providers train their general
          models on your Summitt Mindset content under this policy. AI features
          process relevant context to operate the product.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Account deletion</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          You may request permanent deletion of your Summitt Mindset account.
          Deletion is separate from canceling membership. Canceling membership
          stops future billing and paid access but keeps your account and app
          data unless you also delete the account.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          When an account deletion is completed, we stop Summitt Mindset text
          messages for that account, cancel an active or paused membership,
          delete journals, progress, coaching history, preferences, and related
          app data owned by the account, and delete the sign-in identity used to
          access the service.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Signed-in members can open Account, select Delete account in the
          Danger zone, confirm by typing DELETE, and re-verify their identity.
          Inactive or new app users without an active membership can start the
          same deletion flow from the Membership required screen. Deletion is
          permanent and may take time to finish processing. Support remains
          available at{" "}
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
          . See{" "}
          <Link href="/data-deletion" className="underline underline-offset-4">
            Data Deletion
          </Link>{" "}
          for details.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Limited retained records</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          We do not claim that all data is instantly or universally erased. After
          deletion, limited records may be retained when required for:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>
            Payment, tax, fraud, dispute, or other legal obligations
          </li>
          <li>SMS opt-out and messaging-compliance evidence</li>
          <li>Account-deletion orchestration or audit evidence</li>
          <li>Enforcement of deletion or messaging preferences</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">7. Your choices</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          You may update account preferences in the product where available,
          manage SMS consent with STOP/HELP/START as described above, cancel
          membership without deleting your account, or request account deletion
          as described on the{" "}
          <Link href="/data-deletion" className="underline underline-offset-4">
            Data Deletion
          </Link>{" "}
          page. For access or other privacy questions, email{" "}
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
        <h2 className="text-xl font-semibold">8. Contact</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="font-medium text-[var(--text)] underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
        </p>
      </section>
    </main>
  );
}
