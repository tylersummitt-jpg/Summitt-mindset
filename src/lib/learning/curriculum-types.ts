/**
 * Curated Programs curriculum. Server-side documents may contain answer keys.
 * Client payloads use the Public* types, which omit those keys.
 *
 * Step ids and mini-program ids are the archive ids (`dd_mp_02`, `dd_mp_02_st_001`).
 * Those ids are the future progress keys and must not be replaced with a second scheme.
 */

export const LEARNING_BLOCK_TYPES = [
  "markdown",
  "heading",
  "list",
  "table",
  "callout",
  "process",
  "video",
  "image",
  "gallery",
  "audio",
  "flashcard",
  "quiz",
  "reflection",
  "choice_prompt",
  "sort",
  "sections",
] as const;

export type LearningBlockType = (typeof LEARNING_BLOCK_TYPES)[number];

export type LearningQuizQuestionType = "single_choice" | "multiple_choice";

export type LearningChoice = {
  id: string;
  text: string;
};

export type LearningQuizQuestion = {
  question_id: string;
  prompt: string;
  question_type: LearningQuizQuestionType;
  choices: LearningChoice[];
  correct_choice_ids: string[];
};

export type LearningMarkdownBlock = {
  type: "markdown";
  markdown: string;
  /** Hide this block until the named reflection is submitted or the quiz is graded. */
  reveal_after?: string;
};

export type LearningHeadingBlock = {
  type: "heading";
  level: 2 | 3;
  text: string;
  reveal_after?: string;
};

export type LearningListBlock = {
  type: "list";
  ordered: boolean;
  items: string[];
  /** Named principles, stages, or pillars. Ordinary lists omit this. */
  role?: "concepts";
  reveal_after?: string;
};

export type LearningTableBlock = {
  type: "table";
  caption?: string;
  headers: string[];
  rows: string[][];
};

export type LearningCalloutBlock = {
  type: "callout";
  text: string;
  reveal_after?: string;
};

export type LearningProcessStep = {
  title: string;
  body: string;
};

export type LearningProcessBlock = {
  type: "process";
  steps: LearningProcessStep[];
};

export type LearningVideoBlock = {
  type: "video";
  vimeo_video_id: string | null;
  visible_title: string;
  speaker: string;
};

export type LearningImageBlock = {
  type: "image";
  src: string;
  alt: string;
  quote?: string;
  attribution?: string;
  role?: "completion";
  reveal_after?: string;
};

export type LearningGalleryImage = {
  src: string;
  alt: string;
};

export type LearningGalleryBlock = {
  type: "gallery";
  label: string;
  images: LearningGalleryImage[];
};

export type LearningAudioBlock = {
  type: "audio";
  src: string;
  label: string;
  transcript: string;
};

export type LearningFlashcard = {
  id: string;
  front: string;
  back: string;
};

export type LearningFlashcardBlock = {
  type: "flashcard";
  cards: LearningFlashcard[];
};

export type LearningQuizBlock = {
  type: "quiz";
  minimum_correct: number;
  questions: LearningQuizQuestion[];
};

export type LearningReflectionBlock = {
  type: "reflection";
  question_id: string;
  prompt: string;
  /** False when the source says the response is not saved. Omitted means persisted. */
  persist?: boolean;
  /** Shown after a non-persisted response is submitted. Not stored. */
  confirmation?: string;
  /** Hide until the named reflection is submitted or the quiz is graded. */
  reveal_after?: string;
};

export type LearningChoicePromptBlock = {
  type: "choice_prompt";
  prompt: string;
  choices: Array<{
    id: string;
    label: string;
    response: string;
    image?: { src: string; alt: string };
  }>;
};

export type LearningSortCard = {
  id: string;
  text: string;
  correct_category: string;
};

export type LearningSortBlock = {
  type: "sort";
  prompt: string;
  categories: string[];
  cards: LearningSortCard[];
};

export type LearningSection = {
  id: string;
  title: string;
  body: string;
};

export type LearningSectionsBlock = {
  type: "sections";
  sections: LearningSection[];
};

export type LearningBlock =
  | LearningMarkdownBlock
  | LearningHeadingBlock
  | LearningListBlock
  | LearningTableBlock
  | LearningCalloutBlock
  | LearningProcessBlock
  | LearningVideoBlock
  | LearningImageBlock
  | LearningGalleryBlock
  | LearningAudioBlock
  | LearningFlashcardBlock
  | LearningQuizBlock
  | LearningReflectionBlock
  | LearningChoicePromptBlock
  | LearningSortBlock
  | LearningSectionsBlock;

export type LearningStep = {
  id: string;
  source_step_id: string;
  sequence: number;
  title: string;
  group_label?: string;
  blocks: LearningBlock[];
};

export type LearningMiniProgram = {
  id: string;
  collection_id: string;
  collection_title: string;
  title: string;
  description: string;
  sequence: number;
  estimated_minutes: number;
  source_mini_program_id: string;
  curriculum_version: number;
  steps: LearningStep[];
};

export type PublicQuizQuestion = Omit<LearningQuizQuestion, "correct_choice_ids">;

export type PublicQuizBlock = {
  type: "quiz";
  minimum_correct: number;
  questions: PublicQuizQuestion[];
};

export type PublicSortCard = Omit<LearningSortCard, "correct_category">;

export type PublicSortBlock = {
  type: "sort";
  prompt: string;
  categories: string[];
  cards: PublicSortCard[];
};

export type PublicLearningBlock =
  | LearningMarkdownBlock
  | LearningHeadingBlock
  | LearningListBlock
  | LearningTableBlock
  | LearningCalloutBlock
  | LearningProcessBlock
  | LearningVideoBlock
  | LearningImageBlock
  | LearningGalleryBlock
  | LearningAudioBlock
  | LearningFlashcardBlock
  | PublicQuizBlock
  | LearningReflectionBlock
  | LearningChoicePromptBlock
  | PublicSortBlock
  | LearningSectionsBlock;

export type PublicLearningStep = Omit<LearningStep, "blocks"> & {
  blocks: PublicLearningBlock[];
};

export type PublicLearningMiniProgram = Omit<LearningMiniProgram, "steps"> & {
  steps: PublicLearningStep[];
};

export type LearningMiniProgramCard = Pick<
  LearningMiniProgram,
  | "id"
  | "title"
  | "description"
  | "sequence"
  | "estimated_minutes"
  | "source_mini_program_id"
  | "curriculum_version"
>;

export type LearningCollectionListing = {
  id: string;
  title: string;
  miniPrograms: LearningMiniProgramCard[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid curriculum: ${label} must be a non-empty string`);
  }
  return value;
}

function requireStringOrNull(value: unknown, label: string): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value == null || value === "") return undefined;
  return requireString(value, label);
}

function revealField(value: Record<string, unknown>, label: string): { reveal_after?: string } {
  const revealAfter = optionalString(value.reveal_after, `${label}.reveal_after`);
  return revealAfter ? { reveal_after: revealAfter } : {};
}

function curatedPublicSrc(src: string, label: string): string {
  const blockedArchive = ["data", "learning", "source"].join("/");
  if (!src.startsWith("/") || src.includes(blockedArchive)) {
    throw new Error(`Invalid curriculum: ${label} must be a curated public path`);
  }
  return src;
}

export function parseLearningMiniProgram(value: unknown): LearningMiniProgram {
  if (!isRecord(value)) {
    throw new Error("Invalid curriculum: mini-program must be an object");
  }
  const stepsRaw = value.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    throw new Error("Invalid curriculum: steps must be a non-empty array");
  }

  const stepIds = new Set<string>();
  const questionIds = new Set<string>();
  const steps = stepsRaw.map((stepValue, index) => {
    if (!isRecord(stepValue)) {
      throw new Error(`Invalid curriculum: step ${index} must be an object`);
    }
    const id = requireString(stepValue.id, `steps[${index}].id`);
    const sourceStepId = requireString(
      stepValue.source_step_id,
      `steps[${index}].source_step_id`
    );
    if (stepIds.has(id)) {
      throw new Error(`Invalid curriculum: duplicate step id ${id}`);
    }
    stepIds.add(id);
    if (stepValue.sequence !== index + 1) {
      throw new Error(
        `Invalid curriculum: ${id} sequence must be ${index + 1}`
      );
    }
    if (!Array.isArray(stepValue.blocks) || stepValue.blocks.length === 0) {
      throw new Error(`Invalid curriculum: ${id} needs blocks`);
    }
    return {
      id,
      source_step_id: sourceStepId,
      sequence: index + 1,
      title: requireString(stepValue.title, `${id}.title`),
      ...(optionalString(stepValue.group_label, `${id}.group_label`)
        ? { group_label: optionalString(stepValue.group_label, `${id}.group_label`) }
        : {}),
      blocks: stepValue.blocks.map((block, blockIndex) =>
        parseBlock(block, `${id}.blocks[${blockIndex}]`, questionIds)
      ),
    } satisfies LearningStep;
  });

  const sequence = value.sequence;
  const estimated = value.estimated_minutes;
  const version = value.curriculum_version;
  if (typeof sequence !== "number" || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Invalid curriculum: sequence must be a positive integer");
  }
  if (
    typeof estimated !== "number" ||
    !Number.isInteger(estimated) ||
    estimated < 1
  ) {
    throw new Error("Invalid curriculum: estimated_minutes must be a positive integer");
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("Invalid curriculum: curriculum_version must be a positive integer");
  }

  return {
    id: requireString(value.id, "id"),
    collection_id: requireString(value.collection_id, "collection_id"),
    collection_title: requireString(value.collection_title, "collection_title"),
    title: requireString(value.title, "title"),
    description: requireString(value.description, "description"),
    sequence,
    estimated_minutes: estimated,
    source_mini_program_id: requireString(
      value.source_mini_program_id,
      "source_mini_program_id"
    ),
    curriculum_version: version,
    steps,
  };
}

function parseBlock(
  value: unknown,
  label: string,
  questionIds: Set<string>
): LearningBlock {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new Error(`Invalid curriculum: ${label} must be a block`);
  }
  switch (value.type) {
    case "markdown":
      return {
        type: "markdown",
        markdown: requireString(value.markdown, `${label}.markdown`),
        ...revealField(value, label),
      };
    case "heading": {
      const level = value.level;
      if (level !== 2 && level !== 3) {
        throw new Error(`Invalid curriculum: ${label}.level`);
      }
      return {
        type: "heading",
        level,
        text: requireString(value.text, `${label}.text`),
        ...revealField(value, label),
      };
    }
    case "list": {
      if (!Array.isArray(value.items) || value.items.length === 0) {
        throw new Error(`Invalid curriculum: ${label}.items`);
      }
      if (value.role != null && value.role !== "concepts") {
        throw new Error(`Invalid curriculum: ${label}.role`);
      }
      return {
        type: "list",
        ordered: value.ordered === true,
        ...(value.role === "concepts" ? { role: "concepts" as const } : {}),
        items: value.items.map((item, index) => requireString(item, `${label}.items[${index}]`)),
        ...revealField(value, label),
      };
    }
    case "table": {
      if (!Array.isArray(value.headers) || value.headers.length === 0) {
        throw new Error(`Invalid curriculum: ${label}.headers`);
      }
      const headers = value.headers.map((header, index) =>
        requireString(header, `${label}.headers[${index}]`)
      );
      if (!Array.isArray(value.rows) || value.rows.length === 0) {
        throw new Error(`Invalid curriculum: ${label}.rows`);
      }
      const rows = value.rows.map((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== headers.length) {
          throw new Error(`Invalid curriculum: ${label}.rows[${rowIndex}]`);
        }
        return row.map((cell, cellIndex) => {
          if (typeof cell !== "string") {
            throw new Error(`Invalid curriculum: ${label}.rows[${rowIndex}][${cellIndex}]`);
          }
          return cell;
        });
      });
      const caption = optionalString(value.caption, `${label}.caption`);
      return {
        type: "table",
        ...(caption ? { caption } : {}),
        headers,
        rows,
      };
    }
    case "callout":
      return {
        type: "callout",
        text: requireString(value.text, `${label}.text`),
        ...revealField(value, label),
      };
    case "process": {
      if (!Array.isArray(value.steps) || value.steps.length === 0) {
        throw new Error(`Invalid curriculum: ${label}.steps`);
      }
      return {
        type: "process",
        steps: value.steps.map((stepValue, index) => {
          if (!isRecord(stepValue)) {
            throw new Error(`Invalid curriculum: ${label}.steps[${index}]`);
          }
          return {
            title: requireString(stepValue.title, `${label}.steps[${index}].title`),
            body: requireString(stepValue.body, `${label}.steps[${index}].body`),
          };
        }),
      };
    }
    case "video": {
      const vimeo = requireStringOrNull(value.vimeo_video_id, `${label}.vimeo_video_id`);
      if (vimeo !== null && !/^\d+$/.test(vimeo)) {
        throw new Error(`Invalid curriculum: ${label}.vimeo_video_id must be numeric or null`);
      }
      return {
        type: "video",
        vimeo_video_id: vimeo,
        visible_title: requireString(value.visible_title, `${label}.visible_title`),
        speaker: requireString(value.speaker, `${label}.speaker`),
      };
    }
    case "image": {
      const src = requireString(value.src, `${label}.src`);
      if (typeof value.alt !== "string") {
        throw new Error(`Invalid curriculum: ${label}.alt must be a string`);
      }
      curatedPublicSrc(src, `${label}.src`);
      const quote = optionalString(value.quote, `${label}.quote`);
      const attribution = optionalString(value.attribution, `${label}.attribution`);
      const role = optionalString(value.role, `${label}.role`);
      if (role && role !== "completion") {
        throw new Error(`Invalid curriculum: ${label}.role`);
      }
      return {
        type: "image",
        src,
        alt: value.alt,
        ...(quote ? { quote } : {}),
        ...(attribution ? { attribution } : {}),
        ...(role === "completion" ? { role: "completion" as const } : {}),
        ...revealField(value, label),
      };
    }
    case "gallery":
      return parseGallery(value, label);
    case "audio":
      return parseAudio(value, label);
    case "flashcard":
      return parseFlashcards(value, label);
    case "quiz":
      return parseQuiz(value, label, questionIds);
    case "reflection": {
      const questionId = requireString(value.question_id, `${label}.question_id`);
      if (questionIds.has(questionId)) {
        throw new Error(`Invalid curriculum: duplicate question id ${questionId}`);
      }
      questionIds.add(questionId);
      if (value.persist != null && typeof value.persist !== "boolean") {
        throw new Error(`Invalid curriculum: ${label}.persist`);
      }
      const confirmation = optionalString(value.confirmation, `${label}.confirmation`);
      if (confirmation && value.persist !== false) {
        throw new Error(`Invalid curriculum: ${label}.confirmation requires persist false`);
      }
      return {
        type: "reflection",
        question_id: questionId,
        prompt: requireString(value.prompt, `${label}.prompt`),
        ...(value.persist === false ? { persist: false as const } : {}),
        ...(confirmation ? { confirmation } : {}),
        ...revealField(value, label),
      };
    }
    case "choice_prompt":
      return parseChoicePrompt(value, label);
    case "sort":
      return parseSort(value, label);
    case "sections":
      return parseSections(value, label);
    default:
      throw new Error(`Invalid curriculum: unknown block type ${value.type}`);
  }
}

function parseQuiz(
  value: Record<string, unknown>,
  label: string,
  questionIds: Set<string>
): LearningQuizBlock {
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    throw new Error(`Invalid curriculum: ${label} needs questions`);
  }
  const questions = value.questions.map((questionValue, index) => {
    if (!isRecord(questionValue)) {
      throw new Error(`Invalid curriculum: ${label}.questions[${index}]`);
    }
    const questionId = requireString(
      questionValue.question_id,
      `${label}.questions[${index}].question_id`
    );
    if (questionIds.has(questionId)) {
      throw new Error(`Invalid curriculum: duplicate question id ${questionId}`);
    }
    questionIds.add(questionId);
    const questionType = questionValue.question_type;
    if (questionType !== "single_choice" && questionType !== "multiple_choice") {
      throw new Error(`Invalid curriculum: ${questionId} question_type`);
    }
    if (!Array.isArray(questionValue.choices) || questionValue.choices.length < 2) {
      throw new Error(`Invalid curriculum: ${questionId} needs choices`);
    }
    const choices = questionValue.choices.map((choiceValue, choiceIndex) => {
      if (!isRecord(choiceValue)) {
        throw new Error(`Invalid curriculum: ${questionId} choice ${choiceIndex}`);
      }
      if ("is_correct" in choiceValue) {
        throw new Error(
          `Invalid curriculum: ${questionId} must not store is_correct on choices`
        );
      }
      return {
        id: requireString(choiceValue.id, `${questionId} choice id`),
        text: requireString(choiceValue.text, `${questionId} choice text`),
      };
    });
    const choiceIds = new Set(choices.map((choice) => choice.id));
    if (choiceIds.size !== choices.length) {
      throw new Error(`Invalid curriculum: ${questionId} has duplicate choice ids`);
    }
    if (!Array.isArray(questionValue.correct_choice_ids)) {
      throw new Error(`Invalid curriculum: ${questionId} correct_choice_ids`);
    }
    const correct = questionValue.correct_choice_ids.map((id) =>
      requireString(id, `${questionId} correct id`)
    );
    if (correct.length === 0 || correct.some((id) => !choiceIds.has(id))) {
      throw new Error(`Invalid curriculum: ${questionId} answer key does not match choices`);
    }
    if (questionType === "single_choice" && correct.length !== 1) {
      throw new Error(`Invalid curriculum: ${questionId} single_choice needs one answer`);
    }
    return {
      question_id: questionId,
      prompt: requireString(questionValue.prompt, `${questionId} prompt`),
      question_type: questionType,
      choices,
      correct_choice_ids: correct,
    } satisfies LearningQuizQuestion;
  });
  const minimum = value.minimum_correct;
  if (
    typeof minimum !== "number" ||
    !Number.isInteger(minimum) ||
    minimum < 1 ||
    minimum > questions.length
  ) {
    throw new Error(`Invalid curriculum: ${label}.minimum_correct`);
  }
  return { type: "quiz", minimum_correct: minimum, questions };
}

function parseChoicePrompt(
  value: Record<string, unknown>,
  label: string
): LearningChoicePromptBlock {
  if (!Array.isArray(value.choices) || value.choices.length < 2) {
    throw new Error(`Invalid curriculum: ${label} needs choices`);
  }
  return {
    type: "choice_prompt",
    prompt: requireString(value.prompt, `${label}.prompt`),
    choices: value.choices.map((choiceValue, index) => {
      if (!isRecord(choiceValue)) {
        throw new Error(`Invalid curriculum: ${label} choice ${index}`);
      }
      const image = isRecord(choiceValue.image) ? choiceValue.image : null;
      const imageSrc = image ? requireString(image.src, `${label} choice image src`) : "";
      if (imageSrc) curatedPublicSrc(imageSrc, `${label} choice image src`);
      return {
        id: requireString(choiceValue.id, `${label} choice id`),
        label: requireString(choiceValue.label, `${label} choice label`),
        response: requireString(choiceValue.response, `${label} choice response`),
        ...(imageSrc
          ? {
              image: {
                src: imageSrc,
                alt: requireString(image?.alt, `${label} choice image alt`),
              },
            }
          : {}),
      };
    }),
  };
}

function parseSort(value: Record<string, unknown>, label: string): LearningSortBlock {
  if (!Array.isArray(value.categories) || value.categories.length < 2) {
    throw new Error(`Invalid curriculum: ${label} needs categories`);
  }
  const categories = value.categories.map((category, index) =>
    requireString(category, `${label}.categories[${index}]`)
  );
  if (!Array.isArray(value.cards) || value.cards.length < 2) {
    throw new Error(`Invalid curriculum: ${label} needs cards`);
  }
  const cards = value.cards.map((cardValue, index) => {
    if (!isRecord(cardValue)) {
      throw new Error(`Invalid curriculum: ${label} card ${index}`);
    }
    const correct = requireString(
      cardValue.correct_category,
      `${label} card correct_category`
    );
    if (!categories.includes(correct)) {
      throw new Error(`Invalid curriculum: ${label} card category is not listed`);
    }
    return {
      id: requireString(cardValue.id, `${label} card id`),
      text: requireString(cardValue.text, `${label} card text`),
      correct_category: correct,
    };
  });
  return {
    type: "sort",
    prompt: requireString(value.prompt, `${label}.prompt`),
    categories,
    cards,
  };
}

function parseGallery(value: Record<string, unknown>, label: string): LearningGalleryBlock {
  if (!Array.isArray(value.images) || value.images.length < 2) {
    throw new Error(`Invalid curriculum: ${label} needs images`);
  }
  return {
    type: "gallery",
    label: requireString(value.label, `${label}.label`),
    images: value.images.map((imageValue, index) => {
      if (!isRecord(imageValue)) {
        throw new Error(`Invalid curriculum: ${label}.images[${index}]`);
      }
      const src = requireString(imageValue.src, `${label}.images[${index}].src`);
      curatedPublicSrc(src, `${label}.images[${index}].src`);
      if (typeof imageValue.alt !== "string") {
        throw new Error(`Invalid curriculum: ${label}.images[${index}].alt must be a string`);
      }
      return { src, alt: imageValue.alt };
    }),
  };
}

function parseAudio(value: Record<string, unknown>, label: string): LearningAudioBlock {
  const src = requireString(value.src, `${label}.src`);
  curatedPublicSrc(src, `${label}.src`);
  if (!src.endsWith(".mp3")) {
    throw new Error(`Invalid curriculum: ${label}.src must be an mp3`);
  }
  return {
    type: "audio",
    src,
    label: requireString(value.label, `${label}.label`),
    transcript: requireString(value.transcript, `${label}.transcript`),
  };
}

function parseFlashcards(value: Record<string, unknown>, label: string): LearningFlashcardBlock {
  if (!Array.isArray(value.cards) || value.cards.length === 0) {
    throw new Error(`Invalid curriculum: ${label} needs cards`);
  }
  const cards = value.cards.map((cardValue, index) => {
    if (!isRecord(cardValue)) {
      throw new Error(`Invalid curriculum: ${label}.cards[${index}]`);
    }
    return {
      id: requireString(cardValue.id, `${label}.cards[${index}].id`),
      front: requireString(cardValue.front, `${label}.cards[${index}].front`),
      back: requireString(cardValue.back, `${label}.cards[${index}].back`),
    };
  });
  const ids = new Set(cards.map((card) => card.id));
  if (ids.size !== cards.length) {
    throw new Error(`Invalid curriculum: ${label} has duplicate flashcard ids`);
  }
  return { type: "flashcard", cards };
}

function parseSections(
  value: Record<string, unknown>,
  label: string
): LearningSectionsBlock {
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    throw new Error(`Invalid curriculum: ${label} needs sections`);
  }
  return {
    type: "sections",
    sections: value.sections.map((sectionValue, index) => {
      if (!isRecord(sectionValue)) {
        throw new Error(`Invalid curriculum: ${label} section ${index}`);
      }
      return {
        id: requireString(sectionValue.id, `${label} section id`),
        title: requireString(sectionValue.title, `${label} section title`),
        body: requireString(sectionValue.body, `${label} section body`),
      };
    }),
  };
}
