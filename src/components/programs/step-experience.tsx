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
  utBody,
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
  programsEyebrow,
  programsMissPanel,
  programsSectionCard,
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

const SAVE_DELAY_MS = 700;
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
          block.type === "reflection" && block.persist !== false
      ),
    [step.blocks]
  );
  const unsavedReflections = useMemo(
    () =>
      step.blocks.filter(
        (block): block is Extract<PublicLearningBlock, { type: "reflection" }> =>
          block.type === "reflection" && block.persist === false
      ),
    [step.blocks]
  );
  const revealGates = useMemo(() => {
    const gates = new Set<string>();
    for (const block of step.blocks) {
      if ("reveal_after" in block && block.reveal_after) gates.add(block.reveal_after);
    }
    return gates;
  }, [step.blocks]);
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
  const [ephemeral, setEphemeral] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<"idle" | "saving" | "advancing">("idle");
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const savedSnapshot = useRef(texts);
  const generation = useRef(0);
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

  const persistReflections = useCallback(
    async (current: Record<string, string>): Promise<boolean> => {
      const token = ++generation.current;
      const pendingWrites = reflectionBlocks.filter((block) => current[block.question_id]?.trim());
      if (pendingWrites.length === 0) return true;

      setSaveState("saving");
      for (const block of pendingWrites) {
        const result = await saveLearningReflection({
          miniProgramId,
          stepId: step.id,
          questionId: block.question_id,
          answerText: current[block.question_id] ?? "",
        });
        if (generation.current !== token) return true;
        if (!result.ok) {
          setSaveState("error");
          setFormError(result.message);
          return false;
        }
      }
      savedSnapshot.current = { ...current };
      setSaveState("saved");
      setFormError(null);
      return true;
    },
    [miniProgramId, reflectionBlocks, step.id]
  );

  useEffect(() => {
    if (phase !== "idle") return;
    const dirty = reflectionBlocks.some(
      (block) => (texts[block.question_id] ?? "") !== (savedSnapshot.current[block.question_id] ?? "")
    );
    if (!dirty) return;
    const handle = window.setTimeout(() => {
      void persistReflections(texts);
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [phase, persistReflections, reflectionBlocks, texts]);

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
    if (unsavedReflections.some((block) => !revealed[block.question_id])) {
      setFormError(PROGRAMS_COPY.unsavedReflectionRequired);
      return;
    }
    setPhase("saving");
    setFormError(null);
    const saved = await persistReflections(texts);
    if (!saved) {
      setPhase("idle");
      return;
    }
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
    setPhase("saving");
    setFormError(null);
    const saved = await persistReflections(texts);
    if (!saved) {
      setPhase("idle");
      return;
    }
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

  const lastReflectionId = reflectionBlocks.at(-1)?.question_id ?? null;

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
              if (saveState === "error") setSaveState("idle");
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
            ephemeral={ephemeral}
            onEphemeral={(questionId, value) =>
              setEphemeral((current) => ({ ...current, [questionId]: value }))
            }
            revealed={revealed}
            onReveal={(questionId) => setRevealed((current) => ({ ...current, [questionId]: true }))}
            gatesFollowing={
              block.type === "reflection" ? revealGates.has(block.question_id) : false
            }
            saveState={saveState}
            showSave={
              block.type === "reflection" && block.question_id === lastReflectionId
            }
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
              disabled={phase !== "idle"}
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
  ephemeral,
  onEphemeral,
  revealed,
  onReveal,
  gatesFollowing,
  saveState,
  showSave,
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
  ephemeral: Record<string, string>;
  onEphemeral: (questionId: string, value: string) => void;
  revealed: Record<string, boolean>;
  onReveal: (questionId: string) => void;
  gatesFollowing: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
  showSave: boolean;
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
          <p className={`${utBody} text-stone-100`}>{block.prompt}</p>
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
              <h3 className="text-xl font-semibold text-stone-50">{selected.label}</h3>
              <div className="relative aspect-[4/3] max-w-md overflow-hidden rounded-md">
                <Image
                  src={selected.image.src}
                  alt={selected.image.alt}
                  fill
                  className="object-cover"
                  sizes="(min-width: 768px) 28rem, 100vw"
                />
              </div>
              <ProgramsProse text={selected.response} />
            </div>
          ) : null}
        </div>
      );
    }
    const selected = block.choices.find((choice) => choice.id === choiceId) ?? null;
    return (
      <div className={`${programsSectionCard} space-y-4`}>
        <p className={`${utBody} text-stone-100`}>{block.prompt}</p>
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
            <ProgramsProse text={selected.response} />
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
    if (block.persist === false) {
      const submitted = Boolean(revealed[block.question_id]);
      const draft = ephemeral[block.question_id] ?? "";
      return (
        <div className={programsSectionCard}>
          <label className="block space-y-3">
            <span className={programsEyebrow}>Reflection</span>
            <span className={`${utBody} block font-medium text-stone-100`}>{block.prompt}</span>
            <textarea
              className={`${utFormField} min-h-36`}
              rows={6}
              value={draft}
              maxLength={4000}
              autoComplete="off"
              disabled={submitted}
              onChange={(event) => onEphemeral(block.question_id, event.target.value)}
            />
          </label>
          <p className={`mt-3 ${utBodyMuted}`}>This response is not saved.</p>
          {submitted ? (
            block.confirmation ? (
              <p className={`mt-4 ${programsSuccessPanel}`} role="status">
                {block.confirmation}
              </p>
            ) : null
          ) : (
            <button
              type="button"
              className={`${utPrimaryBtn} mt-4`}
              disabled={draft.trim().length === 0}
              onClick={() => onReveal(block.question_id)}
            >
              Submit
            </button>
          )}
        </div>
      );
    }
    const draft = texts[block.question_id] ?? "";
    const opened = Boolean(revealed[block.question_id]);
    return (
      <div className={programsSectionCard}>
        <label className="block space-y-3">
          <span className={programsEyebrow}>Reflection</span>
          <span className={`${utBody} block font-medium text-stone-100`}>{block.prompt}</span>
          <textarea
            className={`${utFormField} min-h-36`}
            rows={6}
            value={texts[block.question_id] ?? ""}
            maxLength={4000}
            autoComplete="off"
            onChange={(event) => onText(block.question_id, event.target.value)}
          />
        </label>
        {showSave ? (
          <p className={utBodyMuted} aria-live="polite">
            {saveState === "saving" ? "Saving…" : null}
            {saveState === "saved" ? "Saved" : null}
            {saveState === "error" ? "Couldn't save" : null}
          </p>
        ) : null}
        {gatesFollowing && !opened ? (
          <button
            type="button"
            className={`${utSecondaryBtn} mt-4`}
            disabled={draft.trim().length === 0}
            onClick={() => onReveal(block.question_id)}
          >
            Show what comes next
          </button>
        ) : null}
      </div>
    );
  }

  if (block.type !== "sort") return null;

  const placedCount = block.cards.filter((card) => placements[card.id]).length;
  const active = block.cards.find((card) => !placements[card.id]) ?? null;

  return (
    <div className="space-y-4">
      <ProgramsTeaching>
        <p className={`${utBody} text-stone-100`}>
          {nativeSortDirections(block.prompt, block.categories)}
        </p>
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
          <p className={utBodyMuted}>{sortCardLabel(placedCount + 1, block.cards.length)}</p>
          <p className={`${utBody} text-lg text-stone-50`}>{active.text}</p>
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
