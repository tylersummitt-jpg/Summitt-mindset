import { isTylerOwnerSession } from "@/lib/auth/require-tyler-admin";

import EmailAnswersDashboard from "./email-answers-dashboard";

export const dynamic = "force-dynamic";

export default async function EmailAnswersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await isTylerOwnerSession())) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-gray-900">Email answers</h1>
        <p className="mt-3 text-sm text-gray-800">This queue is limited to the account owner.</p>
      </main>
    );
  }
  const resolved = searchParams ? await searchParams : {};
  const request = resolved.request;
  const highlight = typeof request === "string" ? request : "";
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="text-2xl font-semibold text-gray-900">Email answers</h1>
      <p className="text-sm text-gray-700">
        These are questions the email assistant could not answer from verified facts. Sending uses the original thread and does not turn conversation sending on.
      </p>
      <EmailAnswersDashboard highlightRequestId={highlight} />
    </main>
  );
}
