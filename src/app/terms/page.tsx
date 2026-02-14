export default function TermsPage() {
  return (
    <main className="max-w-3xl mx-auto py-16 px-6 space-y-10">
      <header>
        <h1 className="text-4xl font-bold mb-3">Terms of Service</h1>
        <p className="text-gray-600 text-sm">
          Last updated: {new Date().toLocaleDateString()}
        </p>
      </header>

      <section className="space-y-4">
        <p className="text-gray-700">
          Welcome to Summitt Mindset. By using our platform, you agree to these
          Terms of Service.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Membership Access</h2>
        <p className="text-gray-700">
          Access to Summitt Mindset requires a paid subscription. You are
          responsible for maintaining your account credentials.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. SMS Messaging Terms</h2>
        <p className="text-gray-700">
          If you opt into SMS coaching, you agree to receive recurring
          membership-related messages from Summitt Mindset.
        </p>

        <p className="text-gray-700 font-medium">
          Message frequency varies. Msg &amp; data rates may apply.
          Reply <strong>STOP</strong> to cancel. Reply <strong>HELP</strong> for help.
        </p>

        <p className="text-gray-700">
          Consent is not a condition of purchase.
        </p>

        <p className="text-gray-700">
          Carriers are not liable for delayed or undelivered messages.
        </p>

        <p className="text-gray-700">
          See our{" "}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>{" "}
          for additional details.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. Acceptable Use</h2>
        <p className="text-gray-700">
          You agree not to misuse or exploit the platform for unlawful purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Disclaimer</h2>
        <p className="text-gray-700">
          Summitt Mindset provides educational and coaching-based tools, not
          medical or licensed professional advice.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Contact</h2>
        <p className="font-semibold">
          support@summittmindset.com
        </p>
      </section>
    </main>
  );
}
