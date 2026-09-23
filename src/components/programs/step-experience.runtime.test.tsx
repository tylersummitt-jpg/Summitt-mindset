/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLearningMiniProgram, getLearningStepForClient } from "@/lib/learning/load-curriculum";
import {
  PROGRAMS_COPY,
  quizPrimaryLabel,
  sortCardLabel,
  sortCompleteMessage,
} from "@/lib/learning/programs-copy";
import { StepExperience } from "./step-experience";

const saveLearningReflection = vi.hoisted(() => vi.fn());
const continueLearningStep = vi.hoisted(() => vi.fn());
const gradeLearningStep = vi.hoisted(() => vi.fn());
const checkLearningSortCard = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());

vi.mock("@/app/programs/actions", () => ({
  saveLearningReflection,
  continueLearningStep,
  gradeLearningStep,
  checkLearningSortCard,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

function gradedView(
  quiz: { questions: Array<{ question_id: string }>; minimum_correct: number },
  selected: Record<string, string[]>,
  correct: Record<string, boolean>,
  keys: Record<string, string[]>
) {
  const questions = quiz.questions.map((question) => ({
    questionId: question.question_id,
    correct: correct[question.question_id] ?? false,
    selectedChoiceIds: selected[question.question_id] ?? [],
    correctChoiceIds: keys[question.question_id] ?? [],
  }));
  return {
    correctCount: questions.filter((question) => question.correct).length,
    questionCount: quiz.questions.length,
    minimumCorrect: quiz.minimum_correct,
    questions,
  };
}

function publicStep(stepId: string) {
  const step = getLearningStepForClient("dd_mp_02", stepId);
  if (!step) throw new Error(`missing ${stepId}`);
  return step;
}

function renderStep(
  stepId: string,
  options?: {
    initialAnswers?: Record<string, string>;
    enforceRequirements?: boolean;
    previousHref?: string | null;
  }
) {
  const step = publicStep(stepId);
  return render(
    <StepExperience
      miniProgramId="dd_mp_02"
      collectionTitle="Definite Dozen"
      step={step}
      stepCount={18}
      previousHref={options?.previousHref ?? null}
      initialAnswers={options?.initialAnswers ?? {}}
      enforceRequirements={options?.enforceRequirements ?? true}
      isLastStep={step.sequence === 18}
    />
  );
}

describe("step experience", () => {
  beforeEach(() => {
    saveLearningReflection.mockReset();
    continueLearningStep.mockReset();
    gradeLearningStep.mockReset();
    checkLearningSortCard.mockReset();
    push.mockReset();
    saveLearningReflection.mockResolvedValue({ ok: true });
    continueLearningStep.mockResolvedValue({
      ok: true,
      href: "/programs/definite-dozen/respect-yourself-and-others/dd_mp_02_st_002",
    });
    checkLearningSortCard.mockResolvedValue({ ok: true, correct: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the Communicate for Success reflections without an unresolved video", () => {
    const step = getLearningStepForClient("cw_mp_10", "cw_mp_10_st_007");
    if (!step) throw new Error("missing cw_mp_10_st_007");
    const { container } = render(
      <StepExperience
        miniProgramId="cw_mp_10"
        collectionTitle="Championing Women in Leadership"
        step={step}
        stepCount={6}
        previousHref={null}
        initialAnswers={{}}
        enforceRequirements
        isLastStep
      />
    );
    expect(step.blocks.some((block) => block.type === "video")).toBe(false);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).toContain("How often do you use qualifier words");
    expect(container.textContent).not.toContain("Michelle Marciniak");
    expect(container.textContent).not.toContain("1150877298");
  });

  it("embeds only a confirmed Vimeo id", () => {
    const { container } = renderStep("dd_mp_02_st_006");
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toContain("player.vimeo.com/video/1150754397");
    expect(iframe?.getAttribute("src")).not.toContain("autoplay");
    expect(iframe?.parentElement?.className).toContain("aspect-video");
  });

  it("shows the lesson header, a derived progress bar, and a quote callout", () => {
    const { container } = renderStep("dd_mp_02_st_001");
    const title = screen.getByRole("heading", { level: 1, name: "Pat in Her Own Words" });
    expect(title.className).toContain("text-3xl");
    expect(screen.getByText("1.1 Pat in Her Own Words").className).toContain("text-[var(--brand)]");
    const progress = screen.getByRole("progressbar");
    expect(progress.getAttribute("aria-valuenow")).toBe("1");
    expect(progress.getAttribute("aria-valuemax")).toBe("18");
    expect(progress.getAttribute("aria-label")).toBe("Step 1 of 18");
    expect(screen.getByText("1.1 Pat in Her Own Words")).toBeTruthy();
    const header = container.querySelector("header");
    expect(header?.textContent).not.toContain("Programs");
    expect(header?.textContent).not.toContain("Principle 1: Respect Yourself & Others");
    const quote = container.querySelector("blockquote");
    expect(quote?.textContent).toContain(
      "There is no such thing as self-respect without respect for others."
    );
    expect(quote?.textContent).toContain("Pat Summitt");
  });

  it("keeps the step title and drops the Programs and mini-program header lines", () => {
    const cases = [
      {
        miniProgramId: "dd_mp_02",
        stepId: "dd_mp_02_st_001",
        groupLabel: "1.1 Pat in Her Own Words",
      },
      {
        miniProgramId: "cw_mp_01",
        stepId: "cw_mp_01_st_002",
        groupLabel: null,
      },
      {
        miniProgramId: "potl_mp_07",
        stepId: "potl_mp_07_st_001",
        groupLabel: null,
      },
    ];

    for (const item of cases) {
      const program = getLearningMiniProgram(item.miniProgramId);
      const step = getLearningStepForClient(item.miniProgramId, item.stepId);
      if (!program || !step) throw new Error(`missing ${item.stepId}`);
      const view = render(
        <StepExperience
          miniProgramId={program.id}
          collectionTitle={program.collection_title}
          step={step}
          stepCount={program.steps.length}
          previousHref={null}
          initialAnswers={{}}
          enforceRequirements
          isLastStep={false}
        />
      );
      const header = view.container.querySelector("header");
      if (!header) throw new Error("missing header");
      const paragraphs = [...header.querySelectorAll("p")].map((node) => node.textContent);
      expect(header.querySelector("a")).toBeNull();
      expect(header.textContent).not.toContain("Programs");
      expect(paragraphs).not.toContain(program.title);
      expect(header.querySelector("h1")?.textContent).toBe(step.title);
      expect(paragraphs).toContain(program.collection_title);
      if (item.groupLabel) expect(paragraphs).toContain(item.groupLabel);
      expect(header.textContent).toContain(`Step ${step.sequence} of ${program.steps.length}`);
      const progress = header.querySelector("[role='progressbar']");
      expect(progress?.getAttribute("aria-valuenow")).toBe(String(step.sequence));
      expect(progress?.getAttribute("aria-valuemax")).toBe(String(program.steps.length));
      expect(header.querySelector("[aria-hidden='true']")?.className).toContain("bg-[var(--brand)]");
      cleanup();
    }
  });

  it("shows a completion state before leaving the last step", async () => {
    const user = userEvent.setup();
    continueLearningStep.mockResolvedValue({
      ok: true,
      href: "/programs",
    });
    renderStep("dd_mp_02_st_018", {
      initialAnswers: {
        dd_mp_02_st_018_reflection_01: "One",
        dd_mp_02_st_018_reflection_02: "Two",
      },
    });
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText(PROGRAMS_COPY.finishedProgram)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(push).toHaveBeenCalledWith("/programs");
      },
      { timeout: 2000 }
    );
  });

  it("does not put quiz or sort answer keys in the page", () => {
    const quiz = renderStep("dd_mp_02_st_002");
    expect(quiz.container.innerHTML).not.toContain("correct_choice_ids");
    expect(quiz.container.innerHTML).not.toContain("is_correct");
    expect(quiz.container.innerHTML).not.toContain("correct_category");
    cleanup();

    const sort = renderStep("dd_mp_02_st_003");
    expect(sort.container.innerHTML).not.toContain("correct_category");
    expect(sort.container.innerHTML).not.toContain("correct_choice_ids");
  });

  it("restores a saved reflection, autosaves, and stays put when continue fails", async () => {
    const user = userEvent.setup();
    continueLearningStep.mockResolvedValue({
      ok: false,
      message: PROGRAMS_COPY.progressSaveFailed,
    });
    renderStep("dd_mp_02_st_013", {
      initialAnswers: { dd_mp_02_st_013_reflection_01: "Saved earlier" },
    });
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveProperty("value", "Saved earlier");
    expect(textarea.className).toContain("text-base");

    await user.clear(textarea);
    await user.type(textarea, "A later answer");
    await waitFor(() => {
      expect(saveLearningReflection).toHaveBeenCalled();
    });
    const payload = saveLearningReflection.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      miniProgramId: "dd_mp_02",
      stepId: "dd_mp_02_st_013",
      questionId: "dd_mp_02_st_013_reflection_01",
    });
    expect(payload.answerText).toContain("A later answer");
    expect(payload).not.toHaveProperty("clerkUserId");
    expect(payload).not.toHaveProperty("clerk_user_id");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(PROGRAMS_COPY.progressSaveFailed);
    expect(textarea).toHaveProperty("value", expect.stringContaining("A later answer"));
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps Continue available after a graded miss on the lesson footer", async () => {
    const user = userEvent.setup();
    const step = publicStep("dd_mp_02_st_002");
    const quiz = step.blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("missing quiz");
    const belowThreshold = {
      correctCount: 1,
      questionCount: 3,
      minimumCorrect: 3,
      questions: quiz.questions.map((question, index) => ({
        questionId: question.question_id,
        correct: index === 0,
        selectedChoiceIds: [question.choices[0]?.id ?? ""],
        correctChoiceIds: [question.choices[index === 0 ? 0 : 1]?.id ?? ""],
      })),
    };
    expect(belowThreshold.correctCount).toBeLessThan(belowThreshold.minimumCorrect);
    expect(
      quizPrimaryLabel({
        saving: false,
        hasQuiz: true,
        graded: true,
        isLastStep: false,
        enforceRequirements: true,
      })
    ).toBe("Continue");

    gradeLearningStep.mockResolvedValueOnce({
      ok: false,
      message: "Your score 1 of 3 correct. Failed. Passing: 3 of 3.",
      quiz: belowThreshold,
    });
    renderStep("dd_mp_02_st_002");
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Your score");
    expect(status.textContent).toContain("1 of 3 correct");
    expect(status.textContent).not.toContain("Failed");
    expect(status.textContent).not.toContain("Passing:");
    expect(screen.getByRole("button", { name: PROGRAMS_COPY.quizTakeAgain })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: PROGRAMS_COPY.quizSeeResults })).toBeNull();
    expect(screen.queryByText(/You must/i)).toBeNull();

    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizTakeAgain }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults })).toBeTruthy();

    gradeLearningStep.mockResolvedValueOnce({
      ok: true,
      quiz: { ...belowThreshold, correctCount: 0 },
    });
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    expect(await screen.findByText("0 of 3 correct")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: PROGRAMS_COPY.quizSeeResults })).toBeNull();
  });

  it("shows Continue after a perfect quiz score", async () => {
    const user = userEvent.setup();
    const step = publicStep("dd_mp_02_st_002");
    const quiz = step.blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("missing quiz");
    gradeLearningStep.mockResolvedValueOnce({
      ok: true,
      quiz: {
        correctCount: 3,
        questionCount: 3,
        minimumCorrect: 3,
        questions: quiz.questions.map((question) => ({
          questionId: question.question_id,
          correct: true,
          selectedChoiceIds: [question.choices[0]?.id ?? ""],
          correctChoiceIds: [question.choices[0]?.id ?? ""],
        })),
      },
    });
    renderStep("dd_mp_02_st_002");
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    expect(await screen.findByText("3 of 3 correct")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: PROGRAMS_COPY.quizSeeResults })).toBeNull();
    expect(screen.queryByText("Failed")).toBeNull();
    expect(screen.queryByText(/Passing:/)).toBeNull();
  });

  it("shows quiz results before continue, including a miss", async () => {
    const user = userEvent.setup();
    const step = publicStep("dd_mp_02_st_002");
    const quiz = step.blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("missing quiz");
    const [first, second, third] = quiz.questions;
    if (!first || !second || !third) throw new Error("missing questions");
    const missed = gradedView(quiz, {
      [first.question_id]: [first.choices[0]?.id ?? ""],
      [second.question_id]: [],
      [third.question_id]: [],
    }, {
      [first.question_id]: true,
      [second.question_id]: false,
      [third.question_id]: false,
    }, {
      [first.question_id]: [first.choices[0]?.id ?? ""],
      [second.question_id]: [second.choices[1]?.id ?? ""],
      [third.question_id]: [third.choices[1]?.id ?? ""],
    });
    const earned = {
      ...missed,
      correctCount: 2,
      questions: missed.questions.map((question, index) =>
        index === 2 ? { ...question, correct: true } : question
      ),
    };
    gradeLearningStep.mockResolvedValueOnce({ ok: true, quiz: missed });
    const view = renderStep("dd_mp_02_st_002");
    expect(screen.getByText(/unlimited attempts/i)).toBeTruthy();
    expect(screen.getByText(/you can continue after you see how you did/i)).toBeTruthy();
    expect(screen.queryByText(/must answer/i)).toBeNull();
    expect(screen.queryByText(/certificate/i)).toBeNull();
    expect(view.container.innerHTML).not.toContain("correct_choice_ids");
    expect(view.container.textContent).not.toContain("Correct answer");
    const card = view.container.querySelector("[data-question-card]");
    expect(card).toBeTruthy();
    expect(card?.querySelector("legend")).toBeNull();
    expect(card?.textContent).toContain(first.prompt);
    const choice = screen.getByText("feel important").closest("label");
    expect(choice?.getAttribute("data-selected")).toBe("false");
    await user.click(screen.getByText("feel important"));
    expect(choice?.getAttribute("data-selected")).toBe("true");

    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    const miss = await screen.findByRole("status");
    expect(miss.textContent).toContain(PROGRAMS_COPY.quizYourScore);
    expect(miss.textContent).toContain("1 of 3 correct");
    expect(miss.textContent).toContain(PROGRAMS_COPY.quizReview);
    expect(miss.textContent).not.toContain("Failed");
    expect(miss.textContent).not.toContain("Passing:");
    expect(screen.getAllByText("Correct").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Incorrect").length).toBe(2);
    expect(screen.getAllByText("Correct answer").length).toBeGreaterThan(0);
    expect(continueLearningStep).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizTakeAgain }));
    expect(screen.queryByText(PROGRAMS_COPY.quizYourScore)).toBeNull();
    expect(screen.queryByText("Correct answer")).toBeNull();
    expect(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults })).toBeTruthy();

    gradeLearningStep.mockResolvedValueOnce({ ok: true, quiz: earned });
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    expect(await screen.findByText("2 of 3 correct")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    continueLearningStep.mockResolvedValueOnce({
      ok: true,
      href: "/programs/definite-dozen/respect-yourself-and-others/dd_mp_02_st_003",
      quiz: earned,
    });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        "/programs/definite-dozen/respect-yourself-and-others/dd_mp_02_st_003"
      );
    });
  });

  it("marks single-select and multi-select choices after submission", async () => {
    const user = userEvent.setup();
    const step = publicStep("dd_mp_02_st_002");
    const quiz = step.blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("missing quiz");
    const single = quiz.questions.find((question) => question.question_type !== "multiple_choice");
    const multi = quiz.questions.find((question) => question.question_type === "multiple_choice");
    if (!single || !multi) throw new Error("missing question types");
    const singleCorrect = single.choices[1];
    const singleWrong = single.choices[0];
    const singleNeutral = single.choices[2];
    const multiCorrect = multi.choices.slice(0, 2);
    const multiWrong = multi.choices[2];
    if (!singleCorrect || !singleWrong || !singleNeutral || !multiWrong || multiCorrect.length < 2) {
      throw new Error("missing choices");
    }
    gradeLearningStep.mockResolvedValueOnce({
      ok: true,
      quiz: {
        correctCount: 0,
        questionCount: quiz.questions.length,
        minimumCorrect: quiz.minimum_correct,
        questions: quiz.questions.map((question) => {
          if (question.question_id === single.question_id) {
            return {
              questionId: question.question_id,
              correct: false,
              selectedChoiceIds: [singleWrong.id],
              correctChoiceIds: [singleCorrect.id],
            };
          }
          if (question.question_id === multi.question_id) {
            return {
              questionId: question.question_id,
              correct: false,
              selectedChoiceIds: [multiCorrect[0]!.id, multiWrong.id],
              correctChoiceIds: multiCorrect.map((choice) => choice.id),
            };
          }
          return {
            questionId: question.question_id,
            correct: false,
            selectedChoiceIds: [],
            correctChoiceIds: [question.choices[0]?.id ?? ""],
          };
        }),
      },
    });
    const view = renderStep("dd_mp_02_st_002");
    expect(view.container.querySelector("[data-choice-result]")).toBeNull();
    expect(view.container.innerHTML).not.toContain("correct_choice_ids");
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    const singleWrongLabel = await screen.findByText(singleWrong.text).then((node) => node.closest("label"));
    const singleCorrectLabel = screen.getByText(singleCorrect.text).closest("label");
    const singleNeutralLabel = screen.getByText(singleNeutral.text).closest("label");
    expect(singleWrongLabel?.getAttribute("data-choice-result")).toBe("incorrect");
    expect(singleWrongLabel?.textContent).toContain("Your answer");
    expect(singleCorrectLabel?.getAttribute("data-choice-result")).toBe("correct");
    expect(singleCorrectLabel?.textContent).toContain("Correct answer");
    expect(singleNeutralLabel?.getAttribute("data-choice-result")).toBe("neutral");
    expect(singleNeutralLabel?.textContent).not.toContain("Correct answer");
    expect(singleNeutralLabel?.textContent).not.toContain("Your answer");
    expect(
      screen.getByText(single.prompt).closest("[data-question-card]")?.getAttribute("data-question-result")
    ).toBe("incorrect");

    for (const choice of multiCorrect) {
      const label = screen.getByText(choice.text).closest("label");
      expect(label?.getAttribute("data-choice-result")).toBe("correct");
      expect(label?.textContent).toContain("Correct answer");
    }
    const wrongMulti = screen.getByText(multiWrong.text).closest("label");
    expect(wrongMulti?.getAttribute("data-choice-result")).toBe("incorrect");
    expect(wrongMulti?.textContent).toContain("Your answer");
    expect(
      screen.getByText(multi.prompt).closest("[data-question-card]")?.getAttribute("data-question-result")
    ).toBe("incorrect");
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByRole("button", { name: PROGRAMS_COPY.quizTakeAgain })).toBeTruthy();

    gradeLearningStep.mockResolvedValueOnce({
      ok: true,
      quiz: {
        correctCount: 1,
        questionCount: quiz.questions.length,
        minimumCorrect: quiz.minimum_correct,
        questions: quiz.questions.map((question) => {
          if (question.question_id === single.question_id) {
            return {
              questionId: question.question_id,
              correct: true,
              selectedChoiceIds: [singleCorrect.id],
              correctChoiceIds: [singleCorrect.id],
            };
          }
          return {
            questionId: question.question_id,
            correct: false,
            selectedChoiceIds: [],
            correctChoiceIds: [question.choices[0]?.id ?? ""],
          };
        }),
      },
    });
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizTakeAgain }));
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    const correctLabel = (await screen.findAllByText(singleCorrect.text))
      .map((node) => node.closest("label"))
      .find((label) => label?.getAttribute("data-choice-result") === "correct");
    expect(correctLabel?.textContent).toContain("Correct answer");
    expect(correctLabel?.textContent).not.toContain("Your answer");
    expect(screen.getByText(singleWrong.text).closest("label")?.getAttribute("data-choice-result")).toBe(
      "neutral"
    );
    expect(
      screen.getByText(single.prompt).closest("[data-question-card]")?.getAttribute("data-question-result")
    ).toBe("correct");
  });

  it("finishes a last-step quiz after a miss", async () => {
    const user = userEvent.setup();
    const step = getLearningStepForClient("dd_mp_03", "dd_mp_03_st_012");
    if (!step) throw new Error("missing final quiz");
    const quiz = step.blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("missing quiz");
    gradeLearningStep.mockResolvedValueOnce({
      ok: true,
      quiz: {
        correctCount: 0,
        questionCount: quiz.questions.length,
        minimumCorrect: quiz.minimum_correct,
        questions: quiz.questions.map((question) => ({
          questionId: question.question_id,
          correct: false,
          selectedChoiceIds: [],
          correctChoiceIds: [question.choices[0]?.id ?? ""],
        })),
      },
    });
    continueLearningStep.mockResolvedValueOnce({ ok: true, href: "/programs" });
    render(
      <StepExperience
        miniProgramId="dd_mp_03"
        collectionTitle="Definite Dozen"
        step={step}
        stepCount={step.sequence}
        previousHref={null}
        initialAnswers={{}}
        enforceRequirements
        isLastStep
      />
    );
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    expect(await screen.findByText("0 of 3 correct")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText(PROGRAMS_COPY.finishedProgram)).toBeTruthy();
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/programs");
    });
  });

  it("sorts one card at a time and keeps a wrong card in place", async () => {
    const user = userEvent.setup();
    renderStep("dd_mp_02_st_003");
    expect(screen.getByText(sortCardLabel(1, 6))).toBeTruthy();
    expect(screen.getByText("Coercion / force")).toBeTruthy();
    expect(screen.queryByText("Demanding")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Coercion / force: Great ways to earn respect" })
    );
    expect(await screen.findByText(PROGRAMS_COPY.sortRetry)).toBeTruthy();
    expect(screen.getByText("Coercion / force")).toBeTruthy();
    expect(screen.queryByText(PROGRAMS_COPY.sortCorrect)).toBeNull();
    expect(checkLearningSortCard).toHaveBeenCalledWith({
      miniProgramId: "dd_mp_02",
      stepId: "dd_mp_02_st_003",
      cardId: "coercion_force",
      category: "Great ways to earn respect",
    });
    const result = await checkLearningSortCard.mock.results[0]?.value;
    expect(result).toEqual({ ok: true, correct: false });
    expect(result).not.toHaveProperty("correct_category");

    checkLearningSortCard.mockResolvedValue({ ok: true, correct: true });
    await user.click(
      screen.getByRole("button", { name: "Coercion / force: Ways to destroy or harm respect" })
    );
    expect(await screen.findByText(PROGRAMS_COPY.sortCorrect)).toBeTruthy();
    expect(screen.getByText(sortCardLabel(2, 6))).toBeTruthy();
    expect(screen.getByText("Demonstrating competence")).toBeTruthy();
    expect(screen.queryByText("Demanding")).toBeNull();
  });

  it("shows sort completion only after the last card", async () => {
    const user = userEvent.setup();
    checkLearningSortCard.mockResolvedValue({ ok: true, correct: true });
    renderStep("dd_mp_02_st_003");
    for (let index = 0; index < 6; index += 1) {
      const button = screen
        .getAllByRole("button")
        .find((candidate) => candidate.getAttribute("aria-label")?.includes(":"));
      if (!button) throw new Error("missing category button");
      await user.click(button);
    }
    expect(await screen.findByText(sortCompleteMessage(6))).toBeTruthy();
    expect(screen.queryByText("Coercion / force")).toBeNull();
    expect(screen.queryByRole("button", { name: /Coercion \/ force:/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.sortReplay }));
    expect(screen.getByText(sortCardLabel(1, 6))).toBeTruthy();
    expect(screen.getByText("Coercion / force")).toBeTruthy();
    expect(screen.queryByText(sortCompleteMessage(6))).toBeNull();
  });

  it("restarts a scenario after showing it complete", async () => {
    const user = userEvent.setup();
    renderStep("dd_mp_02_st_003");
    await user.click(screen.getByRole("button", { name: "Yes, I would!" }));
    expect(screen.getByText(PROGRAMS_COPY.scenarioComplete)).toBeTruthy();
    expect(screen.getByText(/What is it about your leadership/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.scenarioStartOver }));
    expect(screen.queryByText(PROGRAMS_COPY.scenarioComplete)).toBeNull();
  });

  it("keeps long sections collapsed until a member opens one", async () => {
    const user = userEvent.setup();
    renderStep("dd_mp_02_st_007");
    const first = screen.getByRole("button", { name: /Keep moving/ });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/The habit of Keeping Moving/)).toBeNull();
    await user.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/The habit of Keeping Moving/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("shows the completion banner and an 8-card sort result", async () => {
    const user = userEvent.setup();
    const completion = renderStep("dd_mp_02_st_018", { enforceRequirements: false });
    const banner = completion.container.querySelector("img");
    expect(banner?.getAttribute("src")).toContain("dd_mp_02_st_018_wrap_up.jpg");
    expect(banner?.getAttribute("alt")).toBe("You have completed Principle 1");
    expect(screen.getByText(PROGRAMS_COPY.finishedProgram)).toBeTruthy();
    cleanup();

    const inProgress = renderStep("dd_mp_02_st_018");
    expect(inProgress.container.querySelector("img")).toBeNull();
    cleanup();

    checkLearningSortCard.mockResolvedValue({ ok: true, correct: true });
    renderStep("dd_mp_02_st_016");
    expect(screen.getByText(sortCardLabel(1, 8))).toBeTruthy();
    for (let index = 0; index < 8; index += 1) {
      const button = screen
        .getAllByRole("button")
        .find((candidate) => candidate.getAttribute("aria-label")?.includes(":"));
      if (!button) throw new Error("missing category button");
      await user.click(button);
    }
    expect(await screen.findByText(sortCompleteMessage(8))).toBeTruthy();
  });

  it("does not repeat reveal titles as a plain list and does not describe a card stack", () => {
    const physical = renderStep("dd_mp_02_st_007");
    const listed = [...physical.container.querySelectorAll("p")].filter(
      (paragraph) => paragraph.textContent === "Keep moving"
    );
    expect(listed).toHaveLength(0);
    expect(screen.getByText(/Coach Summitt found that several physical habits/)).toBeTruthy();
    expect(screen.getByText(/To summarize, there are several important physical habits/)).toBeTruthy();
    cleanup();

    const mental = renderStep("dd_mp_02_st_008");
    const mentalListed = [...mental.container.querySelectorAll("p")].filter(
      (paragraph) => paragraph.textContent === "Minimize multitasking"
    );
    expect(mentalListed).toHaveLength(0);
    expect(screen.getByText(/four key mental habits can help establish self-respect/)).toBeTruthy();
    cleanup();

    renderStep("dd_mp_02_st_003");
    expect(screen.getByText(/one action at a time/i)).toBeTruthy();
    expect(screen.queryByText(/stack of cards/i)).toBeNull();
    expect(screen.queryByText(/drag/i)).toBeNull();
    cleanup();

    renderStep("dd_mp_02_st_016");
    expect(screen.getByText(/one behavior at a time/i)).toBeTruthy();
    expect(screen.queryByText(/stack of cards/i)).toBeNull();
  });
});
