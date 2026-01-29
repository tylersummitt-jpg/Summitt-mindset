/**
 * ======================================================
 * Onboarding Layout (Retention Shell)
 * ======================================================
 *
 * Removes distractions.
 * Makes onboarding feel like a guided climb.
 */

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div className="w-full max-w-2xl py-16 space-y-10">
        {/* Summit Identity Header */}
        <header className="text-center space-y-2">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Training Camp Setup
          </p>
          <h1 className="text-2xl font-bold">
            Your climb starts here.
          </h1>
          <p className="text-gray-600 text-sm">
            Just a few calm steps to personalize your daily practice.
          </p>
        </header>

        {/* Main Onboarding Content */}
        <section className="bg-white border rounded-xl shadow-sm p-8">
          {children}
        </section>
      </div>
    </main>
  );
}
