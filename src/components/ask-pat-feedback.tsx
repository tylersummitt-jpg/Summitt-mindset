"use client";

import { useState } from "react";

type Props = {
  dayNumber?: number | null;
};

export default function AskPatFeedback({ dayNumber = null }: Props) {
  const [submitted, setSubmitted] = useState(false);
  const [showFollowup, setShowFollowup] = useState(false);

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitHelpful(helpful: boolean) {
    if (loading) return;

    try {
      setLoading(true);

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "app",
          moment: "ask_pat_helpfulness",
          type: "friction",
          dayNumber,

          rating: helpful ? 1 : 0,
          reasonCode: helpful ? null : "ask_pat_unhelpful",
          message: null,

          sharePermission: false,
          metadata: { v1: true },
        }),
      });

      if (helpful) {
        setSubmitted(true);
      } else {
        setShowFollowup(true);
      }
    } catch (err) {
      console.error("Ask Pat feedback failed", err);
      setSubmitted(true); // calm failure
    } finally {
      setLoading(false);
    }
  }

  async function submitMissing() {
    if (loading) return;

    try {
      setLoading(true);

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "app",
          moment: "ask_pat_missing",
          type: "friction",
          dayNumber,

          rating: 0,
          reasonCode: "ask_pat_missing",
          message: text.trim() || null,

          sharePermission: false,
          metadata: { v1: true },
        }),
      });
    } catch (err) {
      console.error("Ask Pat followup feedback failed", err);
    } finally {
      setLoading(false);
      setSubmitted(true);
      setShowFollowup(false);
      setText("");
    }
  }

  // ✅ Already complete
  if (submitted) {
    return (
      <p className="text-xs text-gray-500 mt-3 text-center">
        Thank you. Coach Pat will keep getting clearer.
      </p>
    );
  }

  // ✅ Followup Prompt
  if (showFollowup) {
    return (
      <div className="mt-4 border rounded-xl bg-white shadow-sm p-5 space-y-3">
        <p className="font-semibold text-gray-900 text-sm">
          Thank you. What was missing?
        </p>

        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One sentence is enough."
          className="w-full border rounded-md p-2 text-sm"
        />

        <button
          disabled={loading}
          onClick={submitMissing}
          className="w-full bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
        >
          {loading ? "Saving…" : "Send"}
        </button>
      </div>
    );
  }

  // ✅ Main Prompt
  return (
    <div className="mt-4 border rounded-xl bg-white shadow-sm p-5 space-y-4">
      <p className="font-semibold text-gray-900 text-sm">
        Quick question — did this answer help?
      </p>

      <div className="flex gap-3">
        <button
          disabled={loading}
          onClick={() => submitHelpful(true)}
          className="flex-1 bg-black text-white rounded-md py-2 font-semibold disabled:opacity-50"
        >
          Yes ✅
        </button>

        <button
          disabled={loading}
          onClick={() => submitHelpful(false)}
          className="flex-1 border rounded-md py-2 font-semibold disabled:opacity-50"
        >
          Not really
        </button>
      </div>
    </div>
  );
}
