import WeeklyFeedbackDashboard from "./weekly-feedback-dashboard";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

/**
 * ✅ Tyler-Only Weekly Feedback Intelligence
 * Never public. Never exposed.
 */

export default async function AdminFeedbackPage() {
  // ✅ Lock immediately
  await requireTylerAdmin();

  return (
    <main className="max-w-3xl mx-auto px-6 py-14 space-y-6">
      <h1 className="text-3xl font-bold">Weekly Retention Intelligence</h1>

      <p className="text-sm text-gray-600">
        Every Friday, Summitt outputs the real truth: friction, churn, and the
        words members use when they stay.
      </p>

      <WeeklyFeedbackDashboard />
    </main>
  );
}
