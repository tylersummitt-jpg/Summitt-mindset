import { describe, expect, it } from "vitest";

import {
  ADMIN_INTERPRETATION_LINE,
  RAW_NOTEBOOK_EMPTY_MESSAGE,
  RAW_NOTEBOOK_SECTION_LABEL,
  buildProvenanceExplanationBlocks,
  getRawNotebookSectionCopy,
  rawNotebookSectionContainsForbiddenAdminCopy,
} from "@/lib/tyler-text-overview-dashboard-sections";
import type { TylerTextOverviewAdminDraftRow } from "@/lib/tyler-text-overview-types";

function baseRow(
  overrides: Partial<TylerTextOverviewAdminDraftRow> = {}
): TylerTextOverviewAdminDraftRow {
  return {
    draftId: "draft-1",
    clerkUserId: "user-1",
    draftForDayKey: "2026-07-03",
    currentBodyToSend: null,
    writerOpenAiMessages: [],
    currentGenerationId: "gen-1",
    currentGenerationNumber: 1,
    latestGenerationId: "gen-1",
    latestGenerationNumber: 1,
    isLatestGeneration: true,
    writerPromptPath: null,
    notebookHash: null,
    notebookMessageCount: 0,
    notebookFamily: "writer_skipped",
    notebookDisplayMode: "writer_skipped_intentional",
    machineShouldSend: false,
    machineNoSendReason: "silence_cadence_space_day9",
    capturePresent: false,
    silenceCadenceRoute: "no_send_space_day9",
    silenceDay: 9,
    intentionalSpace: true,
    laneStage: "silence_cadence_no_send",
    ...overrides,
  };
}

describe("tyler-text-overview-dashboard-sections", () => {
  it("provenance includes admin interpretation line constant", () => {
    expect(ADMIN_INTERPRETATION_LINE).toBe("Admin interpretation — not sent to OpenAI.");
  });

  it("raw section with messages returns message.content unchanged", () => {
    const messages = [
      { role: "system" as const, content: "System prompt exact." },
      { role: "user" as const, content: "DAILY_SMS_WRITING_BRIEF_V1\n{}" },
    ];
    const copy = getRawNotebookSectionCopy(
      baseRow({
        writerOpenAiMessages: messages,
        notebookMessageCount: 2,
        notebookFamily: "daily_sms_writing_brief_v1",
        notebookDisplayMode: "exact_primary_input",
        machineShouldSend: true,
      })
    );
    expect(copy.messages).toEqual(messages);
    expect(copy.messages[0]?.content).toBe("System prompt exact.");
    expect(copy.messages[1]?.content).toBe("DAILY_SMS_WRITING_BRIEF_V1\n{}");
    expect(copy.label).toBe(RAW_NOTEBOOK_SECTION_LABEL);
    expect(copy.emptyMessage).toBeNull();
  });

  it("raw section copy excludes skip and send-blocked admin strings", () => {
    const copy = getRawNotebookSectionCopy(
      baseRow({
        writerOpenAiMessages: [
          { role: "system", content: "x" },
          { role: "user", content: "y" },
        ],
        notebookMessageCount: 2,
        notebookDisplayMode: "writer_ran_send_blocked",
        machineShouldSend: false,
        machineNoSendReason: "model_no_send",
      })
    );
    const rawText = [copy.label, copy.emptyMessage, ...copy.messages.map((m) => m.content)]
      .filter(Boolean)
      .join("\n");
    expect(rawNotebookSectionContainsForbiddenAdminCopy(rawText)).toBeNull();
  });

  it("empty raw section uses only the no-input message", () => {
    const copy = getRawNotebookSectionCopy(baseRow());
    expect(copy.emptyMessage).toBe(RAW_NOTEBOOK_EMPTY_MESSAGE);
    expect(copy.messages).toEqual([]);
    expect(rawNotebookSectionContainsForbiddenAdminCopy(copy.emptyMessage ?? "")).toBeNull();
  });

  it("skip and send-blocked explanations live in provenance blocks only", () => {
    const skipBlocks = buildProvenanceExplanationBlocks(baseRow());
    expect(skipBlocks.some((b) => b.text.includes("intentionally skipped"))).toBe(true);
    expect(skipBlocks.some((b) => b.text.includes("silence_cadence_space_day9"))).toBe(true);

    const blockedBlocks = buildProvenanceExplanationBlocks(
      baseRow({
        writerOpenAiMessages: [
          { role: "system", content: "s" },
          { role: "user", content: "u" },
        ],
        notebookMessageCount: 2,
        notebookFamily: "daily_sms_writing_brief_v1",
        notebookDisplayMode: "writer_ran_send_blocked",
        machineShouldSend: false,
        machineNoSendReason: "model_no_send",
      })
    );
    expect(blockedBlocks.some((b) => b.text.includes("send was blocked later"))).toBe(true);

    const staleBlocks = buildProvenanceExplanationBlocks(
      baseRow({
        isLatestGeneration: false,
        latestGenerationId: "gen-2",
        latestGenerationNumber: 2,
      })
    );
    expect(staleBlocks.some((b) => b.kind === "warning")).toBe(true);
  });
});
