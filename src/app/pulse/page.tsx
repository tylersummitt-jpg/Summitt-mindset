/**
 * Legacy pulse surface (token link from day 4–5 SMS for non–fully-on-V2 cohorts).
 * Not the V2 SMS accountability center; keep scope narrow when changing copy or behavior.
 */
import PulseClient from "./pulse-client";

export default async function PulsePage({
  searchParams,
}: {
  searchParams?: { t?: string };
}) {
  const token = typeof searchParams?.t === "string" ? searchParams.t : null;

  return (
    <main className="max-w-xl mx-auto px-6 py-16 space-y-6">
      <h1 className="text-3xl font-bold">Quick check-in</h1>

      <p className="text-sm text-gray-600">
        One word is enough.
        <br />
        How is this fitting into your day?
      </p>

      <PulseClient token={token} />
    </main>
  );
}
