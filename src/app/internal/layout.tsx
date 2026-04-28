import { assertOperatorConsoleAccess } from "@/lib/operator-console-allowlist";

/**
 * All routes under `/internal/*` require operator allowlist env (404 if not).
 * Not linked from member navigation.
 */
export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  await assertOperatorConsoleAccess();
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Internal</p>
        <p className="text-sm text-gray-700">Operator tools — read-only</p>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-8">{children}</div>
    </div>
  );
}
