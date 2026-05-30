import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  curateRecentProofMoments,
  deriveMergedProofMomentsFromEventWindow,
  getRecentProofDedupeKey,
  inferRecentProofCategory,
  type VictoryMoment,
} from "@/lib/v2-victory-room-view";

function m(args: {
  id: string;
  occurredAt: string;
  headline: string;
  body: string;
  groundedInEventTypes?: string[];
}): VictoryMoment {
  return {
    id: args.id,
    occurredAt: args.occurredAt,
    headline: args.headline,
    body: args.body,
    groundedInEventTypes: args.groundedInEventTypes ?? [],
  };
}

describe("blocker_captured proof derivation", () => {
  const proofLine = "You named the obstacle instead of disappearing.";

  it("derives quote from proof_quote when set", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "bc-q1",
          event_type: "user_yes",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: {
            proof_moment: true,
            proof_quote: "yes I did it",
            proof_meaning_line: "You followed through when it counted.",
          },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.quote).toBe("yes I did it");
    expect(merged[0]!.meaning).toBe("You followed through when it counted.");
    expect(merged[0]!.body).toBe("You followed through when it counted.");
  });

  it("falls back quote to message when proof_quote is absent", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "bc-q2",
          event_type: "user_partial",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: {
            proof_moment: true,
            message: "kind of",
            proof_meaning_line: "You stayed in the conversation instead of disappearing.",
          },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.quote).toBe("kind of");
    expect(merged[0]!.meaning).toBe("You stayed in the conversation instead of disappearing.");
  });

  it("derives Recent Proof from blocker_captured when proof_moment and user_visible_proof_line are set", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "bc-1",
          event_type: "blocker_captured",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: {
            proof_moment: true,
            user_visible_proof_line: proofLine,
            message: "work was crazy",
          },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.headline).toBe("Honesty");
    expect(merged[0]!.meaning).toBe(proofLine);
    expect(merged[0]!.body).toBe(proofLine);
    expect(merged[0]!.quote).toBe("work was crazy");
    expect(inferRecentProofCategory(merged[0]!)).toBe("told_the_truth");
  });

  it("legacy meaning-only card works when no quote exists", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "bc-legacy",
          event_type: "user_no",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: {
            proof_moment: true,
            user_visible_proof_line: "Honest no still counts as showing up.",
          },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.quote).toBeNull();
    expect(merged[0]!.body).toBe("Honest no still counts as showing up.");
    expect(merged[0]!.meaning).toBe("Honest no still counts as showing up.");
  });

  it("does not derive a card without proof_moment", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "bc-2",
          event_type: "blocker_captured",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: { message: "work was crazy" },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(0);
  });

  it("does not derive a card when user_visible_proof_line is empty", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "bc-3",
          event_type: "blocker_captured",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: { proof_moment: true, user_visible_proof_line: "   " },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(0);
  });
});

describe("season_lifecycle proof exclusion", () => {
  it("excludes season_lifecycle sms_memory_signal from proof moments", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "sl-1",
          event_type: "sms_memory_signal",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: {
            season_lifecycle: true,
            exclude_from_proof_curation: true,
            season_transition_action: "same_season_goal_sync",
          },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(0);
  });

  it("still derives commitment_replaced proof from wave12 sms_memory_signal", () => {
    const { merged } = deriveMergedProofMomentsFromEventWindow({
      eventRowsFull: [
        {
          id: "pr-1",
          event_type: "sms_memory_signal",
          occurred_at: "2026-05-10T12:00:00Z",
          payload_json: {
            proof_moment: true,
            proof_moment_type: "commitment_replaced",
            user_visible_proof_line: "You locked in a new chapter honestly.",
            memory_signal: { wave12_commitment_change_proof: true },
          },
        },
      ],
      reactivationEnteredAt: null,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.headline).toBe("New chapter");
  });
});

describe("curateRecentProofMoments (Phase 2)", () => {
  it("Test 1 — identical partials collapse (keeps most recent duplicate)", () => {
    const a = m({
      id: "p1",
      occurredAt: "2026-05-01T10:00:00Z",
      headline: "Stayed engaged",
      body: "You stayed engaged instead of disappearing.",
    });
    const b = m({
      id: "p2",
      occurredAt: "2026-05-02T10:00:00Z",
      headline: "Stayed engaged",
      body: "You stayed engaged instead of disappearing.",
    });
    const c = m({
      id: "p3",
      occurredAt: "2026-05-03T10:00:00Z",
      headline: "Stayed engaged",
      body: "You stayed engaged instead of disappearing.",
    });

    const out = curateRecentProofMoments([a, b, c], 4);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("p3");
    expect(getRecentProofDedupeKey(out[0]!)).toBe(getRecentProofDedupeKey(a));
    expect(inferRecentProofCategory(out[0]!)).toBe("kept_the_thread_alive");
  });

  it("Test 2 — strong moment beats many partials; partial capped to 1; max <= 4", () => {
    const partials: VictoryMoment[] = Array.from({ length: 6 }).map((_, i) =>
      m({
        id: `p${i + 1}`,
        occurredAt: `2026-05-0${(i % 3) + 1}T0${i}:00:00Z`,
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
      })
    );
    const honesty = m({
      id: "composite:honesty:test",
      occurredAt: "2026-05-04T10:00:00Z",
      headline: "Honesty",
      body: "You got honest and stayed in it.",
    });

    const out = curateRecentProofMoments([...partials, honesty], 4);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.some((x) => x.id === "composite:honesty:test")).toBe(true);
    expect(out.filter((x) => x.headline === "Stayed engaged").length).toBeLessThanOrEqual(1);
  });

  it("Test 3 — duplicate headline/body dedupes across different ids; distinct moment survives", () => {
    const dup1 = m({
      id: "d1",
      occurredAt: "2026-05-01T10:00:00Z",
      headline: "Honest miss",
      body: "Honest no still counts as showing up.",
    });
    const dup2 = m({
      id: "d2",
      occurredAt: "2026-05-02T10:00:00Z",
      headline: "Honest miss",
      body: "Honest no still counts as showing up.",
    });
    const distinct = m({
      id: "m3",
      occurredAt: "2026-05-03T10:00:00Z",
      headline: "Honest adjustment",
      body: "You tightened the bar instead of quitting.",
    });

    const out = curateRecentProofMoments([dup1, dup2, distinct], 4);
    expect(out.some((x) => x.id === "d2")).toBe(true);
    expect(out.some((x) => x.id === "d1")).toBe(false);
    expect(out.some((x) => x.id === "m3")).toBe(true);
  });

  it("Test 4 — only partial available still returns one", () => {
    const only = m({
      id: "p1",
      occurredAt: "2026-05-01T10:00:00Z",
      headline: "Stayed engaged",
      body: "You stayed engaged instead of disappearing.",
    });
    const out = curateRecentProofMoments([only], 4);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("p1");
  });

  it("Test 5 — does not mutate the input array", () => {
    const arr: VictoryMoment[] = [
      m({
        id: "a",
        occurredAt: "2026-05-01T10:00:00Z",
        headline: "Stayed engaged",
        body: "You stayed engaged instead of disappearing.",
      }),
      m({
        id: "b",
        occurredAt: "2026-05-04T10:00:00Z",
        headline: "Honesty",
        body: "You got honest and stayed in it.",
      }),
    ];
    const beforeIds = arr.map((x) => x.id).join(",");
    const out = curateRecentProofMoments(arr, 4);
    expect(out.length).toBeGreaterThan(0);
    const afterIds = arr.map((x) => x.id).join(",");
    expect(afterIds).toBe(beforeIds);
  });
});

