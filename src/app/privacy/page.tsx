export default function PrivacyPage() {
  return (
    <main className="max-w-3xl mx-auto py-12 sm:py-16 px-4 sm:px-6 space-y-10">
      <header>
        <h1 className="text-3xl sm:text-4xl font-bold mb-3">Privacy Policy</h1>
        <p className="text-gray-600 text-sm">
          Last updated: March 14, 2026
        </p>
      </header>

      <section className="space-y-4">
        <p className="text-gray-700">
          Summitt Mindset helps members hold one serious commitment with SMS accountability, optional
          in-app depth, and a Victory Room record of real choices.
        </p>
        <p className="text-gray-700">
          We take privacy seriously. This policy explains what we collect, how
          we use it, and your rights as a member.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Information We Collect</h2>
        <ul className="list-disc pl-5 text-gray-700 space-y-2">
          <li>Account information (email, name, phone number)</li>
          <li>Daily journaling reflections you choose to submit</li>
          <li>Subscription and billing status (via Stripe)</li>
          <li>Preferences such as timezone and coaching delivery time</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. How We Use Information</h2>
        <ul className="list-disc pl-5 text-gray-700 space-y-2">
          <li>Personalizing coaching, commitment context, and optional in-app depth</li>
          <li>Delivering SMS or email reminders (if enabled)</li>
          <li>Improving retention and member outcomes</li>
          <li>Providing support if you request help</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. SMS Privacy & Consent</h2>
        <p className="text-gray-700">
          If you opt into SMS coaching, you consent to receive recurring
          messages from Summitt Mindset related to your membership.
        </p>
        <p className="text-gray-700 font-medium">
          Message frequency varies. Msg &amp; data rates may apply. Reply
          <strong> STOP</strong> to cancel. Reply <strong>HELP</strong> for help.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Data Sharing</h2>
        <p className="text-gray-700">
          We do not sell, rent, or trade your personal information.
        </p>
        <p className="text-gray-700">
          We only share information with trusted service providers required to
          operate the platform (such as Stripe, Clerk, Supabase, and Twilio).
        </p>
        <p className="text-gray-700 font-medium">
          All the above categories exclude text messaging originator opt-in
          data and consent; this information will not be shared with any third
          parties for marketing or promotional purposes.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">5. Your Rights</h2>
        <p className="text-gray-700">
          You may request access, deletion, or export of your data at any time
          by emailing support@summittmindset.com.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Contact</h2>
        <p className="font-semibold">
          support@summittmindset.com
        </p>
      </section>
    </main>
  );
}
