"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASONS = [
  { code: "too_busy", label: "Life got too busy" },
  { code: "not_relevant", label: "The practices didn’t fit me" },
  { code: "unclear_value", label: "I didn’t feel the value yet" },
  { code: "journal_friction", label: "Journaling was hard to keep up with" },
  { code: "cost", label: "It’s a financial stretch right now" },
  { code: "other", label: "Something else" },
];

export default function CancelFlowClient() {
  const router = useRouter();

  const [reason, setReason] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const [loading, setLoading] = useState(false);
  const [savingPause, setSavingPause] = useState(false);

  // ======================================================
  // ✅ PAUSE OFFER (Canonical Save Lever)
  // ======================================================
  async function handlePauseInstead() {
    setSavingPause(true);

    try {
      const res = await fetch("/api/pause-membership", {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Pause failed.");
      }

      router.push("/dashboard?paused=true");
    } catch (err: any) {
      alert(err.message || "Something went wrong.");
    } finally {
      setSavingPause(false);
    }
  }

  // ======================================================
  // ✅ FULL CANCEL (Truth Capture)
  // ======================================================
  async function handleCancel() {
    if (!reason) return;

    setLoading(true);

    try {
      const res = await fetch("/api/cancel-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reasonCode: reason,
          message: message.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Cancel failed.");
      }

      router.push("/dashboard?canceled=true");
    } catch (err: any) {
      alert(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="border rounded-xl bg-white shadow-sm p-6 space-y-6">
      {/* ✅ Pause Offer */}
      <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
        <p className="font-semibold text-gray-900">
          Want to pause instead of canceling?
        </p>

        <p className="text-sm text-gray-600">
          If life is full right now, you can pause billing and come back anytime.
          No pressure. No loss.
        </p>

        <button
          disabled={savingPause}
          onClick={handlePauseInstead}
          className="w-full rounded-md bg-black text-white py-2 font-semibold disabled:opacity-50"
        >
          {savingPause ? "Pausing…" : "Pause Membership Instead"}
        </button>
      </div>

      {/* ✅ Exit Truth */}
      <div className="space-y-4">
        <p className="font-semibold text-gray-900">
          If you still want to cancel — what’s the main reason?
        </p>

        <div className="space-y-2">
          {REASONS.map((r) => (
            <button
              key={r.code}
              onClick={() => setReason(r.code)}
              className={[
                "w-full text-left px-4 py-3 rounded-md border text-sm",
                reason === r.code
                  ? "border-black bg-gray-50 font-semibold"
                  : "hover:bg-gray-50",
              ].join(" ")}
            >
              {r.label}
            </button>
          ))}
        </div>

        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Optional: What would have helped you stay?"
          className="w-full border rounded-md p-2 text-sm"
        />

        <button
          disabled={!reason || loading}
          onClick={handleCancel}
          className="w-full bg-white border border-black text-black rounded-md py-3 font-semibold hover:bg-black hover:text-white transition disabled:opacity-50"
        >
          {loading ? "Cancelling…" : "Cancel Membership"}
        </button>

        <p className="text-xs text-gray-500 text-center">
          Thank you for being here. One honest answer helps Summitt improve.
        </p>
      </div>
    </section>
  );
}
