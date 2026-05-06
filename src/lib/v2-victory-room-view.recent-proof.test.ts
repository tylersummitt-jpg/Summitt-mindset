import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  curateRecentProofMoments,
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

