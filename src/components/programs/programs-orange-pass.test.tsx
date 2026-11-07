/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgramsKnowledgeCheck } from "@/components/programs/programs-knowledge-check";
import { ProgramsReveal } from "@/components/programs/programs-reveal";
import {
  ProgramsCallout,
  ProgramsHeading,
  ProgramsList,
  ProgramsProcess,
  ProgramsTable,
} from "@/components/programs/programs-structured";
import { ProgramsProse } from "@/components/programs/programs-prose";
import { StepExperience } from "@/components/programs/step-experience";
import {
  programsAccentRule,
  programsBody,
  programsGroupLabel,
  programsQuoteText,
  programsRevealControl,
  programsSortCardIndex,
  programsTableHeader,
} from "@/components/programs/programs-visual";
import { getLearningMiniProgram, getLearningStepForClient, listLearningCollections } from "@/lib/learning/load-curriculum";

vi.mock("@/app/programs/actions", () => ({
  saveLearningReflection: vi.fn(),
  continueLearningStep: vi.fn(),
  gradeLearningStep: vi.fn(),
  checkLearningSortCard: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

afterEach(() => {
  cleanup();
});

describe("Programs orange accents", () => {
  it("marks a level-2 heading with the orange rule and leaves the heading text light", () => {
    render(<ProgramsHeading block={{ type: "heading", level: 2, text: "Section" }} />);
    const heading = screen.getByRole("heading", { name: "Section" });
    expect(heading.tagName).toBe("H2");
    expect(heading.className).toContain("text-stone-50");
    expect(heading.className).not.toContain("brand");
    expect(heading.parentElement?.querySelector("[aria-hidden='true']")?.className).toBe(programsAccentRule);
  });

  it("does not add the rule to an ordinary level-3 heading", () => {
    const { container } = render(
      <ProgramsHeading block={{ type: "heading", level: 3, text: "Detail" }} />
    );
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(screen.getByRole("heading", { name: "Detail" }).className).not.toContain("brand");
  });

  it("uses the orange group label for Reflection and leaves the prompt in body type", () => {
    const step = getLearningStepForClient("dd_mp_02", "dd_mp_02_st_005");
    if (!step) throw new Error("missing reflection step");
    render(
      <StepExperience
        miniProgramId="dd_mp_02"
        collectionTitle="Definite Dozen"
        step={step}
        stepCount={18}
        previousHref={null}
        initialAnswers={{}}
        enforceRequirements
        isLastStep={false}
      />
    );
    const label = screen.getAllByText("Reflection")[0];
    expect(label?.className).toBe(programsGroupLabel);
    expect(label?.className).toContain("text-[var(--brand)]");
    const prompt = screen.getByText(/what can you do to create a condition where respect is earned/i);
    expect(prompt.className).toContain(programsBody);
    expect(prompt.className).not.toContain("brand");
    expect(programsBody).not.toContain("brand");
    expect(programsSortCardIndex).toContain("text-[var(--brand)]");
  });

  it("colors only the reveal control", () => {
    render(
      <ProgramsReveal
        sections={[{ id: "one", title: "Keep moving", body: "Walk for ten minutes." }]}
      />
    );
    const button = screen.getByRole("button", { name: "Keep moving" });
    expect(button.className).toContain("text-stone-50");
    expect(button.className).not.toContain("brand");
    expect(button.querySelector("[aria-hidden='true']")?.className).toBe(programsRevealControl);
    expect(programsRevealControl).toContain("text-[var(--brand)]");
  });

  it("colors table headers orange and leaves cells in the table body token", () => {
    render(
      <ProgramsTable
        block={{
          type: "table",
          headers: ["Successful leaders"],
          rows: [["Give away power."]],
        }}
      />
    );
    const header = screen.getByRole("columnheader", { name: "Successful leaders" });
    expect(header.className).toBe(programsTableHeader);
    expect(header.className).toContain("text-[var(--brand)]");
    expect(screen.getByRole("cell", { name: "Give away power." }).className).not.toContain("brand");
  });

  it("keeps process titles on the existing orange treatment and quote text off orange", () => {
    render(
      <ProgramsProcess
        block={{
          type: "process",
          steps: [{ title: "Understand yourself", body: "Notice the feeling." }],
        }}
      />
    );
    expect(screen.getByText("1. Understand yourself").className).toBe(
      "text-sm font-semibold uppercase tracking-[0.14em] text-[var(--brand)]"
    );
    expect(screen.getByText("Notice the feeling.").className).toContain(programsBody);
    cleanup();

    render(
      <ProgramsCallout
        block={{ type: "callout", text: "Loyalty is big.\n\n— Pat Summitt" }}
      />
    );
    expect(screen.getByText("Loyalty is big.").className).toContain(programsQuoteText);
    expect(programsQuoteText).not.toContain("brand");
    expect(screen.getByText("— Pat Summitt").className).toContain("text-[var(--brand)]");
  });

  it("keeps a prose paragraph off orange and a quiz marked with the accent rule", () => {
    render(<ProgramsProse text={"Have you ever read case law?"} />);
    expect(screen.getByText("Have you ever read case law?").className).toContain(programsBody);
    cleanup();

    const { container } = render(
      <ProgramsKnowledgeCheck
        block={{
          type: "quiz",
          minimum_correct: 1,
          questions: [
            {
              question_id: "q1",
              prompt: "Which habit comes first?",
              question_type: "single_choice",
              choices: [{ id: "a", text: "Sleep" }],
            },
          ],
        }}
        answers={{}}
        result={null}
        onToggleChoice={() => undefined}
      />
    );
    expect(container.querySelector("[aria-hidden='true']")?.className).toBe(programsAccentRule);
    expect(screen.getByText("Which habit comes first?").className).toContain(programsBody);
    expect(screen.getByText("Which habit comes first?").className).not.toContain("brand");
  });

  it("marks a concept list with an orange marker and keeps the words light", () => {
    const { container } = render(
      <ProgramsList
        block={{ type: "list", ordered: false, role: "concepts", items: ["Authentic trust"] }}
      />
    );
    expect(container.querySelector("ul")?.className).toContain("marker:text-[var(--brand)]");
    expect(screen.getByText("Authentic trust").className).not.toContain("brand");
  });

  it("keeps 37 programs and 336 steps", () => {
    const programs = listLearningCollections().flatMap((collection) => collection.miniPrograms);
    expect(programs).toHaveLength(37);
    expect(listLearningCollections()).toHaveLength(3);
    expect(
      programs.reduce((count, card) => count + (getLearningMiniProgram(card.id)?.steps.length ?? 0), 0)
    ).toBe(336);
  });
});
