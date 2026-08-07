import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ADMIN_INTERPRETATION_LINE,
  RAW_NOTEBOOK_EMPTY_MESSAGE,
  RAW_NOTEBOOK_SECTION_LABEL,
  WEEKLY_EXACT_WRITER_INPUT_HEADING,
  WEEKLY_RAW_NOTEBOOK_LEGACY_OR_MISSING_MESSAGE,
  buildProvenanceExplanationBlocks,
  buildWeeklyProvenanceExplanationBlocks,
  formatMorningCurrentBodySourceLabel,
  getMorningBodyComparisonStatus,
  getMorningMachineDraftUnavailableReason,
  getMorningTechnicalRetrySectionCopy,
  getRawNotebookSectionCopy,
  getWeeklyRawNotebookSectionCopy,
  isMorningRelationshipNotebookRow,
  shouldShowMorningDualBodyPanels,
  rawNotebookSectionContainsForbiddenAdminCopy,
  MORNING_BODY_COMPARISON_DIFFERS,
  MORNING_BODY_COMPARISON_MATCH,
  MORNING_BODY_COMPARISON_TYLER_SAVE_MATCHES,
  MORNING_BODY_COMPARISON_GENERATION_FAILED,
  MORNING_BODY_COMPARISON_GENERATION_MISSING,
  MORNING_BRIEF_OBSERVATION_STATUS,
} from "@/lib/tyler-text-overview-dashboard-sections";
import type { TylerTextOverviewAdminDraftRow } from "@/lib/tyler-text-overview-types";

function baseRow(
  overrides: Partial<TylerTextOverviewAdminDraftRow> = {}
): TylerTextOverviewAdminDraftRow {
  return {
    draftId: "draft-1",
    clerkUserId: "user-1",
    preferredName: null,
    phoneNumber: null,
    timezone: null,
    rowState: "draft_current",
    draftForDayKey: "2026-07-03",
    sendSlot: "morning",
    draftStatus: "current",
    sentAt: null,
    finalBodySent: null,
    twilioMessageSid: null,
    sourceSmsSendEventId: null,
    currentBodyToSend: null,
    currentBodySource: null,
    editedByTyler: false,
    editedAt: null,
    writerOpenAiMessages: [],
    authoritativeRetryMessages: [],
    authoritativeMachineDraftBody: null,
    authoritativeMachineDraftStatus: null,
    authoritativeWriterModel: null,
    authoritativeRetryOccurred: null,
    authoritativeGeneratedAt: null,
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
    slotCoachingContext: null,
    morningBriefInterpreterV1: null,
    morningCoachingBriefV1: null,
    morningWriterCaptureV1: null,
    ...overrides,
  };
}

describe("tyler-text-overview-dashboard-sections", () => {
  it("provenance includes admin interpretation line constant", () => {
    expect(ADMIN_INTERPRETATION_LINE).toBe("Admin interpretation — not sent to OpenAI.");
  });

  it("exposes Phase 2D Brief-in-writer status copy", () => {
    expect(MORNING_BRIEF_OBSERVATION_STATUS).toBe(
      "MORNING COACHING BRIEF WAS INCLUDED IN THIS WRITER INPUT."
    );
    expect(MORNING_BRIEF_OBSERVATION_STATUS).not.toMatch(/OBSERVATION ONLY/);
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

  it("no_draft_yet provenance does not claim OpenAI writer was not called", () => {
    const blocks = buildProvenanceExplanationBlocks(
      baseRow({
        draftId: null,
        rowState: "no_draft_yet",
        notebookDisplayMode: "writer_skipped_unknown",
        notebookFamily: "writer_skipped",
        writerOpenAiMessages: [],
        notebookMessageCount: 0,
      })
    );
    const text = blocks.map((b) => b.text).join("\n");
    expect(text).toContain("MISSING MORNING DRAFT — GENERATION INCOMPLETE");
    expect(text).not.toContain("OpenAI writer was not called");
  });

  it("generation linkage error is explicit and not remapped to no-draft copy", () => {
    const blocks = buildProvenanceExplanationBlocks(
      baseRow({
        generationLinkageError: true,
        currentGenerationId: "gen-missing",
      })
    );
    const text = blocks.map((b) => b.text).join("\n");
    expect(text).toContain("GENERATION LINKAGE ERROR");
    expect(text).not.toContain("MISSING MORNING DRAFT");
  });
});

describe("weekly raw notebook / provenance", () => {
  it("shows exact system/user messages for new weekly captures", () => {
    const messages = [
      { role: "system" as const, content: "Weekly system." },
      { role: "user" as const, content: "RELATIONSHIP_PACKET_V1\n{}" },
    ];
    const copy = getWeeklyRawNotebookSectionCopy(
      baseRow({
        writerOpenAiMessages: messages,
        notebookMessageCount: 2,
        writerPromptPath: "v3_weekly_relationship_lane",
        notebookDisplayMode: "exact_primary_input",
        machineShouldSend: true,
        machineNoSendReason: null,
      })
    );
    expect(copy.isExactPrimaryInput).toBe(true);
    expect(copy.heading).toBe(WEEKLY_EXACT_WRITER_INPUT_HEADING);
    expect(copy.messages).toEqual(messages);
    expect(copy.emptyMessage).toBeNull();
  });

  it("degrades gracefully for legacy assistant-only weekly rows", () => {
    const copy = getWeeklyRawNotebookSectionCopy(
      baseRow({
        writerOpenAiMessages: [{ role: "assistant", content: "old candidate body" }],
        notebookMessageCount: 1,
        writerPromptPath: "v3_weekly_relationship_lane",
        notebookDisplayMode: "exact_primary_input",
        machineShouldSend: true,
      })
    );
    expect(copy.isExactPrimaryInput).toBe(false);
    expect(copy.messages).toEqual([]);
    expect(copy.emptyMessage).toBe(WEEKLY_RAW_NOTEBOOK_LEGACY_OR_MISSING_MESSAGE);
  });

  it("sent and no-send rows still get weekly provenance", () => {
    const noSend = buildWeeklyProvenanceExplanationBlocks(
      baseRow({
        writerOpenAiMessages: [
          { role: "system", content: "s" },
          { role: "user", content: "RELATIONSHIP_PACKET_V1" },
        ],
        notebookMessageCount: 2,
        notebookDisplayMode: "writer_ran_send_blocked",
        machineShouldSend: false,
        machineNoSendReason: "model_no_send",
      })
    );
    expect(noSend.some((b) => b.text.includes("blocked") || b.text.includes("Exact"))).toBe(true);

    const legacy = buildWeeklyProvenanceExplanationBlocks(
      baseRow({
        writerOpenAiMessages: [{ role: "assistant", content: "legacy" }],
        notebookMessageCount: 1,
        machineShouldSend: true,
        draftStatus: "sent",
        rowState: "draft_sent",
      })
    );
    expect(legacy.some((b) => b.text.includes(WEEKLY_RAW_NOTEBOOK_LEGACY_OR_MISSING_MESSAGE))).toBe(
      true
    );
  });

  it("weekly dashboard uses weekly helpers and role-labeled messages", () => {
    const src = readFileSync(
      join(
        process.cwd(),
        "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"
      ),
      "utf8"
    );
    expect(src).toContain("getWeeklyRawNotebookSectionCopy");
    expect(src).toContain("buildWeeklyProvenanceExplanationBlocks");
    expect(src).toContain("notebookRoleLabel");
    expect(src).not.toContain("JSON.stringify(rawNotebook.messages");
  });

  it("Morning relationship sections keep current body, machine draft, and retry separate", () => {
    const morning = baseRow({
      notebookFamily: "morning_relationship_v1",
      writerPromptPath: "morning_relationship_v1",
      notebookDisplayMode: "exact_primary_input",
      currentBodyToSend: "Tyler will send this",
      currentBodySource: "tyler_edit",
      editedByTyler: true,
      authoritativeMachineDraftBody: "Machine originally wrote this",
      authoritativeMachineDraftStatus: "available",
      authoritativeRetryOccurred: true,
      authoritativeRetryMessages: [
        { role: "assistant", content: "{bad" },
        { role: "user", content: "retry reminder exact" },
      ],
      writerOpenAiMessages: [
        { role: "system", content: "system exact" },
        { role: "user", content: "MORNING_RELATIONSHIP_PACKET_V1\n{\"x\":1}" },
      ],
      notebookMessageCount: 2,
      machineShouldSend: true,
    });

    expect(isMorningRelationshipNotebookRow(morning)).toBe(true);
    expect(shouldShowMorningDualBodyPanels(morning, false)).toBe(true);
    expect(shouldShowMorningDualBodyPanels(morning, true)).toBe(false);
    expect(formatMorningCurrentBodySourceLabel(morning)).toContain("Tyler edited");
    expect(getMorningBodyComparisonStatus(morning)).toBe(MORNING_BODY_COMPARISON_DIFFERS);
    const retry = getMorningTechnicalRetrySectionCopy(morning);
    expect(retry.show).toBe(true);
    expect(retry.label).toContain("Technical JSON retry context");
    expect(retry.messages[1]?.content).toBe("retry reminder exact");

    const raw = getRawNotebookSectionCopy(morning);
    expect(raw.messages).toHaveLength(2);
    expect(raw.messages.map((m) => m.content).join("\n")).not.toContain("retry reminder exact");
    expect(raw.messages.map((m) => m.content).join("\n")).not.toContain(
      "Machine originally wrote this"
    );

    const noRetry = getMorningTechnicalRetrySectionCopy(
      baseRow({
        notebookFamily: "morning_relationship_v1",
        writerPromptPath: "morning_relationship_v1",
        authoritativeRetryOccurred: false,
        authoritativeRetryMessages: [],
      })
    );
    expect(noRetry.show).toBe(false);
  });

  it("equality never suppresses dual body panels; comparison label only changes", () => {
    const identical = baseRow({
      currentBodyToSend: "Same body",
      authoritativeMachineDraftBody: "Same body",
      authoritativeMachineDraftStatus: "available",
      currentBodySource: "machine",
      editedByTyler: false,
    });
    expect(shouldShowMorningDualBodyPanels(identical, false)).toBe(true);
    expect(getMorningBodyComparisonStatus(identical)).toBe(MORNING_BODY_COMPARISON_MATCH);

    const tylerSavedSame = baseRow({
      currentBodyToSend: "Same body",
      authoritativeMachineDraftBody: "Same body",
      authoritativeMachineDraftStatus: "available",
      currentBodySource: "tyler_edit",
      editedByTyler: true,
    });
    expect(shouldShowMorningDualBodyPanels(tylerSavedSame, false)).toBe(true);
    expect(getMorningBodyComparisonStatus(tylerSavedSame)).toBe(
      MORNING_BODY_COMPARISON_TYLER_SAVE_MATCHES
    );

    const failed = baseRow({
      currentBodyToSend: null,
      authoritativeMachineDraftBody: null,
      authoritativeMachineDraftStatus: "generation_failed",
      machineNoSendReason: "invalid_json",
    });
    expect(shouldShowMorningDualBodyPanels(failed, false)).toBe(true);
    expect(getMorningBodyComparisonStatus(failed)).toBe(MORNING_BODY_COMPARISON_GENERATION_FAILED);
    expect(getMorningMachineDraftUnavailableReason(failed)).toContain("invalid_json");

    const missingGen = baseRow({
      authoritativeMachineDraftBody: null,
      authoritativeMachineDraftStatus: "generation_missing",
      currentGenerationId: "gen-missing",
    });
    expect(getMorningBodyComparisonStatus(missingGen)).toBe(
      MORNING_BODY_COMPARISON_GENERATION_MISSING
    );
  });

  it("Morning dashboard always renders both body sections and comparison", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(src).toContain("shouldShowMorningDualBodyPanels");
    expect(src).toContain("MORNING_CURRENT_BODY_HEADING");
    expect(src).toContain("MORNING_ORIGINAL_MACHINE_DRAFT_HEADING");
    expect(src).toContain("MORNING_BODY_COMPARISON_HEADING");
    expect(src).toContain("MorningOriginalMachineDraftPanel");
    expect(src).toContain("MorningBodyComparisonPanel");
    expect(src).toContain("authoritativeMachineDraftBody");
    expect(src).not.toContain("authoritativeMachineDraftBody ?? row.currentBodyToSend");
    expect(src).not.toContain("authoritativeMachineDraftBody || row.currentBodyToSend");
    expect(src).not.toMatch(/authoritativeMachineDraftBody\s*!==\s*.*currentBodyToSend[\s\S]{0,80}MorningOriginal/);
    expect(src).not.toContain("reconstruct");
  });
});
