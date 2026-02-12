import TestimonialsDashboard from "./testimonials-dashboard";
import { requireTylerAdmin } from "@/lib/auth/require-tyler-admin";

/**
 * ======================================================
 * Testimonial Approval Dashboard (Stream B)
 * ======================================================
 *
 * Testimonials never mix with criticism.
 * Tyler approves only what is earned + true.
 */

export default async function AdminTestimonialsPage() {
  // 🔒 Tyler-only (also protected by /admin/layout.tsx)
  await requireTylerAdmin();

  return (
    <main className="max-w-3xl mx-auto px-6 py-14 space-y-6">
      <h1 className="text-3xl font-bold">Testimonial Approvals</h1>

      <p className="text-sm text-gray-600 max-w-xl">
        These are the earned words members give after transformation. Approve
        only what feels honest and calm.
      </p>

      <TestimonialsDashboard />
    </main>
  );
}
