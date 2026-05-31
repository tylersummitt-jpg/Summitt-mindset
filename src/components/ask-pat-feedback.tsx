"use client";

import { useState } from "react";
import {
  utBodyMuted,
  utCard,
  utFormField,
  utPrimaryBtn,
  utSecondaryBtn,
} from "@/components/utility-page-visual";

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
      setSubmitted(true);
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

  if (submitted) {
    return (
      <p className={`text-xs mt-3 text-center ${utBodyMuted}`}>
        Thank you. Coach Pat will keep getting clearer.
      </p>
    );
  }

  if (showFollowup) {
    return (
      <div className={`mt-4 ${utCard} p-5 space-y-3`}>
        <p className="font-semibold text-stone-100 text-sm">Thank you. What was missing?</p>

        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="One sentence is enough."
          className={`${utFormField} min-h-0 py-2 text-sm`}
        />

        <button
          type="button"
          disabled={loading}
          onClick={submitMissing}
          className={`${utPrimaryBtn} w-full`}
        >
          {loading ? "Saving…" : "Send"}
        </button>
      </div>
    );
  }

  return (
    <div className={`mt-4 ${utCard} p-5 space-y-4`}>
      <p className="font-semibold text-stone-100 text-sm">
        Quick question — did this answer help?
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={loading}
          onClick={() => submitHelpful(true)}
          className={`${utPrimaryBtn} flex-1`}
        >
          Yes ✅
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={() => submitHelpful(false)}
          className={`${utSecondaryBtn} flex-1`}
        >
          Not really
        </button>
      </div>
    </div>
  );
}
