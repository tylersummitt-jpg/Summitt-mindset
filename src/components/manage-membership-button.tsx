"use client";

import { useRouter } from "next/navigation";

export default function ManageMembershipButton() {
  const router = useRouter();

  function handleCancelFlow() {
    router.push("/cancel");
  }

  return (
    <div className="flex flex-col gap-3 items-center">
      {/* ✅ Canonical Cancellation Truth Capture */}
      <button
        onClick={handleCancelFlow}
        className="rounded-md border px-5 py-2 text-sm font-semibold hover:bg-black hover:text-white transition"
      >
        Manage Membership
      </button>

      <p className="text-xs text-gray-500 text-center max-w-sm">
        Summitt Mindset doesn’t do silent churn.
        <br />
        Cancellation always includes a calm exit reflection.
      </p>
    </div>
  );
}
