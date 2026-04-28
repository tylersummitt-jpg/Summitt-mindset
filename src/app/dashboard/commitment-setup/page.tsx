import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isUserFullyOnV2AccountabilityPath } from "@/lib/v2-cutover-gates";
import CommitmentSetupClient from "./commitment-setup-client";

export const dynamic = "force-dynamic";

export default async function DashboardCommitmentSetupPage() {
  const user = await currentUser();
  if (!user?.id) {
    redirect("/sign-in");
  }

  if (await isUserFullyOnV2AccountabilityPath(user.id)) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Dashboard</p>
      <h1 className="mt-1 text-2xl font-semibold text-gray-900">Set your commitment</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        One clear standard. Pat will check in on this by text — you can refine it later as life shifts.
      </p>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <CommitmentSetupClient />
      </div>
    </main>
  );
}
