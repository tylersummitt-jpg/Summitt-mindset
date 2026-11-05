"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ExitFeedbackScreens } from "@/components/exit-feedback-screens";
import {
  APPLE_SUBSCRIPTION_MANAGEMENT_URL,
  blankToNull,
  type CancelFlowMode,
  type ExitSurveyReasonCode,
} from "@/lib/exit-survey";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";

type Step = "reason" | "comment" | "final";

export default function CancelFlowClient({ mode }: { mode: CancelFlowMode }) {
  const router = useRouter();
  const inFlightRef = useRef(false);
  const [step, setStep] = useState<Step>("reason");
  const [reasonCode, setReasonCode] = useState<ExitSurveyReasonCode | null>(null);
  const [comment, setComment] = useState("");
  const [skippedReason, setSkippedReason] = useState(false);
  const [skippedComment, setSkippedComment] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingPause, setSavingPause] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelsStripe = mode === "stripe" || mode === "both";

  function goToComment(nextSkippedReason: boolean) {
    setSkippedReason(nextSkippedReason);
    if (nextSkippedReason) setReasonCode(null);
    setError(null);
    setStep("comment");
  }

  function goToFinal(nextSkippedComment: boolean) {
    setSkippedComment(nextSkippedComment);
    if (nextSkippedComment) setComment("");
    setError(null);
    setStep("final");
  }

  async function handlePauseInstead() {
    if (inFlightRef.current || savingPause) return;
    inFlightRef.current = true;
    setSavingPause(true);
    setError(null);
    try {
      const res = await fetch("/api/pause-membership", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Pause failed."
        );
      }
      router.push(MEMBER_APP_HOME_PATH);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      inFlightRef.current = false;
      setSavingPause(false);
    }
  }

  async function handleCancel() {
    if (!cancelsStripe || inFlightRef.current || loading) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cancel-membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reasonCode: skippedReason ? null : reasonCode,
          message: skippedComment ? null : blankToNull(comment),
          skippedReason,
          skippedComment: skippedComment || blankToNull(comment) == null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Cancel failed."
        );
      }
      router.push(MEMBER_APP_HOME_PATH);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <section className="border rounded-xl bg-white shadow-sm p-6 space-y-6">
      {cancelsStripe ? (
        <div className="rounded-lg border bg-gray-50 p-4 space-y-3">
          <p className="font-semibold text-gray-900">Want to pause instead of canceling?</p>
          <p className="text-sm text-gray-600">
            If life is full right now, you can pause billing and come back anytime.
            No pressure. No loss.
          </p>
          <button
            type="button"
            disabled={savingPause || loading}
            onClick={() => {
              void handlePauseInstead();
            }}
            className="w-full rounded-md bg-black text-white py-2 font-semibold disabled:opacity-50"
          >
            {savingPause ? "Pausing…" : "Pause Membership Instead"}
          </button>
        </div>
      ) : null}

      {step === "final" ? (
        <div className="space-y-4">
          <h2 className="font-semibold text-gray-900">
            {cancelsStripe ? "Cancel membership" : "Manage your App Store subscription"}
          </h2>
          {cancelsStripe ? (
            <p className="text-sm text-gray-600">
              This cancels the membership billed by Summitt Mindset immediately.
              {mode === "both"
                ? " You also have an App Store membership. Canceling here does not cancel that subscription."
                : " If you also subscribed through the App Store, cancel that subscription in Apple. This page does not cancel it."}
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              This opens Apple’s subscription page. Opening it does not cancel your
              subscription. Apple is where that membership is managed.
            </p>
          )}
          {mode === "both" ? (
            <p className="text-sm text-gray-600">
              <a
                href={APPLE_SUBSCRIPTION_MANAGEMENT_URL}
                className="underline font-semibold text-gray-900"
              >
                Manage Subscription in Apple
              </a>
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              className="w-full sm:w-auto rounded-md border border-black bg-white text-black px-5 py-3 text-sm font-semibold"
              onClick={() => setStep("comment")}
              disabled={loading}
            >
              Back
            </button>
            {cancelsStripe ? (
              <button
                type="button"
                className="w-full sm:w-auto rounded-md bg-black text-white px-5 py-3 text-sm font-semibold disabled:opacity-50"
                onClick={() => {
                  void handleCancel();
                }}
                disabled={loading}
              >
                {loading ? "Cancelling…" : "Cancel Membership"}
              </button>
            ) : (
              <a
                href={APPLE_SUBSCRIPTION_MANAGEMENT_URL}
                className="inline-flex w-full sm:w-auto justify-center rounded-md bg-black text-white px-5 py-3 text-sm font-semibold"
              >
                Manage Subscription in Apple
              </a>
            )}
          </div>
        </div>
      ) : (
        <ExitFeedbackScreens
          step={step}
          reasonCode={reasonCode}
          comment={comment}
          onChangeReason={(code) => {
            setReasonCode(code);
            setSkippedReason(false);
          }}
          onChangeComment={setComment}
          onSkipReason={() => goToComment(true)}
          onContinueReason={() => goToComment(false)}
          onBackToReason={() => setStep("reason")}
          onSkipComment={() => goToFinal(true)}
          onContinueComment={() => goToFinal(false)}
        />
      )}
    </section>
  );
}
