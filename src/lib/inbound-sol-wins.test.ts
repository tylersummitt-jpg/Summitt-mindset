import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

vi.mock("@/lib/victory-media/correlate-inbound-mms-c1", () => ({
  scheduleC1IfWinsDurable: vi.fn(),
}));

const persistInboundWinsWithAccountability = vi.hoisted(() => vi.fn());
const persistRecognizedWins = vi.hoisted(() => vi.fn());

vi.mock("@/lib/v2-win-persist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2-win-persist")>();
  return {
    ...actual,
    persistInboundWinsWithAccountability,
    persistRecognizedWins,
  };
});

import { mergeInboundWinsForPersistence } from "@/lib/v2-win-accountability-merge";
import {
  buildSolInboundWinPlanInput,
  persistSolInboundWins,
  solWinDisplayTitleOverrides,
} from "@/lib/inbound-sol-wins";
import {
  EMPTY_INBOUND_SOL_WIN_PRESENTATION,
  type InboundSolBriefExtras,
} from "@/lib/inbound-sol-coaching-brief";

const completed: InboundSolBriefExtras = {
  answer_priority: "normal",
  coaching_after_answer: "no",
  user_is_correcting_coach: false,
  accountability_interpretation: {
    relevance: "central",
    outcome: "completed",
    confidence: "high",
    evidence: "I completed my lift.",
  },
  meaningful_win: null,
  pending_photo_relation: { relation: "none", target_win_id: null },
  durable_user_evidence: null,
  win_presentation: EMPTY_INBOUND_SOL_WIN_PRESENTATION,
};

describe("Sol inbound Win / Victory Room mapping", () => {
  it("simple goal completion: accountability win only, no ordinal 1", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: completed,
      inboundText: "I completed my lift.",
    });
    expect(input.recognition?.has_win).toBe(false);
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      behaviorStatement: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.accountability).not.toBeNull();
    expect(plan.independent).toBeNull();
  });

  it("mixed meaningful_win is same as accountability — no ordinal 1", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "Completed the lift",
          relationship: "mixed",
        },
      },
      inboundText: "I completed my lift.",
    });
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.independent).toBeNull();
  });

  it("unclear meaningful_win: no ordinal 1", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "something",
          relationship: "unclear",
        },
      },
      inboundText: "I completed my lift.",
    });
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.independent).toBeNull();
  });

  it("goal completion + distinct life win → ordinal 1 whole_life", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "Helped my brother through a hard situation",
          relationship: "life",
        },
      },
      inboundText:
        "I completed my lift and helped my brother through a hard situation.",
    });
    expect(input.recognition?.has_win).toBe(true);
    expect(input.equivalenceByOrdinal?.[0]).toBe("distinct");
    const plan = mergeInboundWinsForPersistence({
      userYesConfirmed: true,
      recognition: input.recognition,
      effectiveAsk: "Lift 30 minutes",
      equivalenceByOrdinal: input.equivalenceByOrdinal,
    });
    expect(plan.accountability).not.toBeNull();
    expect(plan.independent).not.toBeNull();
    expect(plan.independent?.ordinal).toBe(1);
    expect(plan.independent?.relationship_type).toBe("whole_life");
  });
});

describe("persistSolInboundWins routing", () => {
  it("yes+life uses accountability merge only (no separate persistRecognizedWins in plan helper)", () => {
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "Helped my brother",
          relationship: "life",
        },
      },
      inboundText: "I completed my lift and helped my brother.",
    });
    expect(input.recognition?.has_win).toBe(true);
    expect(input.equivalenceByOrdinal?.[0]).toBe("distinct");
  });

  it("goal/mixed/unclear/null: no extra life Win plan", () => {
    for (const relationship of ["goal", "mixed", "unclear", null] as const) {
      const input = buildSolInboundWinPlanInput({
        inbound: {
          ...completed,
          meaningful_win: relationship
            ? { present: true, grounded_action: "x", relationship }
            : null,
        },
        inboundText: "I completed my lift.",
      });
      expect(input.recognition?.has_win).toBe(false);
    }
  });
});

const yesEvent = {
  status: "inserted" as const,
  eventType: "user_yes" as const,
  eventId: "evt-yes",
  idempotencyKey: "k",
  overrideGatedNoWrite: false,
};

const skippedEvent = {
  status: "skipped" as const,
  skipReason: "sol_unrelated" as const,
};

describe("solWinDisplayTitleOverrides targeting", () => {
  it("A. accountability trophy is selected for user_yes; life title ignored without life Win", () => {
    const inbound: InboundSolBriefExtras = {
      ...completed,
      win_presentation: {
        accountability_trophy_title: "Lifted Weights",
        life_trophy_title: "Swam With the Kids",
      },
    };
    expect(solWinDisplayTitleOverrides(inbound)).toEqual({
      accountability: "Lifted Weights",
      independent: null,
    });
  });

  it("E/F. life trophy is selected only when meaningful_win.relationship is life", () => {
    const inbound: InboundSolBriefExtras = {
      ...completed,
      meaningful_win: {
        present: true,
        grounded_action: "Put his phone away while swimming and gave his kids his full attention.",
        relationship: "life",
      },
      win_presentation: {
        accountability_trophy_title: "Lifted Weights",
        life_trophy_title: "Proud Moment With Daughter",
      },
    };
    expect(solWinDisplayTitleOverrides(inbound)).toEqual({
      accountability: "Lifted Weights",
      independent: "Proud Moment With Daughter",
    });
  });

  it("G. acc + life named fields do not swap", () => {
    const inbound: InboundSolBriefExtras = {
      ...completed,
      meaningful_win: {
        present: true,
        grounded_action: "Took the kids swimming tonight",
        relationship: "life",
      },
      win_presentation: {
        accountability_trophy_title: "Lifted Weights",
        life_trophy_title: "Swam With the Kids",
      },
    };
    const titles = solWinDisplayTitleOverrides(inbound);
    expect(titles.accountability).toBe("Lifted Weights");
    expect(titles.independent).toBe("Swam With the Kids");
  });

  it("rejects >80 trophy titles without mid-word slicing", () => {
    const tooLong = `${"Family experience ".repeat(8)}end`;
    expect(tooLong.length).toBeGreaterThan(80);
    const inbound: InboundSolBriefExtras = {
      ...completed,
      win_presentation: {
        accountability_trophy_title: tooLong,
        life_trophy_title: "Swam\nWith the Kids",
      },
    };
    expect(solWinDisplayTitleOverrides(inbound)).toEqual({
      accountability: null,
      independent: null,
    });
  });
});

describe("persistSolInboundWins trophy overlay routing", () => {
  beforeEach(() => {
    persistInboundWinsWithAccountability.mockReset();
    persistRecognizedWins.mockReset();
    persistInboundWinsWithAccountability.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "w-acc", status: "inserted", idempotency_key: "win_v1:acc_yes:SM1" }],
    });
    persistRecognizedWins.mockResolvedValue({
      attempted: 1,
      persisted: 1,
      conflicts: 0,
      failed: 0,
      allDurable: true,
      wins: [{ ordinal: 0, id: "w-life", status: "inserted", idempotency_key: "win_v1:SM1:0" }],
    });
  });

  async function persist(args: {
    persistResult: Parameters<typeof persistSolInboundWins>[0]["persistResult"];
    inbound: InboundSolBriefExtras;
    inboundText?: string;
  }) {
    return persistSolInboundWins({
      persistResult: args.persistResult,
      inbound: args.inbound,
      inboundText: args.inboundText ?? "yes",
      clerkUserId: "user_1",
      messageSid: "SM1",
      commitmentId: "c1",
      occurredAtIso: "2026-08-28T12:00:00.000Z",
      effectiveAsk: "Lift weights for 30 minutes a day.",
      behaviorStatement: "Lift weights for 30 minutes a day.",
    });
  }

  it("A. user_yes passes accountability overlay and does not create extra persist", async () => {
    await persist({
      persistResult: yesEvent,
      inbound: {
        ...completed,
        win_presentation: {
          accountability_trophy_title: "Lifted Weights",
          life_trophy_title: null,
        },
      },
    });
    expect(persistInboundWinsWithAccountability).toHaveBeenCalledTimes(1);
    expect(persistRecognizedWins).not.toHaveBeenCalled();
    const arg = persistInboundWinsWithAccountability.mock.calls[0]?.[0];
    expect(arg.displayTitleOverrides).toEqual({
      accountability: "Lifted Weights",
      independent: null,
    });
    expect(arg.recognition?.has_win).toBe(false);
  });

  it("H. presentation cannot create rows when no authorized Win", async () => {
    const result = await persist({
      persistResult: skippedEvent,
      inbound: {
        ...completed,
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "hello",
        },
        win_presentation: {
          accountability_trophy_title: "Lifted Weights",
          life_trophy_title: "Swam With the Kids",
        },
      },
    });
    expect(result).toBeNull();
    expect(persistInboundWinsWithAccountability).not.toHaveBeenCalled();
    expect(persistRecognizedWins).not.toHaveBeenCalled();
  });

  it("E. life-only overlays suggested_title and leaves grounded_action on the candidate", async () => {
    const grounded =
      "Put his phone away while swimming and gave his kids his full attention.";
    await persist({
      persistResult: skippedEvent,
      inboundText:
        "Probably swimming with them and watching how excited they were. That was my favorite moment.",
      inbound: {
        ...completed,
        accountability_interpretation: {
          relevance: "unrelated",
          outcome: "not_applicable",
          confidence: "high",
          evidence: "swimming",
        },
        meaningful_win: {
          present: true,
          grounded_action: grounded,
          relationship: "life",
        },
        win_presentation: {
          accountability_trophy_title: "Lifted Weights",
          life_trophy_title: "Swam With the Kids",
        },
      },
    });
    expect(persistInboundWinsWithAccountability).not.toHaveBeenCalled();
    expect(persistRecognizedWins).toHaveBeenCalledTimes(1);
    const rec = persistRecognizedWins.mock.calls[0]?.[0]?.recognition;
    expect(rec.wins[0]?.grounded_action).toBe(grounded);
    expect(rec.wins[0]?.suggested_title).toBe("Swam With the Kids");
    expect(rec.wins[0]?.suggested_body).toBe(grounded.slice(0, 240));
  });

  it("G. acc+life passes named overlays onto the accountability merge call", async () => {
    await persist({
      persistResult: yesEvent,
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: "Took the kids swimming tonight",
          relationship: "life",
        },
        win_presentation: {
          accountability_trophy_title: "Lifted Weights",
          life_trophy_title: "Swam With the Kids",
        },
      },
    });
    expect(persistInboundWinsWithAccountability).toHaveBeenCalledTimes(1);
    expect(persistRecognizedWins).not.toHaveBeenCalled();
    const arg = persistInboundWinsWithAccountability.mock.calls[0]?.[0];
    expect(arg.displayTitleOverrides).toEqual({
      accountability: "Lifted Weights",
      independent: "Swam With the Kids",
    });
    expect(arg.equivalenceByOrdinal?.[0]).toBe("distinct");
  });
});

const LONG_SWIM =
  "Swam with the children and shared in their excitement during the family experience";

describe("Sol life fallback display_title is word-boundary limited", () => {
  it("never persists family experien; action_fact stays full grounded_action", () => {
    expect(LONG_SWIM.length).toBeGreaterThan(80);
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: LONG_SWIM,
          relationship: "life",
        },
      },
      inboundText: LONG_SWIM,
    });
    const win = input.recognition?.wins[0];
    expect(win?.grounded_action).toBe(LONG_SWIM);
    expect(win?.suggested_body).toBe(LONG_SWIM);
    expect(win?.evidence_quote).toBe(LONG_SWIM);
    expect(win?.suggested_title.length).toBeLessThanOrEqual(80);
    expect(win?.suggested_title).toBe(
      "Swam with the children and shared in their excitement during the family"
    );
    expect(win?.suggested_title).not.toMatch(/experien$/);
    expect(win?.suggested_title).not.toContain("experien");
  });

  it("unbroken >80 token uses stock fallback instead of mid-word slice", () => {
    const token = `Token${"x".repeat(80)}`;
    const input = buildSolInboundWinPlanInput({
      inbound: {
        ...completed,
        meaningful_win: {
          present: true,
          grounded_action: token,
          relationship: "life",
        },
      },
      inboundText: "yes",
    });
    expect(input.recognition?.wins[0]?.grounded_action).toBe(token.slice(0, 240));
    expect(input.recognition?.wins[0]?.suggested_title).toBe("Today's follow-through");
    expect(input.recognition?.wins[0]?.suggested_title).not.toBe(token.slice(0, 80));
  });
});
