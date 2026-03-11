// src/app/twilio/page.tsx

export const metadata = {
  title: "SMS Opt-In & Compliance | Summitt Mindset",
  description:
    "Public SMS opt-in sample and compliance information for Summitt Mindset (Twilio A2P 10DLC).",
};

/**
 * ======================================================
 * Twilio Compliance Page — AUTHORITATIVE
 * ======================================================
 *
 * PUBLIC page for Twilio A2P 10DLC review.
 *
 * This page intentionally includes:
 * - Business identity + what we do
 * - Public contact info (address, email, phone)
 * - Policy links (privacy/terms/sms disclosure)
 * - Clear SMS use case (membership coaching only)
 * - STOP/HELP, frequency, rates, consent-not-required
 * - Public opt-in sample with phone field + unchecked checkbox in SAME section
 *
 * IMPORTANT:
 * - Summitt Mindset does NOT send marketing/promotional/lead-gen SMS.
 * - Messages are membership-related coaching + reminders only.
 */

export default function TwilioCompliancePage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-16">
      <header className="space-y-3">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Summitt Mindset — SMS Opt-In &amp; Compliance
        </h1>
        <p className="text-sm text-[var(--muted)]">
          This page is publicly accessible and is provided to support Twilio A2P
          10DLC campaign verification.
        </p>
      </header>

      {/* ======================================================
          BUSINESS INFORMATION
         ====================================================== */}
      <section className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h2 className="text-xl font-semibold">Business information</h2>

        <p className="text-sm leading-6 text-[var(--text)]">
          <strong>Summitt Mindset</strong> is a paid membership web application
          that helps members build consistency through a short daily practice
          (3–7 minutes), journaling, and calm coaching prompts inspired by Coach
          Pat Summitt.
        </p>

        <p className="text-sm leading-6 text-[var(--text)]">
          SMS messages are used only to support an active member’s training:
          daily practice reminders and coaching prompts that mirror the member’s
          in-app daily practice.
        </p>

        <div className="text-sm leading-6">
          <div className="font-semibold">Contact information</div>
          <div>Summitt Mindset, LLC</div>
          <div>1978 Oak Grove Road<br />Dandridge, Tennessee 37725</div>

          <div>
            Phone:{" "}
            <a className="underline" href="tel:+18652429243">
              +1 865-242-9243
            </a>
          </div>

          <div>
            Email:{" "}
            <a className="underline" href="mailto:support@summittmindset.com">
              support@summittmindset.com
            </a>
          </div>
        </div>

        <div className="text-sm">
          <span className="font-semibold">Policies:</span>{" "}
          <a className="underline" href="/privacy">
            Privacy Policy
          </a>{" "}
          •{" "}
          <a className="underline" href="/terms">
            Terms of Service
          </a>{" "}
          •{" "}
          <a className="underline" href="/sms">
            SMS Disclosure
          </a>
        </div>
      </section>

      {/* ======================================================
          SMS USE CASE (NO MARKETING)
         ====================================================== */}
      <section className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h2 className="text-xl font-semibold">SMS use case</h2>

        <p className="text-sm leading-6">
          <strong>
            Summitt Mindset does not send marketing, promotional, lead
            generation, or sales SMS messages.
          </strong>{" "}
          SMS is used only for membership coaching and daily practice reminders.
        </p>

        <ul className="list-disc pl-5 text-sm leading-6 space-y-2">
          <li>
            <strong>Type of messages:</strong> Membership-related coaching and
            reminders (daily practice + occasional weekly reflection).
          </li>

          <li>
            <strong>Marketing messages:</strong> None.
          </li>

          <li>
            <strong>Message frequency:</strong> Approximately 1 message/day.
            Some members may also receive an optional weekly reflection message.
          </li>

          <li>
            <strong>Rates:</strong> Message &amp; data rates may apply.
          </li>

          <li>
            <strong>Opt-out:</strong> Reply <strong>STOP</strong> to cancel at
            any time.
          </li>

          <li>
            <strong>Help:</strong> Reply <strong>HELP</strong> for help.
          </li>

          <li>
            <strong>Consent not required:</strong> SMS consent is not a condition
            of purchase.
          </li>
        </ul>
      </section>

      {/* ======================================================
          OPT-IN SAMPLE — MUST BE IN SAME SECTION AS PHONE FIELD
         ====================================================== */}
      <section className="mt-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
        <h2 className="text-xl font-semibold">SMS opt-in sample (public)</h2>

        <p className="text-sm leading-6 text-[var(--muted)]">
          This is an example of the SMS opt-in UI shown to members. The consent
          checkbox is <strong>not</strong> preselected and appears in the same
          section where the phone number is collected.
        </p>

        <div className="rounded-2xl border border-[var(--border)] p-5 space-y-4">
          <div className="text-sm font-semibold">Daily Training Text</div>

          <div className="text-sm text-[var(--muted)]">
            One message per day with your practice and a calm Coach Pat nudge.
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Mobile Number</label>
            <input
              type="tel"
              placeholder="Enter your mobile number"
              className="w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
              aria-label="Mobile Number"
            />
          </div>

          {/* Consent checkbox in SAME section as phone input */}
          <label className="flex items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              defaultChecked={false}
              aria-label="SMS Consent Checkbox"
            />

            <span>
              By checking this box, I agree to receive recurring membership SMS
              messages from <strong>Summitt Mindset, LLC</strong> related to my
              training (daily practice reminders and coaching prompts). Message
              frequency varies. Msg &amp; data rates may apply. Reply{" "}
              <strong>STOP</strong> to opt out. Reply <strong>HELP</strong> for
              help. Consent is not a condition of purchase.{" "}
              <a href="/privacy" className="underline">
                Privacy Policy
              </a>
              .
            </span>
          </label>

          <div className="text-xs text-[var(--muted)]">
            Note: Summitt Mindset does not send marketing, promotional, lead
            generation, or sales SMS messages and does not use third-party
            lists.
          </div>
        </div>
      </section>

      {/* ======================================================
          FINAL LEGITIMACY SIGNALS
         ====================================================== */}
      <section className="mt-10 text-sm text-[var(--muted)]">
        <p>
          If you have any questions, contact{" "}
          <a className="underline" href="mailto:support@summittmindset.com">
            support@summittmindset.com
          </a>
          .
        </p>
      </section>
    </main>
  );
}
