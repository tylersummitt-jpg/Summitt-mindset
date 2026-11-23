import { describe, expect, it } from "vitest";
import { getLearningMiniProgram, listLearningCollections } from "./load-curriculum";
import { saveReflectionAnswer, type ReflectionDb, type LearningReflectionRow } from "./reflection-answers";
import { presentScenarioChoiceResponse } from "./scenario-feedback";

const BANNED = [
  /this response is not saved/i,
  /will not be saved or graded/i,
  /you might also save this response in your workbook/i,
  /unless otherwise noted,\s+all quotes taken from,?\s+reach for the summitt/i,
  /your answer:/i,
];

const SCALE = /1\s*-{8,}\s*5\s*-{8,}\s*10/;
const BLANK_SCALE = /on a scale of 1 to 10[\s\S]{0,400}_{6,}/i;

const PRESERVED_IMAGE_RUNS = [
  "cw_mp_03_st_006",
  "cw_mp_06_st_004",
  "potl_mp_08_st_007",
  "potl_mp_10_st_003",
];

function programs() {
  return listLearningCollections().flatMap((collection) =>
    collection.miniPrograms.map((card) => {
      const program = getLearningMiniProgram(card.id);
      if (!program) throw new Error(card.id);
      return program;
    })
  );
}

function blockText(block: { type: string } & Record<string, unknown>): string {
  if (block.type === "markdown" || block.type === "callout") return String(block.markdown ?? block.text ?? "");
  if (block.type === "heading") return String(block.text ?? "");
  if (block.type === "list") return ((block.items as string[]) ?? []).join("\n");
  if (block.type === "reflection") return String(block.prompt ?? "");
  if (block.type === "choice_prompt") {
    const choices = block.choices as Array<{ response: string }>;
    return `${block.prompt}\n${choices.map((choice) => choice.response).join("\n")}`;
  }
  if (block.type === "process") {
    const steps = block.steps as Array<{ title: string; body: string }>;
    return steps.map((step) => `${step.title}\n${step.body}`).join("\n");
  }
  if (block.type === "sections") {
    const sections = block.sections as Array<{ title: string; body: string }>;
    return sections.map((section) => `${section.title}\n${section.body}`).join("\n");
  }
  return "";
}

describe("Programs final sweep invariants", () => {
  const loaded = programs();

  it("keeps the registered runtime counts", () => {
    expect(listLearningCollections()).toHaveLength(3);
    expect(loaded).toHaveLength(37);
    expect(loaded.reduce((sum, program) => sum + program.steps.length, 0)).toBe(336);
  });

  it("persists every reflection with a stable id and drops legacy not-saved copy", () => {
    const ids = new Set<string>();
    let reflections = 0;
    for (const program of loaded) {
      for (const step of program.steps) {
        for (const block of step.blocks) {
          const text = blockText(block as { type: string } & Record<string, unknown>);
          for (const pattern of BANNED) expect(text).not.toMatch(pattern);
          if (block.type === "markdown" || block.type === "callout") {
            expect(text).not.toMatch(SCALE);
            expect(text).not.toMatch(BLANK_SCALE);
          }
          if (block.type !== "reflection") continue;
          reflections += 1;
          expect(block.persist).not.toBe(false);
          expect(block.confirmation).toBeUndefined();
          expect(block.prompt.trim().length).toBeGreaterThan(0);
          expect(block.prompt.length).toBeLessThanOrEqual(1000);
          expect(block.question_id.startsWith(`${step.id}_reflection_`)).toBe(true);
          expect(ids.has(block.question_id)).toBe(false);
          ids.add(block.question_id);
        }
      }
    }
    expect(reflections).toBe(265);
  });

  it("converts the prose reflection steps onto the shared reflection block", () => {
    const expected: Record<string, number> = {
      dd_mp_08_st_005: 2,
      dd_mp_08_st_010: 2,
      dd_mp_08_st_015: 1,
      dd_mp_09_st_005: 3,
      dd_mp_09_st_010: 2,
      dd_mp_09_st_015: 3,
      dd_mp_10_st_005: 1,
      dd_mp_10_st_010: 1,
      dd_mp_10_st_015: 1,
      dd_mp_11_st_005: 1,
      dd_mp_13_st_005: 1,
    };
    for (const [stepId, count] of Object.entries(expected)) {
      const program = loaded.find((item) => item.id === stepId.slice(0, "dd_mp_00".length));
      const step = program?.steps.find((item) => item.id === stepId);
      const reflections = step?.blocks.filter((block) => block.type === "reflection") ?? [];
      expect(reflections, stepId).toHaveLength(count);
      if (stepId.startsWith("dd_mp_09_st_")) {
        expect(reflections.every((block) => block.type === "reflection" && block.prompt_role === "accent")).toBe(
          true
        );
      }
    }
  });

  it("uses the simplified graded scenario formula", () => {
    const scenarioSteps = new Set<string>();
    for (const program of loaded) {
      for (const step of program.steps) {
        for (const block of step.blocks) {
          if (block.type !== "choice_prompt") continue;
          const graded = block.choices.some((choice) =>
            /^(Correct!|Correct\.|Incorrect\. Correct answer:)/.test(choice.response)
          );
          if (!graded) continue;
          scenarioSteps.add(step.id);
          for (const choice of block.choices) {
            expect(choice.response).not.toMatch(/your answer:/i);
            if (choice.response.startsWith("Correct!")) {
              expect(choice.response === "Correct!" || choice.response.startsWith("Correct!\n\n")).toBe(true);
            }
            if (choice.response.startsWith("Incorrect.")) {
              expect(choice.response).toMatch(/^Incorrect\. Correct answer: .+\./);
            }
          }
        }
      }
    }
    expect([...scenarioSteps].sort()).toEqual([
      "dd_mp_07_st_008",
      "dd_mp_08_st_008",
      "dd_mp_08_st_011",
      "dd_mp_08_st_013",
      "dd_mp_09_st_003",
    ]);
  });

  it("leaves only explained POT and CW image runs", () => {
    const runs: string[] = [];
    for (const program of loaded) {
      if (program.collection_id === "definite_dozen") continue;
      for (const step of program.steps) {
        let count = 0;
        const found: number[] = [];
        for (const block of step.blocks) {
          if (block.type === "image") count += 1;
          else {
            if (count >= 2) found.push(count);
            count = 0;
          }
        }
        if (count >= 2) found.push(count);
        if (found.length) runs.push(step.id);
      }
    }
    expect(runs.sort()).toEqual([...PRESERVED_IMAGE_RUNS].sort());
    const two = getLearningMiniProgram("cw_mp_03")?.steps.find((step) => step.id === "cw_mp_03_st_002");
    const four = getLearningMiniProgram("cw_mp_03")?.steps.find((step) => step.id === "cw_mp_03_st_004");
    expect(two?.blocks.filter((block) => block.type === "image")).toHaveLength(1);
    expect(four?.blocks.filter((block) => block.type === "image")).toHaveLength(1);
  });

  it("stores one current reflection row with the question snapshot and both timestamps", async () => {
    const rows: LearningReflectionRow[] = [];
    const db: ReflectionDb = {
      async listForStep() {
        return { data: rows, error: null };
      },
      async upsert(input) {
        const existing = rows.find(
          (row) =>
            row.clerk_user_id === input.clerkUserId &&
            row.mini_program_id === input.miniProgramId &&
            row.question_id === input.questionId
        );
        if (existing) {
          existing.answer_text = input.answerText;
          existing.question_text = input.questionText;
          existing.updated_at = input.updatedAt;
          return { data: { ...existing }, error: null };
        }
        const created: LearningReflectionRow = {
          id: "row-1",
          clerk_user_id: input.clerkUserId,
          mini_program_id: input.miniProgramId,
          step_id: input.stepId,
          question_id: input.questionId,
          question_text: input.questionText,
          answer_text: input.answerText,
          created_at: input.updatedAt,
          updated_at: input.updatedAt,
        };
        rows.push(created);
        return { data: { ...created }, error: null };
      },
    };
    const first = await saveReflectionAnswer(db, {
      memberId: "member",
      miniProgramId: "dd_mp_09",
      stepId: "dd_mp_09_st_005",
      questionId: "dd_mp_09_st_005_reflection_01",
      questionText: "How did it make you feel?",
      answerText: "Hopeful",
      now: "2026-01-01T00:00:00.000Z",
    });
    const second = await saveReflectionAnswer(db, {
      memberId: "member",
      miniProgramId: "dd_mp_09",
      stepId: "dd_mp_09_st_005",
      questionId: "dd_mp_09_st_005_reflection_01",
      questionText: "How did it make you feel?",
      answerText: "Still hopeful, and more specific",
      now: "2026-02-01T00:00:00.000Z",
    });
    expect(first.ok && second.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      question_text: "How did it make you feel?",
      answer_text: "Still hopeful, and more specific",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    });
  });

  it("strips a leftover graded Your answer line", () => {
    expect(
      presentScenarioChoiceResponse(
        "Incorrect. Correct answer: Team members have occasional conflicts. Your answer: Team members never have conflicts."
      )
    ).toBe("Incorrect. Correct answer: Team members have occasional conflicts.");
    expect(
      presentScenarioChoiceResponse(
        "Correct. Correct answer: Team members have occasional conflicts. Your answer: Team members have occasional conflicts."
      )
    ).toBe("Correct!");
    expect(presentScenarioChoiceResponse("Pat talked to Tyler.")).toBe("Pat talked to Tyler.");
  });
});
