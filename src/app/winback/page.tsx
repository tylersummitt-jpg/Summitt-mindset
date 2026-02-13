import WinbackClient from "./winback-client";

export default async function WinbackPage({
  searchParams,
}: {
  searchParams?: { t?: string };
}) {
  const token = typeof searchParams?.t === "string" ? searchParams.t : null;

  return (
    <main className="max-w-xl mx-auto px-6 py-16 space-y-6">
      <h1 className="text-3xl font-bold">One honest question…</h1>

      <p className="text-sm text-gray-600">
        If we rebuilt one thing so you’d come back, what would it be?
        <br />
        One sentence is enough.
      </p>

      <WinbackClient token={token} />
    </main>
  );
}
