import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getLearningMiniProgram,
  getLearningMiniProgramForClient,
  listLearningCollections,
} from "./load-curriculum";
import { learningProgramEntryPath, resolveLearningRoute } from "./program-paths";
import { decideContinue } from "./step-access";

const ROOT = path.resolve(__dirname, "../../..");

const PROGRAM_IDS = [
  "dd_mp_02",
  "dd_mp_03",
  "dd_mp_04",
  "dd_mp_05",
  "dd_mp_06",
  "dd_mp_07",
  "dd_mp_08",
  "dd_mp_09",
  "dd_mp_10",
  "dd_mp_11",
  "dd_mp_12",
  "dd_mp_13",
] as const;

const VERIFIED_VIMEO: Record<string, string> = {
  dd_mp_02_st_006: "1150754357",
  dd_mp_02_st_011: "1150754332",
  dd_mp_02_st_014: "1150754397",
  dd_mp_05_st_006: "1150855840",
  dd_mp_10_st_006: "1150859511",
  dd_mp_10_st_011: "1150859446",
  dd_mp_11_st_006: "1150859998",
  dd_mp_11_st_008: "1150859987",
  dd_mp_11_st_011: "1150859951",
};

describe("Definite Dozen curriculum integrity", () => {
  it("registers principles 1–12 in source order with routes and independent ids", () => {
    const programs = listLearningCollections().flatMap((collection) => collection.miniPrograms);
    expect(programs.map((program) => program.id)).toEqual([...PROGRAM_IDS]);
    expect(programs.map((program) => program.sequence)).toEqual(
      PROGRAM_IDS.map((_, index) => index + 1)
    );

    for (const id of PROGRAM_IDS) {
      const program = getLearningMiniProgram(id);
      expect(program, id).toBeTruthy();
      if (!program) continue;
      expect(learningProgramEntryPath(id)).toMatch(/^\/programs\/definite-dozen\/[a-z0-9-]+$/);
      const slug = learningProgramEntryPath(id).split("/").at(-1) ?? "";
      expect(resolveLearningRoute("definite-dozen", slug)).toBe(id);

      const stepIds = program.steps.map((step) => step.id);
      expect(new Set(stepIds).size).toBe(stepIds.length);
      expect(program.steps.map((step) => step.sequence)).toEqual(
        program.steps.map((_, index) => index + 1)
      );
      expect(stepIds.every((stepId) => stepId.startsWith(`${id}_`))).toBe(true);

      const last = program.steps.at(-1);
      expect(last, id).toBeTruthy();
      if (!last) continue;
      expect(
        decideContinue(
          { status: "in_progress", current_step_id: last.id },
          program.steps,
          last.id
        )
      ).toEqual({ kind: "complete" });
      expect(
        decideContinue({ status: "completed", current_step_id: last.id }, program.steps, last.id)
      ).toEqual({ kind: "review-end" });
    }
  });

  it("keeps answer keys server-side and validates quizzes, sorts, reflections, and media", () => {
    const reflectionIds = new Set<string>();

    for (const id of PROGRAM_IDS) {
      const program = getLearningMiniProgram(id);
      const client = getLearningMiniProgramForClient(id);
      if (!program || !client) throw new Error(`missing ${id}`);
      const clientJson = JSON.stringify(client);
      expect(clientJson).not.toContain("correct_choice_ids");
      expect(clientJson).not.toContain("correct_category");
      expect(clientJson).not.toContain("data/learning/source");

      for (const step of program.steps) {
        if (step.group_label !== undefined) {
          expect(step.group_label.trim().length).toBeGreaterThan(0);
        }
        for (const block of step.blocks) {
          if (block.type === "quiz") {
            expect(block.minimum_correct).toBeGreaterThanOrEqual(1);
            expect(block.minimum_correct).toBeLessThanOrEqual(block.questions.length);
            for (const question of block.questions) {
              const choiceIds = new Set(question.choices.map((choice) => choice.id));
              expect(choiceIds.size).toBe(question.choices.length);
              expect(question.correct_choice_ids.length).toBeGreaterThan(0);
              expect(question.correct_choice_ids.every((choiceId) => choiceIds.has(choiceId))).toBe(
                true
              );
              if (question.question_type === "single_choice") {
                expect(question.correct_choice_ids).toHaveLength(1);
              }
            }
          }
          if (block.type === "sort") {
            const categories = new Set(block.categories);
            expect(categories.size).toBeGreaterThanOrEqual(2);
            const cardIds = new Set<string>();
            for (const card of block.cards) {
              expect(cardIds.has(card.id)).toBe(false);
              cardIds.add(card.id);
              expect(categories.has(card.correct_category)).toBe(true);
            }
          }
          if (block.type === "reflection") {
            expect(reflectionIds.has(block.question_id)).toBe(false);
            reflectionIds.add(block.question_id);
            expect(block.question_id.startsWith(`${step.id}_reflection_`)).toBe(true);
            expect(block.prompt.length).toBeGreaterThan(0);
            expect(block.prompt.length).toBeLessThanOrEqual(1000);
          }
          if (block.type === "image") {
            expect(block.src.startsWith("/learning/definite-dozen/")).toBe(true);
            expect(block.src).not.toContain("data/learning/source");
            expect(existsSync(path.join(ROOT, "public", block.src.slice(1)))).toBe(true);
          }
          if (block.type === "video" && block.vimeo_video_id) {
            expect(VERIFIED_VIMEO[step.id]).toBe(block.vimeo_video_id);
          }
        }
      }
    }

    for (const [stepId, vimeoId] of Object.entries(VERIFIED_VIMEO)) {
      const programId = stepId.slice(0, "dd_mp_00".length);
      const program = getLearningMiniProgram(programId);
      const step = program?.steps.find((item) => item.id === stepId);
      const video = step?.blocks.find((block) => block.type === "video");
      expect(video && video.type === "video" ? video.vimeo_video_id : null).toBe(vimeoId);
    }
  });
});
