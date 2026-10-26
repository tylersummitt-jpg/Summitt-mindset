import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

import EmailKnowledgeDashboard from "./email-knowledge-dashboard";

export const dynamic = "force-dynamic";

export default async function EmailKnowledgePage() {
  if (!(await isTylerOwnerSession())) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Approved email knowledge</h1>
        <p className="mt-3 text-sm text-gray-800">This library is limited to the account owner.</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Approved email knowledge</h1>
      <p className="text-sm text-gray-700">
        Only an active entry reaches the email representative, and only when it applies to that prospect&apos;s campaign, offer, or to everyone. A one-off email stays on its thread until you save it here.
      </p>
      <EmailKnowledgeDashboard />
    </main>
  );
}
