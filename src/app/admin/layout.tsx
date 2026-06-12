import Link from "next/link";

import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

/**
 * ======================================================
 * Admin Layout (Tyler Only)
 * ======================================================
 *
 * All /admin routes are automatically locked here.
 * No public access possible.
 */

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTylerAdmin();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <h1 className="text-lg font-semibold text-gray-900">Summitt Admin</h1>

          <p className="text-xs text-gray-500">
            Retention intelligence. Testimonial truth. Calm compounding.
          </p>

          <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href="/admin/customers" className="text-gray-700 underline hover:text-gray-900">
              Subscribed customers
            </Link>
            <Link href="/admin/feedback" className="text-gray-700 underline hover:text-gray-900">
              Weekly feedback
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
