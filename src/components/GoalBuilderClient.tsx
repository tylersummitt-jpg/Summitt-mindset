"use client";

import type { ReactElement } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  buildRecommendedGoalsForArea,
  getVisibleFocusAreas,
  type GoalAreaId,
  type GoalFocusAreaId,
} from "@/lib/onboarding-goal-templates";
import type { GoalPersonalizationInput } from "@/lib/onboarding-goal-personalization";
import {
  validateGoalBehaviorTiered,
  validateGoalTitleTiered,
} from "@/lib/onboarding-intake-validation";
import { sanitizeGoalOptions } from "@/lib/onboarding-goal-quality";
import {
  normalizeIntakeWhitespace,
  validateBehaviorStatementIntake,
  validateCommitmentTitleIntake,
} from "@/lib/v2-commitment-intake-validation";
import { UseMineAnywayPanel } from "@/components/onboarding-sob/use-mine-anyway";

const WRITE_OWN_TITLE_PLACEHOLDER = "Be present after work";
const WRITE_OWN_BEHAVIOR_PLACEHOLDER =
  "I will put my phone away for the first 30 minutes after I get home.";
const MAKE_IT_YOUR_OWN_HELPER =
  "Coach Pat will text you about this goal. You can use the recommendation as-is or tweak it so it sounds exactly right.";

const GENERATE_FAILURE_MESSAGE =
  "Could not generate more options right now. Pick a recommendation or make it your own.";

function strFromSaved(v: string | null | undefined): string {
  return typeof v === "string" ? v : "";
}

export type GoalBuilderCopy = {
  focusAreaPrompt?: string;
  recommendedGoalsTitle?: string;
  recommendedGoalsHelper?: string;
  makeItYourOwnTitle?: string;
  makeItYourOwnHelper?: string;
  continueLabel?: string;
  backLabel?: string;
};

/** Transient app-edit builder state (parent-owned; not persisted to DB). */
export type GoalBuilderAppEditDraft = {
  selectedAreaId: GoalAreaId | "";
  title: string;
  behaviorStatement: string;
  showAllFocusAreas: boolean;
  generatedGoals: { title: string; behaviorStatement: string }[];
  weakAccept: boolean;
  warnMessage: string | null;
};

export type GoalBuilderClientProps = {
  mode: "onboarding" | "app_edit";
  identityAnchor?: string | null;
  personalizationContext?: GoalPersonalizationInput;
  generateEndpoint?: string;
  initialTitle?: string | null;
  initialBehaviorStatement?: string | null;
  /** Restores focus area selection (onboarding resume/testing only). */
  initialSelectedAreaId?: GoalAreaId | "" | null;
  initialWarnMessage?: string | null;
  initialWeakAccept?: boolean;
  /** App edit: live active bar — display only, not preloaded into editor. */
  initialLiveBehaviorStatement?: string | null;
  effectiveCoachingAsk?: string | null;
  backHref: string;
  copy?: GoalBuilderCopy;
  /** App edit: restore transient builder state when remounting (e.g. chapter Back). */
  appEditDraft?: GoalBuilderAppEditDraft | null;
  /** App edit: sync transient builder state to parent on change. */
  onAppEditDraftChange?: (draft: GoalBuilderAppEditDraft) => void;
  /** App edit: called when builder validation passes with a new goal candidate. */
  onGoalReady?: (payload: { title: string; behaviorStatement: string }) => void;
};

export default function GoalBuilderClient({
  mode,
  identityAnchor,
  personalizationContext = {},
  generateEndpoint,
  initialTitle,
  initialBehaviorStatement,
  initialSelectedAreaId = "",
  initialWarnMessage = null,
  initialWeakAccept = false,
  initialLiveBehaviorStatement,
  effectiveCoachingAsk,
  backHref,
  copy = {},
  appEditDraft = null,
  onAppEditDraftChange,
  onGoalReady,
}: GoalBuilderClientProps): ReactElement {
  const router = useRouter();
  const isAppEdit = mode === "app_edit";
  const anchor = strFromSaved(identityAnchor);
  const anchorLower = anchor.toLowerCase();
  const liveBar = strFromSaved(initialLiveBehaviorStatement);

  const resolvedGenerateEndpoint =
    generateEndpoint ??
    (isAppEdit
      ? "/api/v2/commitment/generate-goal-options"
      : "/api/onboarding/generate-goal-options");

  const focusAreaPrompt =
    copy.focusAreaPrompt ??
    (isAppEdit
      ? "What area should Coach Pat help you practice now?"
      : "Choose one focus area");

  const continueLabel =
    copy.continueLabel ?? (isAppEdit ? "Continue" : "Continue to Review →");
  const backLabel = copy.backLabel ?? "Back";

  const [showAllFocusAreas, setShowAllFocusAreas] = useState(() =>
    isAppEdit && appEditDraft ? appEditDraft.showAllFocusAreas : false
  );
  const [selectedAreaId, setSelectedAreaId] = useState<GoalAreaId | "">(() =>
    isAppEdit && appEditDraft
      ? appEditDraft.selectedAreaId
      : isAppEdit
        ? ""
        : typeof initialSelectedAreaId === "string"
          ? initialSelectedAreaId
          : ""
  );
  const [title, setTitle] = useState(() =>
    isAppEdit && appEditDraft ? appEditDraft.title : isAppEdit ? "" : strFromSaved(initialTitle)
  );
  const [behaviorStatement, setBehaviorStatement] = useState(() =>
    isAppEdit && appEditDraft
      ? appEditDraft.behaviorStatement
      : isAppEdit
        ? ""
        : strFromSaved(initialBehaviorStatement)
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [intakeOrigin, setIntakeOrigin] = useState<
    "user_written" | "generated" | "template" | "recommended"
  >("user_written");
  const [generatedGoals, setGeneratedGoals] = useState<
    { title: string; behaviorStatement: string }[]
  >(() => (isAppEdit && appEditDraft ? appEditDraft.generatedGoals : []));
  const [generating, setGenerating] = useState(false);
  const [weakAccept, setWeakAccept] = useState(() =>
    isAppEdit && appEditDraft ? appEditDraft.weakAccept : initialWeakAccept
  );
  const [warnMessage, setWarnMessage] = useState<string | null>(() =>
    isAppEdit && appEditDraft ? appEditDraft.warnMessage : (initialWarnMessage ?? null)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const focusAreas = useMemo(
    () => getVisibleFocusAreas(anchorLower, showAllFocusAreas),
    [anchorLower, showAllFocusAreas]
  );

  const recommendations = useMemo(
    () =>
      selectedAreaId && selectedAreaId.length > 0
        ? buildRecommendedGoalsForArea(selectedAreaId, {
            ...personalizationContext,
            identityAnchor: anchor,
          })
        : [],
    [selectedAreaId, anchor, personalizationContext]
  );

  const displayGoals = generatedGoals.length > 0 ? generatedGoals : recommendations;

  function buildAppEditDraftSnapshot(): GoalBuilderAppEditDraft {
    return {
      selectedAreaId,
      title,
      behaviorStatement,
      showAllFocusAreas,
      generatedGoals,
      weakAccept,
      warnMessage,
    };
  }

  function runValidation(): { blocked: boolean } {
    setError(null);
    setWarnMessage(null);

    if (!selectedAreaId) {
      setError(isAppEdit ? "Choose a focus area." : "Choose a focus area.");
      return { blocked: true };
    }

    const titleTier = validateGoalTitleTiered(title, { intakeWeakAccept: weakAccept });
    if (titleTier.tier === "block") {
      setError(titleTier.error ?? "Fix the goal name.");
      return { blocked: true };
    }
    if (titleTier.tier === "warn" && !weakAccept) {
      setWarnMessage(titleTier.error ?? "This goal may be hard for Coach Pat to check daily.");
      return { blocked: true };
    }

    const behaviorTier = validateGoalBehaviorTiered(behaviorStatement, {
      intakeWeakAccept: weakAccept,
    });
    if (behaviorTier.tier === "block") {
      setError(behaviorTier.error ?? "Fix the daily behavior.");
      return { blocked: true };
    }
    if (behaviorTier.tier === "warn" && !weakAccept) {
      setWarnMessage(
        behaviorTier.error ??
          validateBehaviorStatementIntake(behaviorStatement) ??
          "Make this more specific."
      );
      return { blocked: true };
    }

    const titleErr = validateCommitmentTitleIntake(title);
    if (titleErr) {
      setError(titleErr);
      return { blocked: true };
    }

    const behaviorErr = validateBehaviorStatementIntake(behaviorStatement);
    if (behaviorErr && !weakAccept) {
      setWarnMessage(behaviorErr);
      return { blocked: true };
    }

    return { blocked: false };
  }

  async function handleGenerateMore() {
    if (!selectedAreaId) {
      setError("Choose a focus area first.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(resolvedGenerateEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selected_area_id: selectedAreaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(GENERATE_FAILURE_MESSAGE);
        return;
      }
      const options = sanitizeGoalOptions(
        Array.isArray(data.options) ? data.options : [],
        anchor,
        5
      );
      if (options.length === 0) {
        setError(GENERATE_FAILURE_MESSAGE);
        return;
      }
      setGeneratedGoals(options);
      setIntakeOrigin("generated");
    } catch {
      setError(GENERATE_FAILURE_MESSAGE);
    } finally {
      setGenerating(false);
    }
  }

  function applyGoal(
    g: { title: string; behaviorStatement: string; templateId?: string | null },
    origin: "recommended" | "template" | "generated"
  ) {
    setTitle(g.title);
    setBehaviorStatement(g.behaviorStatement);
    setSelectedTemplateId(g.templateId ?? null);
    setIntakeOrigin(origin);
    setGeneratedGoals([]);
    setWarnMessage(null);
    setWeakAccept(false);
  }

  function startFromCurrentGoal() {
    if (!liveBar) return;
    setTitle("Keep current goal");
    setBehaviorStatement(liveBar);
    setIntakeOrigin("user_written");
    setSelectedTemplateId(null);
    setGeneratedGoals([]);
    setWarnMessage(null);
    setWeakAccept(false);
  }

  function selectFocusArea(id: GoalFocusAreaId) {
    setSelectedAreaId(id);
    setGeneratedGoals([]);
    setError(null);
  }

  async function handleContinue() {
    if (saving) return;

    const { blocked } = runValidation();
    if (blocked) return;

    const normalizedTitle = normalizeIntakeWhitespace(title);
    const normalizedBehavior = normalizeIntakeWhitespace(behaviorStatement);

    if (isAppEdit) {
      if (liveBar && normalizedBehavior === normalizeIntakeWhitespace(liveBar)) {
        setError("Choose a new daily bar — this matches what Pat already holds you to.");
        return;
      }
      onAppEditDraftChange?.(buildAppEditDraftSnapshot());
      onGoalReady?.({ title: normalizedTitle, behaviorStatement: normalizedBehavior });
      return;
    }

    const payload = {
      commitment_title: normalizedTitle,
      behavior_statement: normalizedBehavior,
      selected_area_id: selectedAreaId,
      selected_template_id: selectedTemplateId,
      intake_origin: intakeOrigin,
      intake_weak_accept: weakAccept,
    };

    setSaving(true);
    try {
      const res = await fetch("/api/onboarding/commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Something went wrong.");
        setSaving(false);
        return;
      }

      router.push("/onboarding/review");
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setSaving(false);
    }
  }

  const canContinue =
    Boolean(selectedAreaId) &&
    title.trim().length > 0 &&
    behaviorStatement.trim().length > 0 &&
    !(Boolean(warnMessage) && !weakAccept);

  return (
    <div className="space-y-8">
      {isAppEdit && liveBar ? (
        <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Current live goal
          </p>
          <p className="mt-2 font-medium leading-relaxed text-gray-900">{liveBar}</p>
          {effectiveCoachingAsk ? (
            <p className="mt-3 text-[var(--muted)]">
              <span className="font-medium text-gray-900">Today&apos;s check-in bar: </span>
              {effectiveCoachingAsk}
            </p>
          ) : null}
          <p className="mt-3 text-xs leading-relaxed text-gray-600">
            Your past proof stays in Victory Room. Pick a new practice below, or start from your
            current bar.
          </p>
          <button
            type="button"
            onClick={startFromCurrentGoal}
            className="mt-3 text-sm font-medium text-gray-900 underline underline-offset-2"
          >
            Start from current goal
          </button>
        </div>
      ) : null}

      <div>
        <p className="mb-3 text-sm font-semibold text-gray-900">{focusAreaPrompt}</p>
        <div className="flex flex-wrap gap-2">
          {focusAreas.map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => selectFocusArea(area.id)}
              className={[
                "rounded-lg border px-3 py-2 text-sm",
                selectedAreaId === area.id
                  ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                  : "border-gray-300 bg-white",
              ].join(" ")}
            >
              {area.label}
            </button>
          ))}
          {!showAllFocusAreas ? (
            <button
              type="button"
              onClick={() => setShowAllFocusAreas(true)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
            >
              Show more
            </button>
          ) : null}
        </div>
      </div>

      {displayGoals.length > 0 ? (
        <div>
          <p className="mb-1 text-sm font-semibold text-gray-900">
            {copy.recommendedGoalsTitle ?? "Recommended goals"}
          </p>
          <p className="mb-3 text-xs text-gray-600">
            {copy.recommendedGoalsHelper ?? "Choose one Coach Pat can hold you to."}
          </p>
          <ul className="space-y-2">
            {(generatedGoals.length > 0 ? generatedGoals : recommendations).map((g) => {
              const isGenerated = generatedGoals.length > 0;
              const rec = !isGenerated ? (g as (typeof recommendations)[number]) : null;
              return (
                <li key={`${g.title}-${g.behaviorStatement}`}>
                  <button
                    type="button"
                    onClick={() =>
                      applyGoal(
                        {
                          title: g.title,
                          behaviorStatement: g.behaviorStatement,
                          templateId: rec?.templateId ?? null,
                        },
                        isGenerated ? "generated" : rec?.templateId ? "template" : "recommended"
                      )
                    }
                    className={[
                      "w-full rounded-lg border p-4 text-left hover:bg-gray-50",
                      title === g.title && behaviorStatement === g.behaviorStatement
                        ? "border-2 border-[var(--brand)]"
                        : "",
                    ].join(" ")}
                  >
                    <p className="font-medium text-gray-900">{g.title}</p>
                    <p className="mt-1 text-sm text-gray-600">{g.behaviorStatement}</p>
                  </button>
                </li>
              );
            })}
          </ul>
          {selectedAreaId ? (
            <button
              type="button"
              onClick={handleGenerateMore}
              disabled={generating}
              className="mt-3 text-sm font-medium underline disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate more options"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4 border-t pt-6">
        <p className="text-sm font-semibold text-gray-900">
          {copy.makeItYourOwnTitle ?? "Make it your own"}
        </p>
        <p className="text-xs text-gray-600">
          {copy.makeItYourOwnHelper ?? MAKE_IT_YOUR_OWN_HELPER}
        </p>
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setIntakeOrigin("user_written");
            setSelectedTemplateId(null);
          }}
          className="w-full rounded-lg border p-4 text-sm"
          placeholder={WRITE_OWN_TITLE_PLACEHOLDER}
          aria-label="Short name for this goal"
        />
        <textarea
          value={behaviorStatement}
          onChange={(e) => {
            setBehaviorStatement(e.target.value);
            setIntakeOrigin("user_written");
          }}
          rows={4}
          className="w-full rounded-lg border p-4 text-sm"
          placeholder={WRITE_OWN_BEHAVIOR_PLACEHOLDER}
          aria-label="Daily behavior Coach Pat should check on"
        />
      </div>

      {warnMessage ? (
        <UseMineAnywayPanel
          message={warnMessage}
          checked={weakAccept}
          onChange={setWeakAccept}
        />
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex gap-4">
        <Link href={backHref} className="text-sm text-gray-600 underline">
          {backLabel}
        </Link>
        <button
          type="button"
          onClick={handleContinue}
          disabled={saving || !canContinue}
          className="flex-1 rounded-md bg-[var(--brand)] py-3 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : continueLabel}
        </button>
      </div>
    </div>
  );
}

/** Alias for static test imports that grep component source strings. */
export { GENERATE_FAILURE_MESSAGE, MAKE_IT_YOUR_OWN_HELPER };
