import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

import ManualPatAnswersDashboard from "./manual-pat-answers-dashboard";

export default async function ManualPatAnswersPage({
  searchParams,
}: {
  searchParams?: Promise<{ message_sid?: string | string[] }>;
}) {
  await requireTylerAdmin();
  const resolved = searchParams ? await searchParams : {};
  const raw = resolved.message_sid;
  const highlightMessageSid = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Manual Pat Answers</h1>
        <p className="mt-2 text-sm text-gray-600">
          Questions Coach Pat needs Tyler to answer.
        </p>
      </div>
      <ManualPatAnswersDashboard highlightMessageSid={highlightMessageSid} />
    </div>
  );
}
