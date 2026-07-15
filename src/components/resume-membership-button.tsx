"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";

type ResumeMembershipButtonProps = {
  className?: string;
  /** Visual variant for account (dark) vs subscribe (light) surfaces */
  variant?: "account" | "subscribe";
};

export default function ResumeMembershipButton({
  className,
  variant = "account",
}: ResumeMembershipButtonProps) {
  const router = useRouter();
  const { user } = useUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function handleResume() {
    if (inFlight.current || loading) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/resume-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      const body = await res.json().catch(() => ({}));
      const code = typeof body?.code === "string" ? body.code : null;

      if (res.ok && (code === "resumed" || code === "already_active")) {
        if (user) {
          await user.reload();
        }
        router.push("/post-sign-in");
        return;
      }

      if (code === "no_subscription") {
        setError(
          "We couldn’t find a membership to resume. Please contact support."
        );
      } else if (code === "ownership_mismatch") {
        setError(
          "We couldn’t verify this membership. Please contact support."
        );
      } else if (code === "subscription_not_recoverable") {
        setError(
          "This membership can’t be resumed. You can start a new membership from Subscribe."
        );
      } else if (code === "not_paused") {
        setError(
          "This membership isn’t paused. Try refreshing, or contact support if access is still blocked."
        );
      } else {
        setError(
          "We couldn’t resume your membership right now. Please try again."
        );
      }
    } catch {
      setError(
        "We couldn’t resume your membership right now. Please try again."
      );
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  const buttonClass =
    className ??
    (variant === "subscribe"
      ? "w-full rounded-md bg-[var(--brand)] text-white px-5 py-3 font-semibold hover:opacity-95 transition disabled:opacity-50"
      : "rounded-md border border-white/20 bg-white text-gray-900 px-5 py-2 text-sm font-semibold hover:bg-stone-100 transition disabled:opacity-50");

  return (
    <div className="flex flex-col gap-2 items-stretch sm:items-start w-full">
      <button
        type="button"
        onClick={handleResume}
        disabled={loading}
        className={buttonClass}
      >
        {loading ? "Resuming…" : "Resume Membership"}
      </button>
      {error ? (
        <p className="text-sm text-red-500 break-words max-w-md">{error}</p>
      ) : null}
    </div>
  );
}
