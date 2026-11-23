"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  checkLearningSortCard,
  continueLearningStep,
  gradeLearningStep,
  saveLearningReflection,
} from "@/app/programs/actions";
import {
  utBodyMuted,
  utFormField,
  utPrimaryBtn,
  utSecondaryBtn,
} from "@/components/utility-page-visual";
import { ProgramsKnowledgeCheck } from "@/components/programs/programs-knowledge-check";
import { ProgramsLessonHeader } from "@/components/programs/programs-lesson-header";
import { ProgramsProse } from "@/components/programs/programs-prose";
import {
  ProgramsAudio,
  ProgramsCallout,
  ProgramsFlashcards,
  ProgramsGallery,
  ProgramsHeading,
  ProgramsList,
  ProgramsProcess,
  ProgramsTable,
} from "@/components/programs/programs-structured";
import { ProgramsQuoteImage } from "@/components/programs/programs-quote-image";
import { ProgramsReveal } from "@/components/programs/programs-reveal";
import { ProgramsTeaching } from "@/components/programs/programs-teaching";
import { ProgramsVideo } from "@/components/programs/programs-video";
import {
  programsAccentRule,
  programsBody,
  programsGroupLabel,
  programsInstructionHeading,
  programsMissPanel,
  programsSectionCard,
  programsSortActivityTitle,
  programsSortCardHeading,
  programsSortCardIndex,
  programsSuccessPanel,
} from "@/components/programs/programs-visual";
import type { PublicLearningBlock, PublicLearningStep } from "@/lib/learning/curriculum-types";
import { lessonGroupForSequence } from "@/lib/learning/lesson-groups";
import {
  PROGRAMS_COPY,
  quizPrimaryLabel,
  sortCardLabel,
  sortCompleteMessage,
} from "@/lib/learning/programs-copy";
import { nativeSortDirections, proseBesideReveal } from "@/lib/learning/programs-presentation";
import { presentScenarioChoiceResponse } from "@/lib/learning/scenario-feedback";

const QUIZ_ADVANCE_MS = 800;

function nearbySectionTitles(blocks: PublicLearningBlock[], index: number): string[] {
  const titles: string[] = [];
  for (const neighbor of [blocks[index - 1], blocks[index + 1]]) {
    if (neighbor?.type === "sections") {
      titles.push(...neighbor.sections.map((section) => section.title));
    }
  }
  return titles;
}

type QuizResult = {
  correctCount: number;
  questionCount: number;
  minimumCorrect: number;
  questions?: Array<{
    questionId: string;
    correct: boolean;
    selectedChoiceIds?: string[];
    correctChoiceIds?: string[];
  }>;
};

export function StepExperience({
  miniProgramId,
  collectionTitle,
  step,
  stepCount,
  previousHref,
  initialAnswers,
  enforceRequirements,
  isLastStep,
}: {
  miniProgramId: string;
  collectionTitle: string;
  step: PublicLearningStep;
  stepCount: number;
  previousHref: string | null;
  initialAnswers: Record<string, string>;
  enforceRequirements: boolean;
  isLastStep: boolean;
}) {
  const router = useRouter();
  const hasQuiz = useMemo(
    () => step.blocks.some((block) => block.type === "quiz"),
    [step.blocks]
  );
  const reflectionBlocks = useMemo(
    () =>
      step.blocks.filter(
        (block): block is Extract<PublicLearningBlock, { type: "reflection" }> =>
          block.type === "reflection"
      ),
    [step.blocks]
  );
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const block of reflectionBlocks) {
      initial[block.question_id] = initialAnswers[block.question_id] ?? "";
    }
    return initial;
  });
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string[]>>({});
  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [sortFeedback, setSortFeedback] = useState<"wrong" | "right" | "complete" | null>(null);
  const [checkingCardId, setCheckingCardId] = useState<string | null>(null);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const block of step.blocks) {
      if (block.type !== "reflection") continue;
      if ((initialAnswers[block.question_id] ?? "").trim()) initial[block.question_id] = true;
    }
    return initial;
  });
  const [submittedTexts, setSubmittedTexts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const block of step.blocks) {
      if (block.type !== "reflection") continue;
      const saved = initialAnswers[block.question_id] ?? "";
      if (saved.trim()) initial[block.question_id] = saved;
    }
    return initial;
  });
  const [phase, setPhase] = useState<"idle" | "saving" | "advancing">("idle");
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  const releaseQuizHold = useCallback(() => {
    if (advanceTimer.current) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    setQuizResult(null);
    setShowCompletion(false);
    setPhase("idle");
  }, []);

  const retryQuiz = useCallback(() => {
    releaseQuizHold();
    setQuizAnswers({});
  }, [releaseQuizHold]);

  const reflectionReady = useCallback(
    (questionId: string) => {
      const current = texts[questionId] ?? "";
      const submitted = submittedTexts[questionId];
      return submitted !== undefined && current === submitted && current.trim().length > 0;
    },
    [submittedTexts, texts]
  );
  const reflectionsReady = reflectionBlocks.every((block) => reflectionReady(block.question_id));

  const submitReflection = useCallback(
    async (questionId: string) => {
      if (phase !== "idle") return;
      const answerText = texts[questionId] ?? "";
      if (!answerText.trim()) return;
      setPhase("saving");
      setSavingQuestionId(questionId);
      setFormError(null);
      const result = await saveLearningReflection({
        miniProgramId,
        stepId: step.id,
        questionId,
        answerText,
      });
      setSavingQuestionId(null);
      setPhase("idle");
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setSubmittedTexts((current) => ({ ...current, [questionId]: answerText }));
      setRevealed((current) => ({ ...current, [questionId]: true }));
    },
    [miniProgramId, phase, step.id, texts]
  );

  async function onCheckResults() {
    if (phase !== "idle" || quizResult) return;
    setPhase("saving");
    setFormError(null);
    const result = await gradeLearningStep({
      miniProgramId,
      stepId: step.id,
      reflections: texts,
      quizAnswers,
      sortPlacements: placements,
    });
    if (result.quiz) {
      setQuizResult(result.quiz);
      setFormError(null);
    } else {
      setFormError(result.ok ? null : result.message);
    }
    setPhase("idle");
  }

  async function onContinue() {
    if (phase !== "idle") return;
    if (hasQuiz && quizResult === null) return;
    if (!reflectionsReady) {
      setFormError(PROGRAMS_COPY.unsavedReflectionRequired);
      return;
    }
    setPhase("saving");
    setFormError(null);
    const result = await continueLearningStep({
      miniProgramId,
      stepId: step.id,
      reflections: texts,
      quizAnswers,
      sortPlacements: placements,
    });
    if (!result.ok) {
      if (result.quiz) {
        setQuizResult(result.quiz);
        setFormError(null);
      } else {
        setQuizResult(null);
        setFormError(result.message);
      }
      setPhase("idle");
      return;
    }
    if (isLastStep && enforceRequirements) {
      if (result.quiz) setQuizResult(result.quiz);
      setShowCompletion(true);
      setPhase("advancing");
      advanceTimer.current = window.setTimeout(() => {
        router.push(result.href);
      }, QUIZ_ADVANCE_MS);
      return;
    }
    router.push(result.href);
  }

  async function onPrevious() {
    if (!previousHref || phase !== "idle") return;
    router.push(previousHref);
  }

  async function chooseCategory(cardId: string, category: string) {
    setCheckingCardId(cardId);
    setSortFeedback(null);
    const result = await checkLearningSortCard({
      miniProgramId,
      stepId: step.id,
      cardId,
      category,
    });
    setCheckingCardId(null);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    if (!result.correct) {
      setSortFeedback("wrong");
      return;
    }
    const sort = step.blocks.find((block) => block.type === "sort");
    const next = { ...placements, [cardId]: category };
    setPlacements(next);
    if (
      sort &&
      sort.type === "sort" &&
      sort.cards.every((card) => Boolean(next[card.id]))
    ) {
      setSortFeedback("complete");
      return;
    }
    setSortFeedback("right");
  }

  function replaySort() {
    setPlacements({});
    setSortFeedback(null);
    setCheckingCardId(null);
  }

  function toggleChoice(questionId: string, choiceIdValue: string, multiple: boolean) {
    if (quizResult) return;
    setQuizAnswers((current) => {
      const existing = current[questionId] ?? [];
      if (!multiple) return { ...current, [questionId]: [choiceIdValue] };
      const next = existing.includes(choiceIdValue)
        ? existing.filter((id) => id !== choiceIdValue)
        : [...existing, choiceIdValue];
      return { ...current, [questionId]: next };
    });
  }

  const quizGraded = quizResult !== null;
  const continueLabel = quizPrimaryLabel({
    saving: phase === "saving",
    hasQuiz,
    graded: quizGraded,
    isLastStep,
    enforceRequirements,
  });

  function blockVisible(block: PublicLearningBlock): boolean {
    if (!("reveal_after" in block) || !block.reveal_after) return true;
    if (block.reveal_after === "quiz") return quizResult !== null;
    return Boolean(revealed[block.reveal_after]);
  }

  return (
    <article className="max-w-full">
      <ProgramsLessonHeader
        collectionTitle={collectionTitle}
        groupLabel={
          step.group_label ||
          (miniProgramId === "dd_mp_02" ? lessonGroupForSequence(step.sequence) : "")
        }
        title={step.title}
        sequence={step.sequence}
        stepCount={stepCount}
      />

      <div className="mt-10 space-y-10">
        {step.blocks.map((block, index) =>
          blockVisible(block) ? (
          <BlockView
            key={`${block.type}-${index}`}
            block={block}
            stepTitle={step.title}
            texts={texts}
            onText={(questionId, value) => {
              setTexts((current) => ({ ...current, [questionId]: value }));
            }}
            quizAnswers={quizAnswers}
            quizResult={quizResult}
            onToggleChoice={toggleChoice}
            placements={placements}
            sortFeedback={sortFeedback}
            sortError={formError === PROGRAMS_COPY.sortIncomplete ? formError : null}
            checkingCardId={checkingCardId}
            onChooseCategory={(cardId, category) => void chooseCategory(cardId, category)}
            onReplaySort={replaySort}
            choiceId={choiceId}
            onChoice={setChoiceId}
            reflectionReady={
              block.type === "reflection" ? reflectionReady(block.question_id) : false
            }
            reflectionSaving={
              block.type === "reflection" && savingQuestionId === block.question_id
            }
            onSubmitReflection={(questionId) => void submitReflection(questionId)}
            showBanner={showCompletion || (isLastStep && !enforceRequirements)}
            nearbySectionTitles={nearbySectionTitles(step.blocks, index)}
          />
          ) : null
        )}
      </div>

      {showCompletion || (isLastStep && !enforceRequirements) ? (
        <p className={`mt-10 ${programsSuccessPanel}`} role="status">
          {PROGRAMS_COPY.finishedProgram}
        </p>
      ) : null}

      {formError && formError !== PROGRAMS_COPY.sortIncomplete ? (
        <p className={`mt-6 ${programsMissPanel}`} role="alert">
          {formError}
        </p>
      ) : null}

      <div className="mt-12 flex flex-col-reverse gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
        {previousHref ? (
          <button
            type="button"
            className={`${utSecondaryBtn} w-full sm:w-auto`}
            onClick={() => void onPrevious()}
            disabled={phase !== "idle"}
          >
            Previous
          </button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-end">
          {hasQuiz && quizGraded ? (
            <button
              type="button"
              className={`${utSecondaryBtn} w-full sm:w-auto`}
              onClick={retryQuiz}
              disabled={phase !== "idle"}
            >
              {PROGRAMS_COPY.quizTakeAgain}
            </button>
          ) : null}
          {hasQuiz && !quizGraded ? (
            <button
              type="button"
              className={`${utPrimaryBtn} w-full sm:w-auto`}
              onClick={() => void onCheckResults()}
              disabled={phase !== "idle"}
            >
              {continueLabel}
            </button>
          ) : (
            <button
              type="button"
              className={`${utPrimaryBtn} w-full sm:w-auto`}
              onClick={() => void onContinue()}
              disabled={phase !== "idle" || !reflectionsReady}
            >
              {continueLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function BlockView({
  block,
  stepTitle,
  texts,
  onText,
  quizAnswers,
  quizResult,
  onToggleChoice,
  placements,
  sortFeedback,
  sortError,
  checkingCardId,
  onChooseCategory,
  onReplaySort,
  choiceId,
  onChoice,
  reflectionReady,
  reflectionSaving,
  onSubmitReflection,
  showBanner,
  nearbySectionTitles,
}: {
  block: PublicLearningBlock;
  stepTitle: string;
  texts: Record<string, string>;
  onText: (questionId: string, value: string) => void;
  quizAnswers: Record<string, string[]>;
  quizResult: QuizResult | null;
  onToggleChoice: (questionId: string, choiceId: string, multiple: boolean) => void;
  placements: Record<string, string>;
  sortFeedback: "wrong" | "right" | "complete" | null;
  sortError: string | null;
  checkingCardId: string | null;
  onChooseCategory: (cardId: string, category: string) => void;
  onReplaySort: () => void;
  choiceId: string | null;
  onChoice: (choiceId: string | null) => void;
  reflectionReady: boolean;
  reflectionSaving: boolean;
  onSubmitReflection: (questionId: string) => void;
  showBanner: boolean;
  nearbySectionTitles: string[];
}) {
  if (block.type === "heading") return <ProgramsHeading block={block} />;
  if (block.type === "list") return <ProgramsList block={block} />;
  if (block.type === "table") return <ProgramsTable block={block} />;
  if (block.type === "callout") return <ProgramsCallout block={block} />;
  if (block.type === "process") return <ProgramsProcess block={block} />;
  if (block.type === "flashcard") return <ProgramsFlashcards cards={block.cards} />;
  if (block.type === "audio") {
    return <ProgramsAudio src={block.src} label={block.label} transcript={block.transcript} />;
  }
  if (block.type === "gallery") {
    return <ProgramsGallery label={block.label} images={block.images} />;
  }

  if (block.type === "markdown") {
    const text = proseBesideReveal(block.markdown, nearbySectionTitles);
    if (!text) return null;
    return (
      <ProgramsTeaching>
        <ProgramsProse text={text} />
      </ProgramsTeaching>
    );
  }

  if (block.type === "sections") {
    return <ProgramsReveal sections={block.sections} />;
  }

  if (block.type === "image") {
    if (block.role === "completion" && !showBanner) return null;
    return (
      <ProgramsQuoteImage
        src={block.src}
        alt={block.alt}
        width={block.width}
        height={block.height}
        quote={block.quote}
        attribution={block.attribution}
      />
    );
  }

  if (block.type === "video") {
    return (
      <ProgramsVideo
        title={block.visible_title}
        speaker={block.speaker}
        vimeoId={block.vimeo_video_id}
        stepTitle={stepTitle}
      />
    );
  }

  if (block.type === "choice_prompt") {
    const illustrated = block.choices.every((choice) => choice.image);
    if (illustrated) {
      const selected =
        block.choices.find((choice) => choice.id === choiceId) ?? block.choices[0] ?? null;
      const selectedIndex = Math.max(
        0,
        block.choices.findIndex((choice) => choice.id === selected?.id)
      );
      return (
        <div className={`${programsSectionCard} space-y-4`}>
          <p className={`${programsBody}`}>{block.prompt}</p>
          <div role="tablist" aria-label={block.prompt} className="flex flex-col gap-3 sm:flex-row">
            {block.choices.map((choice) => {
              const active = choice.id === selected?.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  role="tab"
                  id={`scenario-tab-${choice.id}`}
                  aria-selected={active}
                  aria-controls={`scenario-panel-${choice.id}`}
                  tabIndex={active ? 0 : -1}
                  className={active ? `${utPrimaryBtn} w-full sm:w-auto` : `${utSecondaryBtn} w-full sm:w-auto`}
                  onClick={() => onChoice(choice.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                    event.preventDefault();
                    const delta = event.key === "ArrowRight" ? 1 : -1;
                    const next = block.choices[(selectedIndex + delta + block.choices.length) % block.choices.length];
                    if (!next) return;
                    onChoice(next.id);
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>(`#scenario-tab-${next.id}`)
                      ?.focus();
                  }}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          {selected?.image ? (
            <div
              role="tabpanel"
              id={`scenario-panel-${selected.id}`}
              aria-labelledby={`scenario-tab-${selected.id}`}
              className="space-y-4"
            >
              <div className="space-y-3">
                <div className={programsAccentRule} aria-hidden="true" />
                <h3 className="text-xl font-semibold text-stone-50">{selected.label}</h3>
              </div>
              <div className="relative aspect-[4/3] max-w-md overflow-hidden rounded-md">
                <Image
                  src={selected.image.src}
                  alt={selected.image.alt}
                  fill
                  className="object-cover"
                  sizes="(min-width: 768px) 28rem, 100vw"
                />
              </div>
              <ProgramsProse text={presentScenarioChoiceResponse(selected.response)} />
            </div>
          ) : null}
        </div>
      );
    }
    const selected = block.choices.find((choice) => choice.id === choiceId) ?? null;
    return (
      <div className={`${programsSectionCard} space-y-4`}>
        <p className={`${programsBody}`}>{block.prompt}</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          {block.choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={choice.id === choiceId ? `${utPrimaryBtn} w-full sm:w-auto` : utSecondaryBtn}
              onClick={() => onChoice(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {selected ? (
          <div className="space-y-4">
            <ProgramsProse text={presentScenarioChoiceResponse(selected.response)} />
            <p className={programsSuccessPanel} role="status">
              {PROGRAMS_COPY.scenarioComplete}
            </p>
            <button type="button" className={utSecondaryBtn} onClick={() => onChoice(null)}>
              {PROGRAMS_COPY.scenarioStartOver}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (block.type === "quiz") {
    return (
      <ProgramsKnowledgeCheck
        block={block}
        answers={quizAnswers}
        result={quizResult}
        onToggleChoice={onToggleChoice}
      />
    );
  }

  if (block.type === "reflection") {
    const draft = texts[block.question_id] ?? "";
    const promptClass =
      block.prompt_role === "accent"
        ? `${programsInstructionHeading} block`
        : `${programsBody} block font-medium`;
    return (
      <div className={programsSectionCard}>
        <label className="block space-y-3">
          <span className={programsGroupLabel}>Reflection</span>
          <span className={promptClass}>{block.prompt}</span>
          <textarea
            className={`${utFormField} min-h-36`}
            rows={6}
            value={draft}
            maxLength={4000}
            autoComplete="off"
            onChange={(event) => onText(block.question_id, event.target.value)}
          />
        </label>
        {reflectionSaving ? (
          <p className={`mt-3 ${utBodyMuted}`} aria-live="polite">
            Saving…
          </p>
        ) : null}
        {reflectionReady ? (
          <p className={`mt-3 ${utBodyMuted}`} role="status">
            Saved
          </p>
        ) : (
          <button
            type="button"
            className={`${utPrimaryBtn} mt-4`}
            disabled={draft.trim().length === 0 || reflectionSaving}
            onClick={() => onSubmitReflection(block.question_id)}
          >
            Submit
          </button>
        )}
      </div>
    );
  }

  if (block.type !== "sort") return null;

  const placedCount = block.cards.filter((card) => placements[card.id]).length;
  const active = block.cards.find((card) => !placements[card.id]) ?? null;

  return (
    <div className="space-y-4">
      <ProgramsTeaching>
        <div className="space-y-3">
          <div className={programsAccentRule} aria-hidden="true" />
          <h2 className={programsSortActivityTitle}>
          {nativeSortDirections(block.prompt, block.categories)}
          </h2>
        </div>
      </ProgramsTeaching>
      {sortFeedback === "right" ? (
        <p className={programsSuccessPanel} role="status">
          {PROGRAMS_COPY.sortCorrect}
        </p>
      ) : null}
      {active ? (
        <div
          className={`${programsSectionCard} ${
            sortFeedback === "wrong" ? "border-red-500/40" : ""
          }`}
        >
          <p className={programsSortCardIndex}>{sortCardLabel(placedCount + 1, block.cards.length)}</p>
          <p className={programsSortCardHeading}>{active.text}</p>
          {sortFeedback === "wrong" ? (
            <p className={programsMissPanel} role="status">
              {PROGRAMS_COPY.sortRetry}
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
            {block.categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`${utSecondaryBtn} w-full whitespace-normal break-words text-left sm:w-full`}
                disabled={checkingCardId === active.id}
                aria-label={`${active.text}: ${category}`}
                onClick={() => onChooseCategory(active.id, category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p
          className={programsSuccessPanel}
          role="status"
        >
          {sortCompleteMessage(block.cards.length)}
        </p>
      )}
      {sortFeedback === "complete" ? (
        <button type="button" className={utSecondaryBtn} onClick={onReplaySort}>
          {PROGRAMS_COPY.sortReplay}
        </button>
      ) : null}
      {sortError ? (
        <p className={programsMissPanel} role="alert">
          {sortError}
        </p>
      ) : null}
    </div>
  );
}
