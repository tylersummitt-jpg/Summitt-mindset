import { describe, expect, it } from "vitest";
import { getLearningMiniProgram, listLearningCollections } from "./load-curriculum";
import type { LearningBlock, LearningMiniProgram, LearningStep } from "./curriculum-types";

function programs(): LearningMiniProgram[] {
  return listLearningCollections().flatMap((collection) =>
    collection.miniPrograms.map((card) => {
      const program = getLearningMiniProgram(card.id);
      if (!program) throw new Error(`missing ${card.id}`);
      return program;
    })
  );
}

function findStep(id: string): LearningStep {
  for (const program of programs()) {
    const step = program.steps.find((candidate) => candidate.id === id);
    if (step) return step;
  }
  throw new Error(`missing ${id}`);
}

function lists(step: LearningStep) {
  return step.blocks.filter((block): block is Extract<LearningBlock, { type: "list" }> => block.type === "list");
}

const CORRECTED_SORT_PROMPTS: Record<string, string> = {
  cw_mp_05_st_006:
    "You'll see one item at a time. Decide whether it belongs with “Avoid” or “Do.”",
  cw_mp_05_st_008:
    "You'll see one item at a time. Decide whether it belongs with “Microaggressions” or “Macroaggressions.”",
  potl_mp_04_st_004:
    "You'll see one item at a time. Decide whether it belongs with “Hands-off” or “Hands-on.”",
  potl_mp_04_st_005:
    "You'll see one item at a time. Decide whether it belongs with “Micromanaging” or “Macromanaging.”",
  potl_mp_06_st_004:
    "You'll see one item at a time. Decide whether it belongs with “Overcommunicating” or “Under-communicating.”",
  potl_mp_06_st_008:
    "You'll see one item at a time. Decide whether it belongs with “Setting People Up to Win” or “NOT Setting People Up to Win.”",
  potl_mp_08_st_003:
    "You'll see one item at a time. Decide whether it belongs with “Introverts” or “Extroverts.”",
  potl_mp_08_st_004:
    "You'll see one item at a time. Decide whether it belongs with “Thinkers” or “Feelers.”",
};

describe("respect manual-review patterns", () => {
  it("registers 37 mini-programs and 336 steps", () => {
    const all = programs();
    expect(all).toHaveLength(37);
    expect(all.reduce((count, program) => count + program.steps.length, 0)).toBe(336);
  });

  it("removes only the boss self-check", () => {
    const respect = findStep("dd_mp_02_st_003");
    expect(respect.blocks.some((block) => block.type === "choice_prompt")).toBe(false);
    expect(respect.blocks.some((block) => block.type === "sort")).toBe(true);
    const prompts = programs().flatMap((program) =>
      program.steps.flatMap((step) =>
        step.blocks
          .filter((block) => block.type === "choice_prompt")
          .map((block) => block.prompt)
      )
    );
    expect(prompts).toHaveLength(9);
    expect(prompts.some((prompt) => /want you as a boss/i.test(prompt))).toBe(false);
    expect(prompts).toContain(
      "Three women. Choose one to read her story."
    );
    expect(prompts.some((prompt) => prompt.startsWith("You could see anger in Pat's eyes"))).toBe(
      true
    );
  });

  it("uses real sort instructions and no stale source chrome", () => {
    const sorts = programs().flatMap((program) =>
      program.steps.flatMap((step) =>
        step.blocks.filter((block) => block.type === "sort").map((block) => ({
          stepId: step.id,
          prompt: block.prompt,
          categories: block.categories,
        }))
      )
    );
    expect(sorts).toHaveLength(23);
    for (const sort of sorts) {
      expect(sort.prompt).not.toMatch(/complete all interactive states/i);
      expect(sort.prompt.length).toBeGreaterThan(40);
      const step = findStep(sort.stepId);
      const cards = step.blocks.find((block) => block.type === "sort");
      if (cards?.type !== "sort") throw new Error(sort.stepId);
      expect(cards.cards.some((card) => card.text === sort.prompt)).toBe(false);
    }
    for (const [stepId, prompt] of Object.entries(CORRECTED_SORT_PROMPTS)) {
      expect(sorts.find((sort) => sort.stepId === stepId)?.prompt).toBe(prompt);
    }
  });

  it("drops exact duplicate lists and keeps the interaction plus unique lists", () => {
    const gone: Array<[string, string[]]> = [
      [
        "dd_mp_02_st_007",
        [
          "Keep moving",
          "Meet standing up",
          "Have a brain break each hour",
          "Go exercise",
          "Eat well",
          "Hydrate",
          "Sleep",
          "Remove technology from where you sleep",
        ],
      ],
      [
        "dd_mp_02_st_008",
        [
          "Minimize multitasking",
          "Leverage mornings",
          "Take distraction-free vacations",
          "Turn off notifications",
        ],
      ],
      [
        "dd_mp_02_st_009",
        ["Establish weekly and daily gratitude practice", "Unleash laughter", "Declare appreciation"],
      ],
      [
        "dd_mp_04_st_008",
        ["Understand Yourself", "Manage Yourself", "Understand Others", "Manage Relationships"],
      ],
      [
        "dd_mp_04_st_011",
        [
          "Own the conversation.",
          "Disarm the tension.",
          "Describe the situation factually, without emotion.",
          "Describe the impact.",
          "Ask for a response.",
          "Conclude and state your request.",
        ],
      ],
      [
        "dd_mp_05_st_013",
        ["Authenticity", "Relationships", "Nonverbal communication"],
      ],
      [
        "dd_mp_06_st_013",
        [
          "Setting a goal",
          "Creating a reward",
          "Leveraging that reward against the potential penalty, and",
          "Remaining consistent to that choice on a daily basis.",
        ],
      ],
      ["dd_mp_07_st_008", ["Career/Lifetime Goals", "Annual/Quarterly Goals", "Monthly/Weekly Goals"]],
      [
        "dd_mp_10_st_006",
        [
          "Make it personal.",
          "See every setback as an opportunity to learn.",
          "Expect the extraordinary.",
        ],
      ],
      [
        "dd_mp_11_st_003",
        [
          "Don't seek out weak competition. Compete against the best.",
          "Identify the rival.",
          "Keep your rival in sight to motivate you.",
          "Appreciate your rival.",
        ],
      ],
    ];
    for (const [stepId, items] of gone) {
      const step = findStep(stepId);
      expect(lists(step).some((list) => JSON.stringify(list.items) === JSON.stringify(items))).toBe(
        false
      );
      expect(
        step.blocks.some((block) => block.type === "sections" || block.type === "process")
      ).toBe(true);
    }

    const planning = lists(findStep("dd_mp_07_st_008"));
    expect(planning).toHaveLength(1);
    expect(planning[0]?.items).toHaveLength(6);
    expect(planning[0]?.items[3]).toMatch(/prioritized list of daily tasks/);
    expect(planning[0]?.role).toBeUndefined();

    const belief = findStep("dd_mp_10_st_006");
    expect(lists(belief).map((list) => list.items[0])).toEqual([
      "Envision the dream of what you want to accomplish.",
      "Dream",
    ]);
    expect(findStep("dd_mp_04_st_008").blocks.some((block) => block.type === "callout")).toBe(true);
    expect(findStep("dd_mp_04_st_011").blocks.some((block) => block.type === "callout")).toBe(true);
    expect(findStep("dd_mp_05_st_013").blocks.filter((block) => block.type === "image").length).toBeGreaterThan(0);
    expect(
      findStep("dd_mp_06_st_013").blocks.filter(
        (block) =>
          block.type === "markdown" && block.markdown.startsWith("Creating a disciplined environment")
      )
    ).toHaveLength(1);
  });

  it("removes only the seven redundant summary lead-ins", () => {
    const removed = [
      "To summarize, there are several important physical habits that can help you establish and build self-respect from within:",
      "To summarize, there are four important mental habits that can help you establish and build self-respect from within:",
      "To summarize, there are three important emotional habits that can help you establish and build self-respect from within:",
      "The three types of goals you reviewed are:",
      "Again, these three steps can help you as a leader when you face the negative forces of adversity:",
    ];
    const blob = JSON.stringify(programs());
    for (const line of removed) expect(blob).not.toContain(line);
    expect(findStep("dd_mp_06_st_013").blocks.some((block) => block.type === "heading" && block.text === "Summary")).toBe(
      false
    );
    expect(
      findStep("dd_mp_10_st_006").blocks.some((block) => block.type === "heading" && block.text === "Summary")
    ).toBe(false);
    expect(
      findStep("dd_mp_11_st_003").blocks.some((block) => block.type === "heading" && block.text === "Let's Summarize")
    ).toBe(false);

    expect(JSON.stringify(findStep("dd_mp_06_st_006"))).toContain("To summarize, two of the following behaviors");
    expect(JSON.stringify(findStep("dd_mp_07_st_003"))).toContain(
      "Let's summarize what you can do to make hard work your passion"
    );
    expect(
      findStep("dd_mp_11_st_013").blocks.some((block) => block.type === "heading" && block.text === "Let's Summarize")
    ).toBe(true);
    expect(
      findStep("cw_mp_04_st_004").blocks.some((block) => block.type === "heading" && block.text === "Summary")
    ).toBe(true);
    expect(JSON.stringify(findStep("cw_mp_13_st_005"))).toContain("In summary, as you build your tribe");
    expect(JSON.stringify(findStep("dd_mp_07_st_008"))).toContain(
      "Here is a summarized list of planning ideas"
    );
  });

  it("marks only the two named concept lists", () => {
    const conceptLists = programs().flatMap((program) =>
      program.steps.flatMap((step) =>
        lists(step)
          .filter((list) => list.role === "concepts")
          .map((list) => ({ stepId: step.id, items: list.items }))
      )
    );
    expect(conceptLists).toEqual([
      {
        stepId: "dd_mp_02_st_011",
        items: ["Authentic trust", "Healthy debate", "Commitment"],
      },
      {
        stepId: "dd_mp_10_st_006",
        items: ["Dream", "Believe", "Act"],
      },
    ]);
    const wordBank = lists(findStep("dd_mp_10_st_003")).find((list) => list.items.includes("positive"));
    expect(wordBank?.role).toBeUndefined();
    expect(lists(findStep("cw_mp_01_st_004")).every((list) => list.role == null)).toBe(true);
    expect(lists(findStep("dd_mp_11_st_013")).every((list) => list.role == null)).toBe(true);
    expect(lists(findStep("dd_mp_05_st_006")).every((list) => list.role == null)).toBe(true);
  });
});
