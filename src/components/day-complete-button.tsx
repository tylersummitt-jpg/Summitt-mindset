"use client";

import { useEffect, useState } from "react";

import Day7NpsFeedback from "@/components/day7-nps-feedback";
import Day14PMFFeedback from "@/components/day14-pmf-feedback";
import Day30TestimonialFeedback from "@/components/day30-testimonial-feedback";

/**
 * ======================================================
 * Day Completion Button (CANONICAL)
 * ======================================================
 *
 * This is the moment the Daily OS locks in.
 *
 * After completion:
 * - calm success overlay
 * - ONLY canonical feedback moments trigger
 * - feedback is guarded so Summitt never feels like surveys
 *
 * Feedback guardrails are enforced through:
 * ✅ /api/feedback/can-prompt
 * ✅ /api/feedback/state   (shown + ignored tracking)
 *
 * ======================================================
 * Visual rules (brand polish)
 * ======================================================
 * - Primary action = Summitt Orange
 * - Everything else stays calm + neutral
 * - Use design tokens: --brand, --brand-soft, --border, --muted, --text
 */

const COMPLETION_MESSAGES = [
  "You showed up today.",
  "That counts.",
  "Practice complete.",
  "Another day practiced.",
  "Consistency beats intensity.",
  "Good work. See you tomorrow.",
];

function getRandomCompletionMessage() {
  return COMPLETION_MESSAGES[
    Math.floor(Math.random() * COMPLETION_MESSAGES.length)
  ];
}

type Props = {
  dayNumber: number;
  onBeforeComplete?: () => Promise<void>;
  onAfterComplete?: () => Promise<void>;
  videoIdShown?: string | null;
};

type FrictionReason = "time" | "confusion" | "fatigue" | "other";

export default function DayCompleteButton({
  dayNumber,
  onBeforeComplete,
  onAfterComplete,
  videoIdShown = null,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  // ✅ Feedback Prompt State
  const [showSurvey, setShowSurvey] = useState(false);

  // ✅ Day 1 CES State
  const [feedbackText, setFeedbackText] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);

  // ✅ Journal friction capture
  const [showJournalFriction, setShowJournalFriction] = useState(false);
  const [frictionSubmitted, setFrictionSubmitted] = useState(false);
  const [otherFrictionText, setOtherFrictionText] = useState("");

  // ======================================================
  // ✅ COMPLETE DAY (Canonical)
  // ======================================================
  async function handleComplete() {
    if (loading || showSuccess) return;

    try {
      setError(null);
      setLoading(true);

      if (onBeforeComplete) await onBeforeComplete();

      const res = await fetch("/api/day/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          day: dayNumber,
          videoIdShown,
        }),
      });

      if (!res.ok) throw new Error("Network error completing day");

      const data = await res.json();

      // ✅ Guards
      if (data?.ok === false) {
        if (data.reason === "journal_required") {
          setError(
            `Write at least one honest sentence before clicking “Complete Today’s Practice.”`
          );

          if (!frictionSubmitted) {
            setShowJournalFriction(true);
          }

          return;
        }

        if (data.reason === "already_completed_today") {
          setSuccessMessage("You already showed up today.");
          setShowSuccess(true);

          if (onAfterComplete) await onAfterComplete();
          return;
        }

        setError("Unable to complete today. Please try again.");
        return;
      }

      // ✅ Success
      if (data?.ok === true) {
        setSuccessMessage(
          dayNumber === 1
            ? "Training Camp has begun."
            : getRandomCompletionMessage()
        );

        setShowSuccess(true);

        if (onAfterComplete) await onAfterComplete();
        return;
      }

      throw new Error("Unexpected completion response");
    } catch (err) {
      console.error("Failed to complete day", err);
      setError("Something went wrong completing your day. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // ======================================================
  // ✅ AFTER SUCCESS → CANONICAL FEEDBACK MOMENTS ONLY
  // ======================================================
  useEffect(() => {
    if (!showSuccess) return;

    const timer = setTimeout(async () => {
      setShowSuccess(false);

      if (![1, 7, 14, 30].includes(dayNumber)) return;

      const moment =
        dayNumber === 1
          ? "day1_completion"
          : dayNumber === 7
          ? "day7_completion"
          : dayNumber === 14
          ? "day14_completion"
          : "day30_completion";

      try {
        const res = await fetch(`/api/feedback/can-prompt?moment=${moment}`);
        const data = await res.json();

        if (data?.canPrompt === true) {
          await fetch("/api/feedback/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "shown" }),
          });

          setShowSurvey(true);
        }
      } catch (err) {
        console.error("Feedback prompt check failed", err);
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [showSuccess, dayNumber]);

  // ======================================================
  // ✅ USER DISMISSES PROMPT
  // ======================================================
  async function dismissSurvey() {
    try {
      await fetch("/api/feedback/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ignored" }),
      });
    } catch (err) {
      console.error("Failed to record ignored feedback", err);
    } finally {
      setShowSurvey(false);
      setFeedbackText("");
    }
  }

  // ======================================================
  // ✅ SUBMIT DAY 1 CES
  // ======================================================
  async function sendDay1Feedback(wasClear: boolean) {
    if (sendingFeedback) return;

    try {
      setSendingFeedback(true);

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "app",
          moment: "day1_completion",
          type: "ces",
          dayNumber,
          rating: wasClear ? 1 : 0,
          reasonCode: wasClear ? null : "unclear_onboarding",
          message: feedbackText.trim() || null,
          sharePermission: false,
          metadata: { canonical: true },
        }),
      });
    } catch (err) {
      console.error("Failed to submit Day 1 feedback", err);
    } finally {
      setSendingFeedback(false);
      setShowSurvey(false);
      setFeedbackText("");
    }
  }

  // ======================================================
  // ✅ SUBMIT JOURNAL FRICTION
  // ======================================================
  async function submitJournalFriction(reason: FrictionReason) {
    if (frictionSubmitted) return;

    try {
      setFrictionSubmitted(true);

      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "app",
          moment: "journal_required",
          type: "friction",
          dayNumber,
          reasonCode: reason,
          message: reason === "other" ? otherFrictionText.trim() || null : null,
          sharePermission: false,
          metadata: { canonical: true },
        }),
      });
    } catch (err) {
      console.error("Failed to submit journal friction", err);
    } finally {
      setShowJournalFriction(false);
    }
  }

  // ======================================================
  // Shared button styles (calm + consistent)
  // ======================================================
  const primaryButton =
    "w-full rounded-md py-3 font-semibold text-white bg-[var(--brand)] hover:opacity-90 disabled:opacity-50";

  const neutralButton =
    "w-full rounded-md py-2 font-semibold border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--brand-soft)] disabled:opacity-50";

  // ======================================================
  // ✅ RENDER
  // ======================================================
  return (
    <>
      {/* ======================================================
          SUCCESS OVERLAY (calm)
         ====================================================== */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl px-8 py-6 shadow-lg text-center max-w-sm w-full">
            <div className="mb-3 text-2xl text-[var(--brand)]">✓</div>

            <p className="text-lg font-medium text-[var(--text)]">
              {successMessage}
            </p>

            <p className="text-sm text-[var(--muted)] mt-2">
              No catching up. No backlog. Just today.
            </p>
          </div>
        </div>
      )}

      {/* ======================================================
          JOURNAL FRICTION
         ====================================================== */}
      {showJournalFriction && (
        <div className="border border-[var(--border)] rounded-2xl bg-[var(--surface)] shadow-sm p-5 space-y-3 mt-4">
          <p className="font-medium text-[var(--text)]">
            What made writing hard right now?
          </p>

          <div className="grid gap-2">
            <button
              onClick={() => submitJournalFriction("time")}
              className={neutralButton}
            >
              ⏱️ Short on time
            </button>

            <button
              onClick={() => submitJournalFriction("confusion")}
              className={neutralButton}
            >
              🧠 Didn’t know what to write
            </button>

            <button
              onClick={() => submitJournalFriction("fatigue")}
              className={neutralButton}
            >
              😵 Mentally tired
            </button>

            <div className="space-y-2">
              <textarea
                rows={2}
                value={otherFrictionText}
                onChange={(e) => setOtherFrictionText(e.target.value)}
                placeholder="Other (optional)"
                className="w-full border border-[var(--border)] rounded-xl p-3 text-sm bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent"
              />

              <button
                onClick={() => submitJournalFriction("other")}
                className={neutralButton}
              >
                Submit
              </button>
            </div>
          </div>

          <button
            onClick={() => setShowJournalFriction(false)}
            className="text-xs text-[var(--muted)]"
          >
            Skip
          </button>
        </div>
      )}

      {/* ======================================================
          CANON FEEDBACK TOUCHPOINTS
         ====================================================== */}
      {showSurvey && (
        <div className="border border-[var(--border)] rounded-2xl bg-[var(--surface)] shadow-sm p-6 space-y-4 mt-6">
          {dayNumber === 1 && (
            <>
              <p className="font-semibold text-[var(--text)]">
                Quick question — was today clear?
              </p>

              <textarea
                rows={2}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Optional: anything unclear?"
                className="w-full border border-[var(--border)] rounded-xl p-3 text-sm bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:border-transparent"
              />

              <div className="flex gap-3">
                <button
                  disabled={sendingFeedback}
                  onClick={() => sendDay1Feedback(true)}
                  className={primaryButton}
                >
                  {sendingFeedback ? "Saving…" : "Yes ✅"}
                </button>

                <button
                  disabled={sendingFeedback}
                  onClick={() => sendDay1Feedback(false)}
                  className={neutralButton}
                >
                  {sendingFeedback ? "Saving…" : "Not really"}
                </button>
              </div>

              <button
                onClick={dismissSurvey}
                className="w-full text-xs text-[var(--muted)] mt-2"
              >
                Not right now
              </button>
            </>
          )}

          {dayNumber === 7 && <Day7NpsFeedback dayNumber={7} />}
          {dayNumber === 14 && <Day14PMFFeedback dayNumber={14} />}
          {dayNumber === 30 && <Day30TestimonialFeedback dayNumber={30} />}
        </div>
      )}

      {/* ======================================================
          MAIN COMPLETE BUTTON
         ====================================================== */}
      {!showSurvey && (
        <button
          onClick={handleComplete}
          disabled={loading || showSuccess}
          className={primaryButton}
        >
          {loading ? "Completing…" : "Complete Today’s Practice"}
        </button>
      )}

      {/* ======================================================
          ERROR
         ====================================================== */}
      {error && (
        <p className="mt-3 text-sm text-[var(--muted)] text-center">{error}</p>
      )}
    </>
  );
}
