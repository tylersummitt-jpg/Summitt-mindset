"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import GoalBuilderClient, {
  type GoalBuilderAppEditDraft,
} from "@/components/GoalBuilderClient";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import type { GoalPersonalizationInput } from "@/lib/onboarding-goal-personalization";
import { normalizeIntakeWhitespace } from "@/lib/v2-commitment-intake-validation";

type Step = "builder" | "confirm" | "success";

type Props = {
  identityAnchor: string;
  personalizationContext: GoalPersonalizationInput;
  currentBehaviorStatement: string;
  effectiveCoachingAsk: string | null;
};

function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

export default function UpdateGoalClient(props: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("builder");
  const [newBar, setNewBar] = useState("");
  const [builderDraft, setBuilderDraft] = useState<GoalBuilderAppEditDraft | null>(null);
  const [clientRequestId] = useState(() => newClientRequestId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pageShellClass = "mx-auto max-w-2xl min-w-0 px-6 py-8 pb-10 md:py-10";
  const cardClass =
    "rounded-2xl border border-[var(--border)] bg-white p-6 shadow-md shadow-gray-900/[0.05] ring-1 ring-black/[0.04] sm:p-8";

  const handleBuilderDraftChange = useCallback((draft: GoalBuilderAppEditDraft) => {
    setBuilderDraft(draft);
  }, []);

  function onGoalReady(payload: { title: string; behaviorStatement: string }) {
    setError(null);
    setNewBar(payload.behaviorStatement);
    setStep("confirm");
  }

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v2/commitment/goal-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          behavior_statement: normalizeIntakeWhitespace(newBar),
          // Legacy field ignored server-side; always new_chapter for saved goal change.
          season_mode: "new_chapter",
          client_request_id: clientRequestId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setStep("success");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (step === "success") {
    return (
      <div className={pageShellClass}>
        <div className={cardClass}>
          <h1 className="text-xl font-semibold text-gray-900">You&apos;re set</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            Pat will coach this bar going forward. Your past proof stays in Victory Room.
          </p>
          <div className="mt-8">
            <Link href={MEMBER_APP_HOME_PATH} className="member-attention-cta text-center">
              Back to Victory Room
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={pageShellClass}>
      <div className={cardClass}>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Update my goal
        </p>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">My Current Goal</h1>

        {step === "builder" ? (
          <>
            <section className="mb-8 mt-6 rounded-lg border bg-gray-50 p-4">
              <h2 className="mb-2 text-lg font-bold text-gray-900">My Identity</h2>
              <p className="text-sm text-gray-700">{props.identityAnchor}</p>
            </section>

            <GoalBuilderClient
              mode="app_edit"
              identityAnchor={props.identityAnchor}
              personalizationContext={props.personalizationContext}
              generateEndpoint="/api/v2/commitment/generate-goal-options"
              initialLiveBehaviorStatement={props.currentBehaviorStatement}
              effectiveCoachingAsk={props.effectiveCoachingAsk}
              appEditDraft={builderDraft}
              onAppEditDraftChange={handleBuilderDraftChange}
              backHref={MEMBER_APP_HOME_PATH}
              copy={{
                backLabel: "Cancel",
                continueLabel: "Continue",
              }}
              onGoalReady={onGoalReady}
            />
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <div className="mt-6 space-y-4 rounded-lg border border-gray-100 bg-gray-50/80 p-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Current bar
                </p>
                <p className="mt-1 text-gray-900">{props.currentBehaviorStatement}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  New bar
                </p>
                <p className="mt-1 font-medium text-gray-900">{newBar.trim()}</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-gray-600">
              Your past proof stays in Victory Room. Pat&apos;s next texts will use this updated bar.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                className="member-attention-cta disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={onConfirm}
              >
                Confirm change
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                disabled={busy}
                onClick={() => setStep("builder")}
              >
                Back
              </button>
            </div>
          </>
        ) : null}

        {error ? (
          <p
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
