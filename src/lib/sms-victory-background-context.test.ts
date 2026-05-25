import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: fromMock },
}));

import {
  buildVictoryBackgroundLaneGuardrails,
  loadSmsVictoryBackgroundContext,
  mapPatPrinciplesSnapshotRowToContext,
  mapSmsVictoryBackgroundToFacts,
} from "@/lib/sms-victory-background-context";

function chainMaybeSingle(data: unknown, error: { message: string } | null = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function defaultFromMock(
  overrides: Partial<{
    season: unknown;
    patRead: unknown;
    principles: unknown;
    principlesError: { message: string } | null;
  }> = {}
) {
  return (table: string) => {
    if (table === "user_accountability_season") {
      return chainMaybeSingle(overrides.season ?? null);
    }
    if (table === "v2_victory_pat_read_snapshot") {
      return chainMaybeSingle(overrides.patRead ?? null);
    }
    if (table === "v2_victory_pat_principles_snapshot") {
      return chainMaybeSingle(overrides.principles ?? null, overrides.principlesError ?? null);
    }
    throw new Error(`unexpected table ${table}`);
  };
}

describe("loadSmsVictoryBackgroundContext", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns active season label and startedAt when active season row exists", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        season: {
          id: "s1",
          season_name: "Spring Focus",
          started_at: "2026-01-15T12:00:00.000Z",
        },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.activeSeason).toEqual({
      seasonName: "Spring Focus",
      startedAt: "2026-01-15T12:00:00.000Z",
    });
    expect(ctx.patRead).toBeNull();
    expect(ctx.patPrinciples).toBeNull();
  });

  it("returns Pat Read display fields when snapshot exists", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        patRead: {
          strength_text: "You kept showing up.",
          pattern_text: "Mornings are your edge.",
          next_move_text: "Protect the first hour tomorrow.",
        },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.patRead).toEqual({
      strength: "You kept showing up.",
      pattern: "Mornings are your edge.",
      nextMove: "Protect the first hour tomorrow.",
    });
  });

  it("maps focus_next when non-starter principles snapshot exists", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        principles: {
          living_well_title: null,
          living_well_text: null,
          living_well_evidence_ids: [],
          focus_next_title: "Take Full Responsibility",
          focus_next_text: "Practice telling the truth about the miss.",
          confidence: "low",
        },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.patPrinciples).toEqual({
      focusNextTitle: "Take Full Responsibility",
      focusNextText: "Practice telling the truth about the miss.",
      livingWellTitle: null,
      livingWellText: null,
    });
  });

  it("maps living_well only when living_well_evidence_ids is non-empty and title/text exist", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        principles: {
          living_well_title: "Be a Competitor",
          living_well_text: "Your comeback lines show you compete with the standard.",
          living_well_evidence_ids: ["m1", "m2"],
          focus_next_title: "Discipline Yourself",
          focus_next_text: "This week, practice one clean morning block.",
          confidence: "medium",
        },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.patPrinciples?.livingWellTitle).toBe("Be a Competitor");
    expect(ctx.patPrinciples?.livingWellText).toContain("comeback");
    expect(ctx.patPrinciples?.focusNextTitle).toBe("Discipline Yourself");
  });

  it("omits living_well when evidence array is empty", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        principles: {
          living_well_title: "Be a Competitor",
          living_well_text: "Should not surface without evidence ids.",
          living_well_evidence_ids: [],
          focus_next_title: "Work Smart",
          focus_next_text: "Adjust the plan once, then execute.",
          confidence: "low",
        },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.patPrinciples?.livingWellTitle).toBeNull();
    expect(ctx.patPrinciples?.livingWellText).toBeNull();
    expect(ctx.patPrinciples?.focusNextTitle).toBe("Work Smart");
  });

  it("omits pat_principles entirely when confidence is starter", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        principles: {
          living_well_title: null,
          living_well_text: null,
          living_well_evidence_ids: [],
          focus_next_title: "Take Full Responsibility",
          focus_next_text: "Start with the standard.",
          confidence: "starter",
        },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.patPrinciples).toBeNull();
  });

  it("omits pat_principles when focus_next_title/text missing after trim", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        principles: {
          living_well_title: null,
          living_well_text: null,
          living_well_evidence_ids: [],
          focus_next_title: "   ",
          focus_next_text: "",
          confidence: "medium",
        },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.patPrinciples).toBeNull();
  });

  it("fail-open: principles query error still returns season and Pat Read", async () => {
    fromMock.mockImplementation(
      defaultFromMock({
        season: { id: "s1", season_name: "Chapter 1", started_at: null },
        patRead: {
          strength_text: "Steady",
          pattern_text: null,
          next_move_text: null,
        },
        principlesError: { message: "principles down" },
      })
    );

    const ctx = await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(ctx.activeSeason?.seasonName).toBe("Chapter 1");
    expect(ctx.patRead?.strength).toBe("Steady");
    expect(ctx.patPrinciples).toBeNull();
  });

  it("queries season, pat read, and pat principles snapshot (no season summary or events)", async () => {
    const tables: string[] = [];
    fromMock.mockImplementation((table: string) => {
      tables.push(table);
      return defaultFromMock()(table);
    });

    await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(tables).toEqual([
      "user_accountability_season",
      "v2_victory_pat_read_snapshot",
      "v2_victory_pat_principles_snapshot",
    ]);
    expect(tables).not.toContain("v2_victory_season_summary_snapshot");
    expect(tables).not.toContain("v2_commitment_event");
  });

  it("pat principles select uses display/gating fields only", async () => {
    const principlesSelect = vi.fn().mockReturnThis();
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_victory_pat_principles_snapshot") {
        return {
          select: principlesSelect,
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return defaultFromMock()(table);
    });

    await loadSmsVictoryBackgroundContext({
      clerkUserId: "user_1",
      commitmentId: "cmt_1",
    });
    expect(principlesSelect).toHaveBeenCalledWith(
      "living_well_title, living_well_text, living_well_evidence_ids, focus_next_title, focus_next_text, confidence"
    );
    const cols = String(principlesSelect.mock.calls[0]?.[0] ?? "");
    expect(cols).not.toContain("input_bundle_json");
    expect(cols).not.toContain("source_hash");
    expect(cols).not.toContain("starter_text");
    expect(cols).not.toContain("provenance");
  });
});

describe("mapPatPrinciplesSnapshotRowToContext", () => {
  it("returns null for starter confidence", () => {
    expect(
      mapPatPrinciplesSnapshotRowToContext({
        confidence: "starter",
        focus_next_title: "A",
        focus_next_text: "B",
      })
    ).toBeNull();
  });
});

describe("mapSmsVictoryBackgroundToFacts", () => {
  it("maps season and pat read into victory_background facts shape", () => {
    const facts = mapSmsVictoryBackgroundToFacts({
      activeSeason: { seasonName: "Chapter 2", startedAt: "2026-02-01T00:00:00Z" },
      patRead: {
        strength: "Steady effort",
        pattern: null,
        nextMove: "One clear win today",
      },
      patPrinciples: null,
    });
    expect(facts).toEqual({
      active_season_label: "Chapter 2",
      active_season_started_at: "2026-02-01T00:00:00Z",
      pat_read_strength: "Steady effort",
      pat_read_pattern: null,
      pat_read_next_move: "One clear win today",
    });
  });

  it("includes pat_principles in facts when present", () => {
    const facts = mapSmsVictoryBackgroundToFacts({
      activeSeason: null,
      patRead: null,
      patPrinciples: {
        focusNextTitle: "Discipline Yourself",
        focusNextText: "Protect the morning block.",
        livingWellTitle: "Be a Competitor",
        livingWellText: "You compete with the standard when it counts.",
      },
    });
    expect(facts?.pat_principles).toEqual({
      focus_next_title: "Discipline Yourself",
      focus_next_text: "Protect the morning block.",
      living_well_title: "Be a Competitor",
      living_well_text: "You compete with the standard when it counts.",
    });
  });

  it("returns facts with only pat_principles when season and pat read absent", () => {
    const facts = mapSmsVictoryBackgroundToFacts({
      activeSeason: null,
      patRead: null,
      patPrinciples: {
        focusNextTitle: "Work Smart",
        focusNextText: "Adjust once, then execute.",
        livingWellTitle: null,
        livingWellText: null,
      },
    });
    expect(facts?.active_season_label).toBeNull();
    expect(facts?.pat_principles?.focus_next_title).toBe("Work Smart");
  });
});

describe("buildVictoryBackgroundLaneGuardrails", () => {
  it("discourages inventing principles and keeps Current Goal primary", () => {
    const g = buildVictoryBackgroundLaneGuardrails();
    expect(g).toContain("background");
    expect(g).toMatch(/do not invent/i);
    expect(g).toMatch(/Pat Principles/i);
    expect(g).toMatch(/primary anchor/i);
    expect(g).not.toMatch(/not in facts for this slice/i);
    expect(g).toMatch(/Pat Pause/i);
    expect(g).toMatch(/Pat Summitt/i);
    expect(g).toMatch(/Definite Dozen/i);
    expect(g).toMatch(/Victory Room/i);
  });
});
