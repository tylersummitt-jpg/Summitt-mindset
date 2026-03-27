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
        Manage or Cancel Membership
      </button>
    </div>
  );
}
