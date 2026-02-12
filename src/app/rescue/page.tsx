import RescueClient from "./rescue-client";

export default async function RescuePage({
  searchParams,
}: {
  searchParams?: { t?: string };
}) {
  const token = typeof searchParams?.t === "string" ? searchParams.t : null;

  return (
    <main className="max-w-xl mx-auto px-6 py-16 space-y-6">
      <h1 className="text-3xl font-bold">A smaller version?</h1>

      <p className="text-sm text-gray-600">
        No guilt. No catching up.
        <br />
        If you want, we’ll make tomorrow smaller and easier to complete.
      </p>

      <RescueClient token={token} />
    </main>
  );
}
