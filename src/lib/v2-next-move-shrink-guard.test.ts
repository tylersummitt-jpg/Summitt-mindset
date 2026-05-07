import { describe, expect, it, vi } from "vitest";

// v2-ai-outbound imports modules that reference supabaseServer at module load.
// Mock so this unit test doesn't require SUPABASE_* env vars.
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}));

import type { V2EventRowForAi } from "@/lib/v2-commitment";
import { deriveV2NextMove } from "@/lib/v2-ai-outbound";

describe("deriveV2NextMove shrink guard", () => {
  it('never produces a fake "smaller" ask that is the same as base ask', () => {
    const eventsNewestFirst: V2EventRowForAi[] = [
      { event_type: "user_no", occurred_at: "2026-05-06T20:00:00.000Z", payload_json: {} },
      // Blocker captured after the latest miss prevents reset_day from winning.
      { event_type: "blocker_captured", occurred_at: "2026-05-06T21:00:00.000Z", payload_json: {} },
      { event_type: "user_no", occurred_at: "2026-05-05T20:00:00.000Z", payload_json: {} },
    ];
    const nm = deriveV2NextMove({
      eventsNewestFirst,
      now: new Date("2026-05-07T20:00:00.000Z"),
      silence: { tier: "none", unanswered_checks: 0, days_since_last_user_outcome: 0 },
      reentry: { active: false },
      behaviorStatement: "1 hour of distribution",
    });
    if (nm.type === "shrink_ask") {
      // Must be meaningfully smaller than the base ask (never "1 hour" again).
      expect(nm.shrunk_ask_text?.toLowerCase()).not.toContain("1 hour");
    }
  });
});

