/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLearningStepForClient } from "@/lib/learning/load-curriculum";
import {
  PROGRAMS_COPY,
  quizResultMessage,
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
      programTitle="Respect Yourself and Others"
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
        programTitle="Communicate for Success"
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
    const quote = container.querySelector("blockquote");
    expect(quote?.textContent).toContain(
      "There is no such thing as self-respect without respect for others."
    );
    expect(quote?.textContent).toContain("Pat Summitt");
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

  it("shows quiz results before a separate continue, and a miss cannot advance", async () => {
    const user = userEvent.setup();
    const step = publicStep("dd_mp_02_st_002");
    const quiz = step.blocks.find((block) => block.type === "quiz");
    if (!quiz || quiz.type !== "quiz") throw new Error("missing quiz");
    const [first, second, third] = quiz.questions;
    if (!first || !second || !third) throw new Error("missing questions");
    const missed = {
      correctCount: 1,
      questionCount: 3,
      minimumCorrect: 2,
      questions: [
        { questionId: first.question_id, correct: true },
        { questionId: second.question_id, correct: false },
        { questionId: third.question_id, correct: false },
      ],
    };
    const earned = {
      correctCount: 2,
      questionCount: 3,
      minimumCorrect: 2,
      questions: [
        { questionId: first.question_id, correct: true },
        { questionId: second.question_id, correct: false },
        { questionId: third.question_id, correct: true },
      ],
    };
    gradeLearningStep.mockResolvedValueOnce({
      ok: false,
      message: quizResultMessage(1, 3, 2),
      quiz: missed,
    });
    const view = renderStep("dd_mp_02_st_002");
    expect(screen.getByText(/unlimited attempts/i)).toBeTruthy();
    expect(screen.queryByText(/certificate/i)).toBeNull();
    const card = view.container.querySelector("[data-question-card]");
    expect(card).toBeTruthy();
    expect(card?.querySelector("legend")).toBeNull();
    expect(card?.textContent).toContain(first.prompt);
    const choice = screen.getByText("feel important").closest("label");
    expect(choice?.getAttribute("data-selected")).toBe("false");
    expect(choice?.closest("[data-question-card]")).toBeTruthy();
    await user.click(screen.getByText("feel important"));
    expect(choice?.getAttribute("data-selected")).toBe("true");

    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    const miss = await screen.findByRole("status");
    expect(miss.textContent).toContain(PROGRAMS_COPY.quizYourScore);
    expect(miss.textContent).toContain(PROGRAMS_COPY.quizFailed);
    expect(miss.textContent).toContain("1 of 3 correct");
    expect(miss.textContent).toContain("Passing: 2 of 3");
    expect(screen.getByText("Correct")).toBeTruthy();
    expect(screen.getAllByText("Incorrect").length).toBe(2);
    expect(continueLearningStep).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizTakeAgain }));
    expect(screen.queryByText(PROGRAMS_COPY.quizFailed)).toBeNull();

    gradeLearningStep.mockResolvedValueOnce({ ok: true, quiz: earned });
    await user.click(screen.getByRole("button", { name: PROGRAMS_COPY.quizSeeResults }));
    expect(await screen.findByText(PROGRAMS_COPY.quizPassed)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 1000));
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
