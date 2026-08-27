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
  formatPersistedMessageForLine,
  getMorningBodyComparisonStatus,
  getMorningMachineDraftUnavailableReason,
  getMorningTechnicalRetrySectionCopy,
  getPersistedExactThreadMessages,
  getRawNotebookSectionCopy,
  getWeeklyRawNotebookSectionCopy,
  isMorningRelationshipNotebookRow,
  isSharedSolCoachingRow,
  shouldShowEveningMorningAnchorPanel,
  shouldShowMorningDualBodyPanels,
  shouldShowSolForensicPanels,
  rawNotebookSectionContainsForbiddenAdminCopy,
  MORNING_BODY_COMPARISON_DIFFERS,
  MORNING_BODY_COMPARISON_MATCH,
  MORNING_BODY_COMPARISON_TYLER_SAVE_MATCHES,
  MORNING_BODY_COMPARISON_GENERATION_FAILED,
  MORNING_BODY_COMPARISON_GENERATION_MISSING,
  MORNING_BODY_COMPARISON_INTENTIONAL_SPACE,
  MORNING_BRIEF_OBSERVATION_STATUS,
  TTO_INTERPRETER_OPENAI_ERROR_HEADING,
  TTO_WRITER_OPENAI_ERROR_HEADING,
  openAiErrorForensicLines,
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
    messageRequiredToday: null,
    laneStage: "silence_cadence_no_send",
    slotCoachingContext: null,
    morningBriefInterpreterV1: null,
    morningCoachingBriefV1: null,
    morningWriterCaptureV1: null,
    messageFor: null,
    morningRelationshipPacketV1: null,
    coachingStack: null,
    ...overrides,
  };
}

describe("tyler-text-overview-dashboard-sections", () => {
  it("provenance includes admin interpretation line constant", () => {
    expect(ADMIN_INTERPRETATION_LINE).toBe("Admin interpretation — not sent to OpenAI.");
  });

  it("exposes Phase 2D Brief-in-writer status copy", () => {
    expect(MORNING_BRIEF_OBSERVATION_STATUS).toBe(
      "COACHING BRIEF WAS INCLUDED IN THIS WRITER INPUT."
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

    const space = baseRow({
      currentBodyToSend: null,
      authoritativeMachineDraftBody: null,
      authoritativeMachineDraftStatus: "intentional_space",
      machineNoSendReason: "intentional_space",
      intentionalSpace: true,
      messageRequiredToday: false,
    });
    expect(getMorningBodyComparisonStatus(space)).toBe(MORNING_BODY_COMPARISON_INTENTIONAL_SPACE);
    expect(getMorningMachineDraftUnavailableReason(space)).toBe(
      MORNING_BODY_COMPARISON_INTENTIONAL_SPACE
    );
    expect(MORNING_BODY_COMPARISON_INTENTIONAL_SPACE).toMatch(/writer skipped/i);
    expect(MORNING_BODY_COMPARISON_INTENTIONAL_SPACE).not.toMatch(/silence.cadence/i);

    const required = baseRow({ messageRequiredToday: true });
    const blocks = buildProvenanceExplanationBlocks(required);
    expect(JSON.stringify(blocks)).toContain("REQUIRED TOUCH");

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

  it("E4: Evening Sol dual-body is data-gated and blank stays blank", () => {
    const eveningSol = baseRow({
      sendSlot: "evening_checkin",
      coachingStack: "shared_sol_v1",
      writerPromptPath: "morning_brief_writer_v1",
      morningCoachingBriefV1: { version: "morning_coaching_brief_v1", confidence: "low" },
      currentBodyToSend: null,
      currentBodySource: "tyler_edit",
      editedByTyler: true,
      authoritativeMachineDraftBody: "Machine evening A",
      authoritativeMachineDraftStatus: "available",
      machineShouldSend: true,
    });
    expect(isSharedSolCoachingRow(eveningSol)).toBe(true);
    expect(shouldShowMorningDualBodyPanels(eveningSol, true)).toBe(true);
    expect(shouldShowMorningDualBodyPanels(eveningSol, false)).toBe(false);
    expect(shouldShowSolForensicPanels(eveningSol)).toBe(true);
    expect(getMorningBodyComparisonStatus(eveningSol)).toBe(MORNING_BODY_COMPARISON_DIFFERS);

    const tylerEdit = baseRow({
      ...eveningSol,
      currentBodyToSend: "Have a good evening.",
    });
    expect(getMorningBodyComparisonStatus(tylerEdit)).toBe(MORNING_BODY_COMPARISON_DIFFERS);
    expect(formatMorningCurrentBodySourceLabel(tylerEdit)).toContain("Tyler edited");

    const legacyEvening = baseRow({
      sendSlot: "evening_checkin",
      coachingStack: null,
      writerPromptPath: "daily_writing_brief_v1",
      notebookFamily: "daily_sms_writing_brief_v1",
      morningCoachingBriefV1: null,
      morningBriefInterpreterV1: null,
      morningWriterCaptureV1: null,
      morningRelationshipPacketV1: null,
      morningAnchorSource: "sent_morning",
      morningAnchorBodyPreview: "old morning text",
    });
    expect(isSharedSolCoachingRow(legacyEvening)).toBe(false);
    expect(shouldShowMorningDualBodyPanels(legacyEvening, true)).toBe(false);
    expect(shouldShowSolForensicPanels(legacyEvening)).toBe(false);
    expect(shouldShowEveningMorningAnchorPanel(legacyEvening, true)).toBe(true);
    expect(shouldShowEveningMorningAnchorPanel(eveningSol, true)).toBe(false);
  });

  it("E4: protected orphan latest generation is not treated as current body", () => {
    const protectedOrphan = baseRow({
      sendSlot: "evening_checkin",
      coachingStack: "shared_sol_v1",
      currentGenerationId: "gen-authoritative",
      currentGenerationNumber: 1,
      latestGenerationId: "gen-orphan",
      latestGenerationNumber: 2,
      isLatestGeneration: false,
      currentBodyToSend: "Tyler B",
      currentBodySource: "tyler_edit",
      editedByTyler: true,
      authoritativeMachineDraftBody: "Machine A",
      authoritativeMachineDraftStatus: "available",
    });
    expect(protectedOrphan.isLatestGeneration).toBe(false);
    expect(protectedOrphan.currentBodyToSend).toBe("Tyler B");
    expect(protectedOrphan.authoritativeMachineDraftBody).toBe("Machine A");
    expect(protectedOrphan.authoritativeMachineDraftBody).not.toBe(
      protectedOrphan.currentBodyToSend
    );
    expect(getMorningBodyComparisonStatus(protectedOrphan)).toBe(MORNING_BODY_COMPARISON_DIFFERS);
  });

  it("E4: persisted message_for and exact_thread come from stored packet only", () => {
    const messageFor = {
      timezone: "America/New_York",
      local_date: "2026-08-06",
      local_weekday: "Thursday",
      daypart: "evening" as const,
    };
    expect(formatPersistedMessageForLine(messageFor)).toBe(
      "Thursday, 2026-08-06 · Evening · America/New_York"
    );
    expect(
      formatPersistedMessageForLine({
        ...messageFor,
        daypart: "weekly",
      })
    ).toBe("Thursday, 2026-08-06 · Weekly · America/New_York");
    expect(formatPersistedMessageForLine(null)).toBeNull();

    const packet = {
      version: "morning_relationship_packet_v1",
      message_for: messageFor,
      historical_evidence: [],
      exact_thread: {
        messages: [
          {
            sender: "coach",
            body: "Sent morning text",
            sent_at_local: "2026-08-06 08:00",
            local_weekday: "Thursday",
          },
          {
            sender: "user",
            body: "Received reply",
            sent_at_local: "2026-08-06 09:00",
            local_weekday: "Thursday",
          },
        ],
        omitted_older_turn_count: 0,
      },
    };
    const thread = getPersistedExactThreadMessages(packet);
    expect(thread).toHaveLength(2);
    expect(thread?.map((m) => m.body)).toEqual(["Sent morning text", "Received reply"]);
    expect(JSON.stringify(thread)).not.toContain("unsent Morning draft");
    expect(JSON.stringify(thread)).not.toContain("machine proposal");
    expect(getPersistedExactThreadMessages(null)).toBeNull();
    expect(getPersistedExactThreadMessages({ version: "x" })).toBeNull();
  });

  it("E4: Evening Sol forensic metadata absence is honest; retry shows when present", () => {
    const noMeta = baseRow({
      sendSlot: "evening_checkin",
      coachingStack: "shared_sol_v1",
      morningCoachingBriefV1: null,
      morningBriefInterpreterV1: null,
      morningWriterCaptureV1: null,
      morningRelationshipPacketV1: null,
      messageFor: null,
      authoritativeRetryOccurred: false,
      authoritativeRetryMessages: [],
    });
    expect(shouldShowSolForensicPanels(noMeta)).toBe(true);
    expect(formatPersistedMessageForLine(noMeta.messageFor)).toBeNull();
    expect(getPersistedExactThreadMessages(noMeta.morningRelationshipPacketV1)).toBeNull();
    expect(getMorningTechnicalRetrySectionCopy(noMeta).show).toBe(false);

    const withRetry = baseRow({
      sendSlot: "evening_checkin",
      coachingStack: "shared_sol_v1",
      authoritativeRetryOccurred: true,
      authoritativeRetryMessages: [
        { role: "assistant", content: "{bad" },
        { role: "user", content: "retry reminder" },
      ],
    });
    expect(getMorningTechnicalRetrySectionCopy(withRetry).show).toBe(true);

    const dashboard = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(dashboard).toContain("shouldShowSolForensicPanels");
    expect(dashboard).toContain("shouldShowEveningMorningAnchorPanel");
    expect(dashboard).toContain("PersistedMessageForPanel");
    expect(dashboard).toContain("PersistedRelationshipPacketPanel");
    expect(dashboard).not.toMatch(
      /function canEditEveningDraft[\s\S]{0,400}machineShouldSend !== true/
    );
    expect(dashboard).toContain("EVENING_CURRENT_BODY_BLANK");
    expect(dashboard).toContain("Tyler authority is independent of machine_should_send");
    expect(dashboard).toContain("eveningSendButtonLabel(false)");
    expect(dashboard).toContain('disabled\n                        title={eveningSendDisabledReason}');
    const saveDraftFn = dashboard.match(
      /async function saveDraft\([\s\S]*?\n  async function /
    )?.[0] ?? "";
    expect(saveDraftFn).toContain("/api/admin/tyler-text-overview/${encodeURIComponent(draftId)}");
    expect(saveDraftFn).not.toContain("evening-send");
    expect(saveDraftFn).not.toMatch(/openai/i);
  });

  it("openAiErrorForensicLines omits null/empty fields and keeps order", () => {
    expect(openAiErrorForensicLines(null)).toEqual([]);
    expect(
      openAiErrorForensicLines({
        name: null,
        message: null,
        status: null,
        code: null,
        type: null,
        requestId: null,
      })
    ).toEqual([]);
    expect(
      openAiErrorForensicLines({
        name: "APIError",
        message: "429 rate limit",
        status: 429,
        code: "rate_limit_exceeded",
        type: "insufficient_quota",
        requestId: "req_1",
      })
    ).toEqual([
      { label: "status", value: "429" },
      { label: "code", value: "rate_limit_exceeded" },
      { label: "type", value: "insufficient_quota" },
      { label: "name", value: "APIError" },
      { label: "request_id", value: "req_1" },
      { label: "message", value: "429 rate limit" },
    ]);
  });

  it("dashboard renders dedicated INTERPRETER/WRITER OPENAI ERROR blocks as escaped text", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(dashboard).toContain("TTO_INTERPRETER_OPENAI_ERROR_HEADING");
    expect(dashboard).toContain("TTO_WRITER_OPENAI_ERROR_HEADING");
    expect(dashboard).toContain("OpenAiErrorForensicBlock");
    expect(dashboard).toContain("openAiErrorForensicLines");
    expect(dashboard).toContain("{line.value}");
    expect(dashboard).not.toMatch(/dangerouslySetInnerHTML/);
    expect(dashboard).not.toMatch(/OpenAI error.*formatBriefValue|BriefField label=\"OpenAI error\"/);
    expect(TTO_INTERPRETER_OPENAI_ERROR_HEADING).toBe("INTERPRETER OPENAI ERROR");
    expect(TTO_WRITER_OPENAI_ERROR_HEADING).toBe("WRITER OPENAI ERROR");
  });

  it("dashboard surfaces quiet relationship clock clamp fields", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(dashboard).toContain("quiet_relationship_eligible");
    expect(dashboard).toContain("interpreter proactive_decision");
    expect(dashboard).toContain("final proactive_decision");
    expect(dashboard).toContain("clock_lookup_failed");
    expect(dashboard).toContain("clock_lookup_error");
    expect(dashboard).toContain("days_since_last_successful_proactive_send");
    expect(dashboard).toContain("required_touch");
  });
});
