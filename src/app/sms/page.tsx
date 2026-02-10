export const metadata = {
  title: "SMS Consent & Messaging Disclosure | Summitt Mindset",
  description:
    "SMS consent and messaging disclosure for Summitt Mindset daily practice texts.",
};

export default function SmsDisclosurePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        SMS Consent & Messaging Disclosure
      </h1>

      <p className="mt-6 text-base leading-7 text-muted-foreground">
        Summitt Mindset sends SMS messages only to users who have explicitly
        opted in during onboarding inside the Summitt Mindset web application.
      </p>

      <section className="mt-10 space-y-6">
        <div>
          <h2 className="text-xl font-semibold">What messages are sent?</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            Summitt Mindset sends SMS messages related to a user’s paid
            membership. Messages include daily practice reminders, habit
            coaching prompts, and optional weekly reflection questions.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">How do users opt in?</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            Users opt in during account onboarding inside the Summitt Mindset web
            application by entering their phone number and checking an explicit,
            unchecked consent checkbox agreeing to receive recurring SMS
            messages. Consent is never pre-checked.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Message frequency</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            Message frequency is approximately 1 message per day. Some users may
            also receive an optional weekly reflection message.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Opt-out and help</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            Users can opt out at any time by replying <strong>STOP</strong>.
            Users can receive help by replying <strong>HELP</strong>. Message
            and data rates may apply.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">No third-party lists</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            Summitt Mindset does not use third-party lists and does not send SMS
            messages for lead generation. SMS messages are only sent to users
            who have explicitly opted in.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Privacy and terms</h2>
          <p className="mt-2 text-base leading-7 text-muted-foreground">
            For more information, please review our{" "}
            <a href="/privacy" className="underline underline-offset-4">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a href="/terms" className="underline underline-offset-4">
              Terms &amp; Conditions
            </a>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
