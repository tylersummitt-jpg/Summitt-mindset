import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

import CustomersDashboard from "./customers-dashboard";

/**
 * Tyler-only subscribed member CRM (read-mostly + admin notes).
 */
export default async function AdminCustomersPage() {
  await requireTylerAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Subscribed Customers</h1>
        <p className="mt-2 text-sm text-gray-600">
          Active members with <code className="rounded bg-gray-100 px-1 text-xs">summittSubscribed</code>{" "}
          in Clerk. SMS and subscription fields are read-only.
        </p>
      </div>

      <CustomersDashboard />
    </div>
  );
}
