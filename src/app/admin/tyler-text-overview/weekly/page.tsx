import Link from "next/link";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

export default async function AdminTylerTextOverviewWeeklyPage() {
  await requireTylerAdmin();

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-3xl font-bold text-gray-900">Weekly Text Overview</h1>
      <p className="text-sm text-gray-700">
        Weekly delivery is retired. Sunday coaching is the member&apos;s ordinary scheduled daily
        text. This page does not generate, edit, or send. Historical weekly drafts, generations,
        Notebook records, Hallway records, and sent messages stay in their original records.
      </p>
      <p className="text-sm">
        <Link href="/admin/tyler-text-overview/morning" className="font-medium text-gray-900 underline">
          Morning TTO
        </Link>
        <Link
          href="/admin/tyler-text-overview/evening"
          className="ml-3 font-medium text-gray-900 underline"
        >
          Evening TTO
        </Link>
      </p>
    </div>
  );
}
