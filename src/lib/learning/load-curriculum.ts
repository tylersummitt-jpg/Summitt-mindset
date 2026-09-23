import "server-only";

import { learningCurriculumRegistry } from "./curriculum-registry";
import type {
  LearningCollectionListing,
  LearningMiniProgram,
  LearningStep,
  PublicLearningBlock,
  PublicLearningMiniProgram,
  PublicLearningStep,
} from "./curriculum-types";

export type LearningStepLocation = {
  miniProgram: LearningMiniProgram;
  step: LearningStep;
};

function registryPrograms(): LearningMiniProgram[] {
  const seenPrograms = new Set<string>();
  const seenSteps = new Set<string>();
  const programs: LearningMiniProgram[] = [];

  for (const collection of learningCurriculumRegistry) {
    const ordered = [...collection.miniPrograms].sort(
      (left, right) => left.sequence - right.sequence
    );
    for (const program of ordered) {
      if (program.collection_id !== collection.id) {
        throw new Error(
          `Curriculum registry collection ${collection.id} does not match ${program.id}`
        );
      }
      if (program.collection_title !== collection.title) {
        throw new Error(
          `Curriculum registry title for ${program.id} does not match ${collection.title}`
        );
      }
      if (seenPrograms.has(program.id)) {
        throw new Error(`Duplicate mini-program id ${program.id}`);
      }
      seenPrograms.add(program.id);
      for (const step of program.steps) {
        if (seenSteps.has(step.id)) {
          throw new Error(`Duplicate step id ${step.id}`);
        }
        seenSteps.add(step.id);
      }
      programs.push(program);
    }
  }

  return programs;
}

const programs = registryPrograms();

export function listLearningCollections(): LearningCollectionListing[] {
  return learningCurriculumRegistry.map((collection) => ({
    id: collection.id,
    title: collection.title,
    miniPrograms: [...collection.miniPrograms]
      .sort((left, right) => left.sequence - right.sequence)
      .map((program) => ({
        id: program.id,
        title: program.title,
        description: program.description,
        sequence: program.sequence,
        estimated_minutes: program.estimated_minutes,
        source_mini_program_id: program.source_mini_program_id,
        curriculum_version: program.curriculum_version,
      })),
  }));
}

export function getLearningMiniProgram(id: string): LearningMiniProgram | null {
  return programs.find((program) => program.id === id) ?? null;
}

export function getLearningStep(
  miniProgramId: string,
  stepId: string
): LearningStep | null {
  const program = getLearningMiniProgram(miniProgramId);
  if (!program) return null;
  return program.steps.find((step) => step.id === stepId) ?? null;
}

export function getLearningStepById(stepId: string): LearningStepLocation | null {
  for (const program of programs) {
    const step = program.steps.find((candidate) => candidate.id === stepId);
    if (step) return { miniProgram: program, step };
  }
  return null;
}

export function toPublicLearningMiniProgram(
  program: LearningMiniProgram
): PublicLearningMiniProgram {
  return {
    ...program,
    steps: program.steps.map(toPublicLearningStep),
  };
}

export function toPublicLearningStep(step: LearningStep): PublicLearningStep {
  return {
    id: step.id,
    source_step_id: step.source_step_id,
    sequence: step.sequence,
    title: step.title,
    ...(step.group_label ? { group_label: step.group_label } : {}),
    blocks: step.blocks.map(toPublicBlock),
  };
}

export function getLearningMiniProgramForClient(
  id: string
): PublicLearningMiniProgram | null {
  const program = getLearningMiniProgram(id);
  return program ? toPublicLearningMiniProgram(program) : null;
}

export function getLearningStepForClient(
  miniProgramId: string,
  stepId: string
): PublicLearningStep | null {
  const step = getLearningStep(miniProgramId, stepId);
  return step ? toPublicLearningStep(step) : null;
}

function toPublicBlock(block: LearningStep["blocks"][number]): PublicLearningBlock {
  switch (block.type) {
    case "quiz":
      return {
        type: "quiz",
        minimum_correct: block.minimum_correct,
        questions: block.questions.map((question) => ({
          question_id: question.question_id,
          prompt: question.prompt,
          question_type: question.question_type,
          choices: question.choices.map((choice) => ({
            id: choice.id,
            text: choice.text,
          })),
        })),
      };
    case "sort":
      return {
        type: "sort",
        prompt: block.prompt,
        categories: [...block.categories],
        cards: block.cards.map((card) => ({
          id: card.id,
          text: card.text,
        })),
      };
    case "markdown":
    case "heading":
    case "list":
    case "table":
    case "callout":
    case "process":
    case "video":
    case "image":
    case "gallery":
    case "audio":
    case "flashcard":
    case "reflection":
    case "choice_prompt":
    case "sections":
      return block;
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}
