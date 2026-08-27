import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from },
}));

import {
  fetchHistoricalWinEvidenceSource,
  formatWinHistoricalEvidence,
  projectHistoricalWinEvidenceCarriers,
  selectHistoricalWinCandidateRows,
  takePriorClosedChapters,
  CHAPTER_WIN_CANDIDATE_MAX,
  HISTORICAL_WIN_CANDIDATE_MAX,
  LIFE_IDENTITY_WIN_CANDIDATE_MAX,
  type HistoricalWinRow,
  type PriorClosedCommitmentRow,
} from "@/lib/historical-win-evidence-load";

const TZ = "America/Chicago";
const REPO = process.cwd();

function prior(
  overrides: Partial<PriorClosedCommitmentRow> & Pick<PriorClosedCommitmentRow, "id">
): PriorClosedCommitmentRow {
  return {
    behavior_statement: `Standard ${overrides.id}`,
    started_at: "2026-01-01T12:00:00.000Z",
    ended_at: "2026-03-01T12:00:00.000Z",
    status: "superseded",
    ...overrides,
  };
}

function win(
  overrides: Partial<HistoricalWinRow> & Pick<HistoricalWinRow, "id">
): HistoricalWinRow {
  return {
    occurred_at: "2026-02-01T12:00:00.000Z",
    action_fact: `Did ${overrides.id}`,
    supporting_quote: null,
    relationship_type: "goal",
    commitment_id: "c-current",
    source_message_sid: null,
    sensitivity_caution: false,
    ...overrides,
  };
}

function project(args: {
  wins?: HistoricalWinRow[];
  priorChapters?: PriorClosedCommitmentRow[];
  currentChapterId?: string | null;
  currentBehavior?: string;
  surviving?: string[];
  timezone?: string;
}) {
  return projectHistoricalWinEvidenceCarriers({
    currentChapter:
      args.currentChapterId === null
        ? null
        : {
            id: args.currentChapterId ?? "c-current",
            behavior_statement: args.currentBehavior ?? "Strength train 2x/week",
          },
    priorChapters: args.priorChapters ?? [],
    wins: args.wins ?? [],
    timezone: args.timezone ?? TZ,
    survivingExactThreadMessageSids: args.surviving ?? [],
  });
}

describe("takePriorClosedChapters", () => {
  it("keeps at most 3 closed chapters by started_at DESC", () => {
    const rows = [
      prior({ id: "c4", started_at: "2025-01-01T00:00:00.000Z", status: "abandoned" }),
      prior({ id: "c1", started_at: "2026-03-01T00:00:00.000Z", status: "superseded" }),
      prior({ id: "c3", started_at: "2026-01-01T00:00:00.000Z", status: "completed" }),
      prior({ id: "c2", started_at: "2026-02-01T00:00:00.000Z", status: "superseded" }),
    ];
    expect(takePriorClosedChapters(rows).map((r) => r.id)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("historical win candidate selection", () => {
  it("no Wins → []", () => {
    expect(
      selectHistoricalWinCandidateRows({
        currentChapterId: "c-current",
        priorChapters: [],
        wins: [],
      })
    ).toEqual([]);
    expect(project({ wins: [] }).map((c) => c.item)).toEqual([]);
  });

  it("one active Win", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [win({ id: "w1", action_fact: "Completed 40 seconds" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("w1");
  });

  it("hidden Win excluded — only rows passed in (active fetch) are eligible", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [win({ id: "active-only" })],
    });
    expect(rows.map((r) => r.id)).toEqual(["active-only"]);
  });

  it("current chapter only", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [
        win({ id: "cur", commitment_id: "c-current" }),
        win({ id: "other", commitment_id: "c-other", occurred_at: "2025-06-01T00:00:00.000Z" }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["cur"]);
  });

  it("current + prior chapters", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [prior({ id: "c-old", started_at: "2025-01-01T00:00:00.000Z" })],
      wins: [
        win({ id: "cur", commitment_id: "c-current" }),
        win({ id: "old", commitment_id: "c-old", occurred_at: "2025-06-01T00:00:00.000Z" }),
      ],
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["cur", "old"]);
  });

  it("fifth chapter beyond bound excluded", () => {
    const priors = [
      prior({ id: "p1", started_at: "2026-03-01T00:00:00.000Z" }),
      prior({ id: "p2", started_at: "2026-02-01T00:00:00.000Z" }),
      prior({ id: "p3", started_at: "2026-01-01T00:00:00.000Z" }),
      prior({ id: "p4", started_at: "2025-12-01T00:00:00.000Z" }),
    ];
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: priors,
      wins: [
        win({ id: "w-cur", commitment_id: "c-current" }),
        win({ id: "w-p1", commitment_id: "p1", occurred_at: "2026-03-10T00:00:00.000Z" }),
        win({ id: "w-p2", commitment_id: "p2", occurred_at: "2026-02-10T00:00:00.000Z" }),
        win({ id: "w-p3", commitment_id: "p3", occurred_at: "2026-01-10T00:00:00.000Z" }),
        win({ id: "w-p4", commitment_id: "p4", occurred_at: "2025-12-10T00:00:00.000Z" }),
      ],
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["w-cur", "w-p1", "w-p2", "w-p3"]);
    expect(rows.some((r) => r.id === "w-p4")).toBe(false);
  });

  it("earliest/latest selected", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [
        win({ id: "mid", occurred_at: "2026-02-15T00:00:00.000Z" }),
        win({ id: "early", occurred_at: "2026-01-01T00:00:00.000Z" }),
        win({ id: "late", occurred_at: "2026-03-01T00:00:00.000Z" }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("one-Win chapter emitted once", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [win({ id: "only" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("only");
  });

  it("zero-Win chapter skipped", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [prior({ id: "empty", started_at: "2025-01-01T00:00:00.000Z" })],
      wins: [win({ id: "cur", commitment_id: "c-current" })],
    });
    expect(rows.map((r) => r.id)).toEqual(["cur"]);
  });

  it("chapter max 8", () => {
    const priors = [
      prior({ id: "p1", started_at: "2026-03-01T00:00:00.000Z" }),
      prior({ id: "p2", started_at: "2026-02-01T00:00:00.000Z" }),
      prior({ id: "p3", started_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const wins: HistoricalWinRow[] = [];
    const chapterIds = ["c-current", "p1", "p2", "p3"];
    for (const cid of chapterIds) {
      wins.push(
        win({
          id: `${cid}-e`,
          commitment_id: cid,
          occurred_at: "2026-01-01T00:00:00.000Z",
        }),
        win({
          id: `${cid}-m`,
          commitment_id: cid,
          occurred_at: "2026-02-01T00:00:00.000Z",
        }),
        win({
          id: `${cid}-l`,
          commitment_id: cid,
          occurred_at: "2026-03-01T00:00:00.000Z",
        })
      );
    }
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: priors,
      wins,
    });
    expect(rows).toHaveLength(CHAPTER_WIN_CANDIDATE_MAX);
    expect(rows.some((r) => r.id.endsWith("-m"))).toBe(false);
  });

  it("whole_life earliest + latest", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [
        win({
          id: "life-early",
          relationship_type: "whole_life",
          commitment_id: null,
          occurred_at: "2025-01-01T00:00:00.000Z",
        }),
        win({
          id: "life-mid",
          relationship_type: "whole_life",
          commitment_id: null,
          occurred_at: "2025-06-01T00:00:00.000Z",
        }),
        win({
          id: "life-late",
          relationship_type: "whole_life",
          commitment_id: null,
          occurred_at: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    expect(rows.map((r) => r.id)).toEqual(["life-early", "life-late"]);
  });

  it("identity participates in same bucket", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [
        win({
          id: "id-early",
          relationship_type: "identity",
          commitment_id: null,
          occurred_at: "2025-01-01T00:00:00.000Z",
        }),
        win({
          id: "life-late",
          relationship_type: "whole_life",
          commitment_id: null,
          occurred_at: "2026-01-01T00:00:00.000Z",
        }),
      ],
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["id-early", "life-late"]);
  });

  it("life/identity one row emitted once", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [
        win({
          id: "only-life",
          relationship_type: "whole_life",
          commitment_id: null,
        }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("only-life");
  });

  it("life/identity max 2", () => {
    const wins = Array.from({ length: 5 }, (_, i) =>
      win({
        id: `life-${i}`,
        relationship_type: i % 2 === 0 ? "whole_life" : "identity",
        commitment_id: null,
        occurred_at: `2026-0${i + 1}-01T00:00:00.000Z`,
      })
    );
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins,
    });
    expect(rows).toHaveLength(LIFE_IDENTITY_WIN_CANDIDATE_MAX);
    expect(rows.map((r) => r.id)).toEqual(["life-0", "life-4"]);
  });

  it("designed total max 10", () => {
    const priors = [
      prior({ id: "p1", started_at: "2026-03-01T00:00:00.000Z" }),
      prior({ id: "p2", started_at: "2026-02-01T00:00:00.000Z" }),
      prior({ id: "p3", started_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const wins: HistoricalWinRow[] = [];
    for (const cid of ["c-current", "p1", "p2", "p3"]) {
      wins.push(
        win({ id: `${cid}-e`, commitment_id: cid, occurred_at: "2026-01-01T00:00:00.000Z" }),
        win({ id: `${cid}-l`, commitment_id: cid, occurred_at: "2026-03-01T00:00:00.000Z" })
      );
    }
    wins.push(
      win({
        id: "life-e",
        relationship_type: "whole_life",
        commitment_id: null,
        occurred_at: "2024-01-01T00:00:00.000Z",
      }),
      win({
        id: "life-m",
        relationship_type: "identity",
        commitment_id: null,
        occurred_at: "2024-06-01T00:00:00.000Z",
      }),
      win({
        id: "life-l",
        relationship_type: "whole_life",
        commitment_id: null,
        occurred_at: "2025-01-01T00:00:00.000Z",
      })
    );
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: priors,
      wins,
    });
    expect(rows).toHaveLength(HISTORICAL_WIN_CANDIDATE_MAX);
    expect(rows.some((r) => r.id === "life-m")).toBe(false);
  });

  it("selected chapter Win not duplicated into life bucket", () => {
    const rows = selectHistoricalWinCandidateRows({
      currentChapterId: "c-current",
      priorChapters: [],
      wins: [
        win({
          id: "chapter-life",
          relationship_type: "whole_life",
          commitment_id: "c-current",
          occurred_at: "2026-01-01T00:00:00.000Z",
        }),
        win({
          id: "other-life",
          relationship_type: "whole_life",
          commitment_id: null,
          occurred_at: "2026-06-01T00:00:00.000Z",
        }),
      ],
    });
    expect(rows.filter((r) => r.id === "chapter-life")).toHaveLength(1);
    expect(rows.map((r) => r.id).sort()).toEqual(["chapter-life", "other-life"]);
  });
});

describe("exact-thread SID suppression", () => {
  it("source_message_sid in surviving exact thread omitted", () => {
    const carriers = project({
      wins: [
        win({ id: "in", source_message_sid: "SM_IN", action_fact: "In thread" }),
        win({ id: "out", source_message_sid: "SM_OUT", action_fact: "Fallen" }),
      ],
      surviving: ["SM_IN"],
    });
    expect(carriers.map((c) => c.id)).toEqual(["out"]);
  });

  it("null SID remains eligible", () => {
    const carriers = project({
      wins: [win({ id: "manual", source_message_sid: null, action_fact: "Wrote it myself" })],
      surviving: ["SM_ANY"],
    });
    expect(carriers).toHaveLength(1);
    expect(carriers[0]?.id).toBe("manual");
  });

  it("same SID two Wins both retained if SID not in thread", () => {
    const carriers = project({
      wins: [
        win({
          id: "goal-win",
          source_message_sid: "SM_BOTH",
          relationship_type: "goal",
          action_fact: "Finished the session",
        }),
        win({
          id: "life-win",
          source_message_sid: "SM_BOTH",
          relationship_type: "whole_life",
          commitment_id: null,
          action_fact: "Had the hard conversation",
        }),
      ],
      surviving: [],
    });
    expect(carriers.map((c) => c.id).sort()).toEqual(["goal-win", "life-win"]);
  });

  it("same SID two Wins both omitted if SID in thread", () => {
    const carriers = project({
      wins: [
        win({
          id: "goal-win",
          source_message_sid: "SM_BOTH",
          relationship_type: "goal",
        }),
        win({
          id: "life-win",
          source_message_sid: "SM_BOTH",
          relationship_type: "whole_life",
          commitment_id: null,
        }),
      ],
      surviving: ["SM_BOTH"],
    });
    expect(carriers).toEqual([]);
  });
});

describe("win evidence projection", () => {
  it("missing commitment context → action_fact", () => {
    const carriers = project({
      currentChapterId: "c-current",
      wins: [
        win({
          id: "orphan",
          commitment_id: "missing-chapter",
          relationship_type: "whole_life",
          action_fact: "Had the conversation with dad",
        }),
      ],
    });
    expect(carriers[0]?.item.evidence).toBe("Had the conversation with dad");
  });

  it("goal context → Then-standard prefix", () => {
    const carriers = project({
      currentBehavior: "Strength train 2x/week",
      wins: [win({ id: "g", action_fact: "Completed 40 seconds" })],
    });
    expect(carriers[0]?.item).toEqual({
      source: "win",
      occurred_at: "2026-02-01",
      evidence: "Then-standard: Strength train 2x/week. Win: Completed 40 seconds",
    });
  });

  it("action_fact == behavior_statement → no duplicated prefix", () => {
    const carriers = project({
      currentBehavior: "Strength train 2x/week",
      wins: [win({ id: "g", action_fact: "Strength train 2x/week" })],
    });
    expect(carriers[0]?.item.evidence).toBe("Strength train 2x/week");
  });

  it("caps then-standard behavior to 120 chars", () => {
    expect(
      formatWinHistoricalEvidence({
        action_fact: "Did it",
        behavior_statement: "x".repeat(140),
      })
    ).toBe(`Then-standard: ${"x".repeat(120)}. Win: Did it`);
  });

  it("null commitment_id → action_fact", () => {
    const carriers = project({
      wins: [
        win({
          id: "life",
          commitment_id: null,
          relationship_type: "whole_life",
          action_fact: "Had the hard conversation",
        }),
      ],
    });
    expect(carriers[0]?.item.evidence).toBe("Had the hard conversation");
  });

  it("sensitivity_caution → no user_quote", () => {
    const carriers = project({
      wins: [
        win({
          id: "g",
          supporting_quote: "I finally did it",
          sensitivity_caution: true,
        }),
      ],
    });
    expect(carriers[0]?.item.user_quote).toBeUndefined();
    expect(carriers[0]?.item).not.toHaveProperty("user_quote");
  });

  it("supporting_quote null → no user_quote", () => {
    const carriers = project({
      wins: [win({ id: "g", supporting_quote: null })],
    });
    expect(carriers[0]?.item).not.toHaveProperty("user_quote");
  });

  it("supporting_quote included when present and not cautioned", () => {
    const carriers = project({
      wins: [win({ id: "g", supporting_quote: "  I got it done  " })],
    });
    expect(carriers[0]?.item.user_quote).toBe("I got it done");
  });

  it("timezone local date, not UTC calendar date", () => {
    const carriers = project({
      wins: [win({ id: "g", occurred_at: "2026-08-19T04:30:00.000Z" })],
      timezone: TZ,
    });
    expect(carriers[0]?.item.occurred_at).toBe("2026-08-18");
  });
});

describe("fetchHistoricalWinEvidenceSource", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("queries active Wins only and prior closed commitments", async () => {
    const priorBuilder: Record<string, unknown> = {};
    const winBuilder: Record<string, unknown> = {};
    const priorEq = vi.fn(() => priorBuilder);
    const priorIn = vi.fn(() => priorBuilder);
    const priorOrder = vi.fn(() => priorBuilder);
    const priorLimit = vi.fn(() => priorBuilder);
    Object.assign(priorBuilder, {
      select: () => priorBuilder,
      eq: priorEq,
      in: priorIn,
      order: priorOrder,
      limit: priorLimit,
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    });
    const winEq = vi.fn(() => winBuilder);
    Object.assign(winBuilder, {
      select: () => winBuilder,
      eq: winEq,
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    });
    from.mockImplementation((table: string) => {
      if (table === "v2_commitment") return priorBuilder;
      if (table === "v2_win") return winBuilder;
      return priorBuilder;
    });

    await fetchHistoricalWinEvidenceSource("user_1");
    expect(from).toHaveBeenCalledWith("v2_commitment");
    expect(from).toHaveBeenCalledWith("v2_win");
    expect(priorEq).toHaveBeenCalledWith("clerk_user_id", "user_1");
    expect(priorIn).toHaveBeenCalledWith("status", ["completed", "abandoned", "superseded"]);
    expect(priorOrder).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(priorLimit).toHaveBeenCalledWith(3);
    expect(winEq).toHaveBeenCalledWith("clerk_user_id", "user_1");
    expect(winEq).toHaveBeenCalledWith("status", "active");
    expect(winEq).not.toHaveBeenCalledWith("status", "hidden");
  });

  it("DB read failure → []", async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (v: { data: null; error: { message: string } }) => void) =>
        resolve({ data: null, error: { message: "boom" } }),
    };
    from.mockReturnValue(builder);
    const result = await fetchHistoricalWinEvidenceSource("user_1");
    expect(result).toEqual({ priors: [], wins: [] });
  });

  it("thrown query → []", async () => {
    from.mockImplementation(() => {
      throw new Error("network");
    });
    const result = await fetchHistoricalWinEvidenceSource("user_1");
    expect(result).toEqual({ priors: [], wins: [] });
  });

  it("skips hidden rows because fetch is status=active only", async () => {
    const priorBuilder = {
      select: () => priorBuilder,
      eq: () => priorBuilder,
      in: () => priorBuilder,
      order: () => priorBuilder,
      limit: () => priorBuilder,
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    };
    const winBuilder = {
      select: () => winBuilder,
      eq: () => winBuilder,
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({
          data: [
            {
              id: "active",
              occurred_at: "2026-02-01T12:00:00.000Z",
              action_fact: "Visible win",
              supporting_quote: null,
              relationship_type: "goal",
              commitment_id: "c-current",
              source_message_sid: null,
              sensitivity_caution: false,
            },
          ],
          error: null,
        }),
    };
    from.mockImplementation((table: string) =>
      table === "v2_win" ? winBuilder : priorBuilder
    );
    const result = await fetchHistoricalWinEvidenceSource("user_1");
    expect(result.wins).toHaveLength(1);
    expect(result.wins[0]?.id).toBe("active");
  });
});

describe("no mutation path", () => {
  it("loader is read-only against v2_win and v2_commitment", () => {
    const src = readFileSync(join(REPO, "src/lib/historical-win-evidence-load.ts"), "utf8");
    expect(src).toContain('.from("v2_win")');
    expect(src).toContain('.from("v2_commitment")');
    expect(src).toContain('.eq("status", "active")');
    expect(src).not.toContain(".insert(");
    expect(src).not.toContain(".update(");
    expect(src).not.toContain(".delete(");
    expect(src).not.toContain(".upsert(");
    expect(src).not.toContain(".rpc(");
  });
});
