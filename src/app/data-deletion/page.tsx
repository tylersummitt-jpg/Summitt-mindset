export default function DataDeletionPage() {
  return (
    <main className="max-w-3xl mx-auto py-12 sm:py-16 px-4 sm:px-6 space-y-10">
      <header>
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">Data Deletion</h1>
        <p className="text-gray-600 text-sm">
          Last updated: March 14, 2026
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">How to Request Deletion</h2>
        <p className="text-gray-700">
          You may request account and data deletion at any time by emailing{" "}
          <a href="mailto:support@summittmindset.com" className="underline">
            support@summittmindset.com
          </a>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">What We May Delete</h2>
        <p className="text-gray-700">
          Upon verified request, we may delete the following categories of data:
        </p>
        <ul className="list-disc pl-5 text-gray-700 space-y-2">
          <li>Account information (email, name, phone number)</li>
          <li>Journal entries and daily reflections</li>
          <li>SMS identity and opt-in records</li>
          <li>Feedback and coaching conversation history</li>
          <li>Subscription-related app records</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Payment Information</h2>
        <p className="text-gray-700">
          Payment card information is handled by Stripe and is not stored
          directly by Summitt Mindset. To manage or delete payment data, use
          your Stripe customer portal or contact us for assistance.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Identity Verification</h2>
        <p className="text-gray-700">
          Deletion requests may require identity verification to protect your
          data. We will respond to your request as promptly as possible.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Contact</h2>
        <p className="font-semibold">
          support@summittmindset.com
        </p>
      </section>
    </main>
  );
}
