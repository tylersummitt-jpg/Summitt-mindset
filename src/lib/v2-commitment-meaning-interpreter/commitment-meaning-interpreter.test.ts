import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => mockCreate(...args),
      },
    };
  },
}));

import { interpretCommitmentMeaningFromUserText } from "@/lib/v2-commitment-meaning-interpreter/commitment-meaning-interpreter";

describe("interpretCommitmentMeaningFromUserText", () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...env, OPENAI_API_KEY: "test" };
  });

  it("does not accept duration-only bar when user text is richer (distribution + hours)", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              interpreted_daily_bar: "2 hours",
              confidence: 0.95,
              needs_clarification: false,
              clarification_question: null,
            }),
          },
        },
      ],
    });

    const r = await interpretCommitmentMeaningFromUserText({
      rawUserText: "Work on distribution for 2 hours",
      pendingKind: "commitment_replace",
      currentBarSummary: null,
      promptVersion: "v1_phase1",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.interpreted_daily_bar).toBeNull();
      expect(r.needs_clarification).toBe(true);
      expect(r.clarification_question?.length).toBeGreaterThan(5);
    }
  });

  it('"Run" alone yields clarification when model marks vague', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              interpreted_daily_bar: null,
              confidence: 0.2,
              needs_clarification: true,
              clarification_question: "What does a win look like tomorrow—minutes, distance, or time?",
            }),
          },
        },
      ],
    });

    const r = await interpretCommitmentMeaningFromUserText({
      rawUserText: "Run",
      pendingKind: "commitment_replace",
      currentBarSummary: "Walk 20 minutes",
      promptVersion: "v1_phase1",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.needs_clarification).toBe(true);
      expect(r.clarification_question).toBeTruthy();
    }
  });

  it('"Get healthier" asks clarification', async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              interpreted_daily_bar: null,
              confidence: 0.15,
              needs_clarification: true,
              clarification_question: "Pick one concrete action for tomorrow—what exactly?",
            }),
          },
        },
      ],
    });

    const r = await interpretCommitmentMeaningFromUserText({
      rawUserText: "Get healthier",
      pendingKind: "commitment_replace",
      currentBarSummary: null,
      promptVersion: "v1_phase1",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.needs_clarification).toBe(true);
    }
  });
});
