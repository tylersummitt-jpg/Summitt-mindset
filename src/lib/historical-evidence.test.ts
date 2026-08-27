import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn() },
}));

import {
  EMPTY_HISTORICAL_EVIDENCE,
  HISTORICAL_EVIDENCE_HISTORY_LAW,
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
