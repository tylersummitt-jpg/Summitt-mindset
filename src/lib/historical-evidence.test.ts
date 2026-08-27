import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  EMPTY_HISTORICAL_EVIDENCE,
  HISTORICAL_EVIDENCE_HISTORY_LAW,
  mergeHistoricalEvidenceChronologically,
  type HistoricalEvidenceChronologyCarrier,
  type HistoricalEvidenceItem,
} from "@/lib/historical-evidence";
import { MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT } from "@/lib/morning-tto-brief-interpreter-v1";
import { INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT } from "@/lib/inbound-sol-brief-interpreter";
import { WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT } from "@/lib/weekly-tto-brief-interpreter";
import { MORNING_TTO_SYSTEM_PROMPT } from "@/lib/morning-tto-writer";
import { INBOUND_SOL_WRITER_SYSTEM_PROMPT } from "@/lib/inbound-sol-writer";
import { WEEKLY_TTO_SYSTEM_PROMPT } from "@/lib/weekly-tto-writer";

describe("historical-evidence contract", () => {
  it("empty slice is frozen so callers cannot push into the shared []", () => {
    expect(EMPTY_HISTORICAL_EVIDENCE).toEqual([]);
    expect(Object.isFrozen(EMPTY_HISTORICAL_EVIDENCE)).toBe(true);
    expect(() => {
      (EMPTY_HISTORICAL_EVIDENCE as HistoricalEvidenceItem[]).push({
        source: "user_message",
        occurred_at: "2026-01-01",
        evidence: "nope",
      });
    }).toThrow();
  });

  it("HISTORY LAW is field-scoped and does not ban exact_thread callbacks", () => {
    expect(HISTORICAL_EVIDENCE_HISTORY_LAW).toContain("packet/input field historical_evidence");
    expect(HISTORICAL_EVIDENCE_HISTORY_LAW).toContain("exact_thread is the current conversation");
    expect(HISTORICAL_EVIDENCE_HISTORY_LAW).toContain(
      "If historical_evidence is empty, ignore it and coach as you do today"
    );
    expect(HISTORICAL_EVIDENCE_HISTORY_LAW).not.toMatch(/don't mention history/i);
    expect(HISTORICAL_EVIDENCE_HISTORY_LAW).toContain("source=win");
    expect(HISTORICAL_EVIDENCE_HISTORY_LAW).toContain("source=user_message");
  });

  it("interpreter and writer prompts share the field-scoped HISTORY LAW", () => {
    const prompts = [
      MORNING_BRIEF_INTERPRETER_SYSTEM_PROMPT,
      INBOUND_SOL_INTERPRETER_SYSTEM_PROMPT,
      WEEKLY_BRIEF_INTERPRETER_SYSTEM_PROMPT,
      MORNING_TTO_SYSTEM_PROMPT,
      INBOUND_SOL_WRITER_SYSTEM_PROMPT,
      WEEKLY_TTO_SYSTEM_PROMPT,
    ];
    for (const p of prompts) {
      expect(p).toContain(HISTORICAL_EVIDENCE_HISTORY_LAW);
      expect(p).toContain("exact_thread is the current conversation");
      expect(p).toContain("packet/input field historical_evidence");
    }
  });
});

function carrier(
  overrides: Partial<HistoricalEvidenceChronologyCarrier> & {
    id: string;
    item: HistoricalEvidenceItem;
  }
): HistoricalEvidenceChronologyCarrier {
  return {
    occurred_at_ms: Date.parse(`${overrides.item.occurred_at}T12:00:00.000Z`),
    ...overrides,
  };
}

describe("mergeHistoricalEvidenceChronologically", () => {
  const user = (id: string, day: string, ms: number): HistoricalEvidenceChronologyCarrier =>
    carrier({
      id,
      occurred_at_ms: ms,
      item: {
        source: "user_message",
        occurred_at: day,
        evidence: `user ${id}`,
        user_quote: `user ${id}`,
      },
    });
  const win = (id: string, day: string, ms: number): HistoricalEvidenceChronologyCarrier =>
    carrier({
      id,
      occurred_at_ms: ms,
      item: {
        source: "win",
        occurred_at: day,
        evidence: `win ${id}`,
      },
    });

  it("empty", () => {
    expect(mergeHistoricalEvidenceChronologically([], [])).toBe(EMPTY_HISTORICAL_EVIDENCE);
  });

  it("only user evidence", () => {
    expect(mergeHistoricalEvidenceChronologically([user("u1", "2026-01-02", 2)], [])).toEqual([
      {
        source: "user_message",
        occurred_at: "2026-01-02",
        evidence: "user u1",
        user_quote: "user u1",
      },
    ]);
  });

  it("only Wins", () => {
    expect(mergeHistoricalEvidenceChronologically([], [win("w1", "2026-01-01", 1)])).toEqual([
      { source: "win", occurred_at: "2026-01-01", evidence: "win w1" },
    ]);
  });

  it("both, chronological order", () => {
    const merged = mergeHistoricalEvidenceChronologically(
      [user("u1", "2026-03-01", 300)],
      [win("w1", "2026-01-01", 100), win("w2", "2026-04-01", 400)]
    );
    expect(merged.map((i) => i.evidence)).toEqual(["win w1", "user u1", "win w2"]);
  });

  it("same local calendar day keeps both and orders by timestamp then id", () => {
    const merged = mergeHistoricalEvidenceChronologically(
      [user("u-later", "2026-08-18", 2_000)],
      [win("w-earlier", "2026-08-18", 1_000)]
    );
    expect(merged.map((i) => i.source)).toEqual(["win", "user_message"]);
    expect(merged.map((i) => i.occurred_at)).toEqual(["2026-08-18", "2026-08-18"]);
  });

  it("deterministic id tie-break at the same timestamp", () => {
    const merged = mergeHistoricalEvidenceChronologically(
      [user("b", "2026-08-18", 50)],
      [win("a", "2026-08-18", 50)]
    );
    expect(merged.map((i) => i.evidence)).toEqual(["win a", "user b"]);
  });

  it("schema unchanged — model items have only source, occurred_at, evidence, optional user_quote", () => {
    const merged = mergeHistoricalEvidenceChronologically(
      [user("u1", "2026-01-02", 2)],
      [win("w1", "2026-01-01", 1)]
    );
    for (const item of merged) {
      expect(Object.keys(item).sort()).toEqual(
        item.user_quote ? ["evidence", "occurred_at", "source", "user_quote"] : ["evidence", "occurred_at", "source"]
      );
      expect(item).not.toHaveProperty("occurred_at_ms");
      expect(item).not.toHaveProperty("id");
    }
  });
});
