import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  buildSolGoalChangeSemanticInput,
  emptySolGoalChangeSemanticResult,
  parseSolGoalChangeSemanticResult,
  SOL_GOAL_CHANGE_SEMANTIC_VERSION,
  type SolGoalChangeSemanticResult,
} from "@/lib/sol-goal-change-semantic";

const ANGELA_CANONICAL = "I will be in bed by 9:30 pm nightly.";

function input(latestInboundText: string) {
  return buildSolGoalChangeSemanticInput({
    canonicalSavedBehaviorStatement: ANGELA_CANONICAL,
    latestInboundText,
  });
}

function modelJson(
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> & {
    concurrent?: Partial<SolGoalChangeSemanticResult["concurrent_meaning"]>;
  }
): SolGoalChangeSemanticResult {
  const { concurrent, ...goal } = overrides;
  return {
    version: SOL_GOAL_CHANGE_SEMANTIC_VERSION,
    goal_change: {
      ...emptySolGoalChangeSemanticResult().goal_change,
      ...goal,
    },
    concurrent_meaning: {
      planned_interruption: false,
      accountability_update: false,
      ...concurrent,
    },
  };
}

function parseGoal(
  inbound: string,
  overrides: Partial<SolGoalChangeSemanticResult["goal_change"]> & {
    concurrent?: Partial<SolGoalChangeSemanticResult["concurrent_meaning"]>;
  }
) {
  return parseSolGoalChangeSemanticResult(modelJson(overrides), input(inbound));
}

describe("Slice 7A — Sol temporary duration schema parse matrix", () => {
  it("1 saved replace going forward — duration fields null/unspecified", () => {
    const parsed = parseGoal("Going forward, make it 10:30.", {
      intent: "saved_replace",
      candidate_behavior_statement: "10:30",
      requires_confirmation: true,
      temporary_duration_kind: "unspecified",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("saved_replace");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.temporary_duration_days).toBeNull();
    expect(parsed.result.goal_change.temporary_weekday).toBeNull();
    expect(parsed.result.goal_change.temporary_end_local_date).toBeNull();
  });

  it("2 tonight → remaining_local_day", () => {
    const parsed = parseGoal("Just tonight, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "remaining_local_day",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("temporary_adjustment");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("remaining_local_day");
    expect(parsed.result.goal_change.temporary_duration_days).toBeNull();
    expect(parsed.result.goal_change.needs_clarification).toBe(false);
  });

  it("3 today only → remaining_local_day", () => {
    const parsed = parseGoal("Today only, 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "remaining_local_day",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("remaining_local_day");
  });

  it("4 this week → local_week", () => {
    const parsed = parseGoal("This week, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "local_week",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("local_week");
    expect(parsed.result.goal_change.temporary_weekday).toBeNull();
  });

  it("5 next 3 days → days=3", () => {
    const parsed = parseGoal("For the next 3 days, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "days",
      temporary_duration_days: 3,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("days");
    expect(parsed.result.goal_change.temporary_duration_days).toBe(3);
  });

  it("6 through Friday → through_weekday=friday", () => {
    const parsed = parseGoal("Through Friday, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "through_weekday",
      temporary_weekday: "friday",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("through_weekday");
    expect(parsed.result.goal_change.temporary_weekday).toBe("friday");
  });

  it("7 until Friday → until_weekday=friday", () => {
    const parsed = parseGoal("Until Friday, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "until_weekday",
      temporary_weekday: "friday",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("until_weekday");
    expect(parsed.result.goal_change.temporary_weekday).toBe("friday");
  });

  it("8 through explicit date", () => {
    const parsed = parseGoal("Through September 12, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "through_local_date",
      temporary_end_local_date: "2026-09-12",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("through_local_date");
    expect(parsed.result.goal_change.temporary_end_local_date).toBe("2026-09-12");
  });

  it("9 until explicit date", () => {
    const parsed = parseGoal("Until September 12, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "until_local_date",
      temporary_end_local_date: "2026-09-12",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("until_local_date");
    expect(parsed.result.goal_change.temporary_end_local_date).toBe("2026-09-12");
  });

  it("10 for now → unspecified + clarify", () => {
    const parsed = parseGoal("For now, make it 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "unspecified",
      needs_clarification: false,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("temporary_adjustment");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.needs_clarification).toBe(true);
  });

  it("11 while traveling no end → unspecified + PI + clarify", () => {
    const parsed = parseGoal("While I'm traveling, make it 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "unspecified",
      concurrent: { planned_interruption: true },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.needs_clarification).toBe(true);
    expect(parsed.result.concurrent_meaning.planned_interruption).toBe(true);
  });

  it("12 while traveling through Friday → temp + PI + through Friday", () => {
    const parsed = parseGoal("While I'm traveling, through Friday hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "through_weekday",
      temporary_weekday: "friday",
      concurrent: { planned_interruption: true },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("temporary_adjustment");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("through_weekday");
    expect(parsed.result.goal_change.temporary_weekday).toBe("friday");
    expect(parsed.result.concurrent_meaning.planned_interruption).toBe(true);
  });

  it("13 harder this week → temp local_week, not saved replace", () => {
    const parsed = parseGoal("Make it harder this week.", {
      intent: "temporary_adjustment",
      needs_clarification: true,
      temporary_duration_kind: "local_week",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("temporary_adjustment");
    expect(parsed.result.goal_change.intent).not.toBe("saved_replace");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("local_week");
  });

  it("14 easier this week → temp local_week", () => {
    const parsed = parseGoal("Make it easier this week.", {
      intent: "temporary_adjustment",
      temporary_duration_kind: "local_week",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("temporary_adjustment");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("local_week");
  });

  it("15 malformed days=0 → unspecified + clarify", () => {
    const parsed = parseGoal("For 0 days, 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "days",
      temporary_duration_days: 0,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.temporary_duration_days).toBeNull();
    expect(parsed.result.goal_change.needs_clarification).toBe(true);
  });

  it("16 malformed days=15 → unspecified + clarify", () => {
    const parsed = parseGoal("For the next 15 days, 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "days",
      temporary_duration_days: 15,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.needs_clarification).toBe(true);
  });

  it("17 weekday kind missing weekday → unspecified + clarify", () => {
    const parsed = parseGoal("Through Friday, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "through_weekday",
      temporary_weekday: null,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.needs_clarification).toBe(true);
  });

  it("18 date kind invalid date → unspecified + clarify", () => {
    const parsed = parseGoal("Through February 30, hold me to 10:30.", {
      intent: "temporary_adjustment",
      candidate_behavior_statement: "10:30",
      temporary_duration_kind: "through_local_date",
      temporary_end_local_date: "2026-02-30",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.temporary_end_local_date).toBeNull();
    expect(parsed.result.goal_change.needs_clarification).toBe(true);
  });

  it("19 temp fields present on saved_replace are stripped", () => {
    const parsed = parseGoal("Change my goal to 10:30.", {
      intent: "saved_replace",
      candidate_behavior_statement: "10:30",
      requires_confirmation: true,
      temporary_duration_kind: "days",
      temporary_duration_days: 3,
      temporary_weekday: "friday",
      temporary_end_local_date: "2026-09-12",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("saved_replace");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.temporary_duration_days).toBeNull();
    expect(parsed.result.goal_change.temporary_weekday).toBeNull();
    expect(parsed.result.goal_change.temporary_end_local_date).toBeNull();
  });

  it("20 temp fields present on none are stripped", () => {
    const parsed = parseGoal("ok thanks", {
      intent: "none",
      temporary_duration_kind: "remaining_local_day",
      temporary_duration_days: 2,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.result.goal_change.intent).toBe("none");
    expect(parsed.result.goal_change.temporary_duration_kind).toBe("unspecified");
    expect(parsed.result.goal_change.temporary_duration_days).toBeNull();
  });
});

describe("Slice 7A — no second brain / no production resolver callers", () => {
  it("resolver and duration schema have no raw-English duration parser", () => {
    const dir = path.join(process.cwd(), "src/lib");
    const files = [
      "sol-goal-change-temporary-duration.ts",
      "sol-goal-change-semantic.ts",
      "sol-goal-change-semantic-json-schema.ts",
    ];
    for (const file of files) {
      const src = readFileSync(path.join(dir, file), "utf8");
      expect(src).not.toMatch(/includes\(["']tonight["']\)/);
      expect(src).not.toMatch(/includes\(["']this week["']\)/);
      expect(src).not.toMatch(/includes\(["']for now["']\)/);
      expect(src).not.toMatch(/new RegExp\([^)]*until/);
      expect(src).not.toMatch(/\/until\s+friday/i);
      expect(src).not.toMatch(/includes\(["']harder["']\)/);
      expect(src).not.toMatch(/includes\(["']easier["']\)/);
    }
  });

  it("no production state-write path imports the duration resolver", () => {
    const root = path.join(process.cwd(), "src");
    const productionFiles = [
      "app/api/cron/sms-inbound-coach/route.ts",
      "lib/v2-sms-pending-resolution-complete.ts",
      "lib/sol-goal-change-pending-open.ts",
      "lib/sol-goal-change-pending-confirm.ts",
      "lib/sol-goal-change-awaiting-candidate.ts",
      "lib/sol-goal-change-semantic-interpreter.ts",
    ];
    for (const rel of productionFiles) {
      const src = readFileSync(path.join(root, rel), "utf8");
      expect(src).not.toContain("resolveTemporaryOverlayExpiry");
      expect(src).not.toContain("sol-goal-change-temporary-duration");
    }
  });
});
