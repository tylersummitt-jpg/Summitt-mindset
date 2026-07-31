import { describe, expect, it } from "vitest";

import {
  deriveNotebookDisplayMode,
  deriveNotebookFamily,
  hasExactPrimaryWriterInput,
  isLegacyAssistantOnlyWriterCapture,
  notebookDisplayHeadline,
  notebookDisplaySubtext,
  notebookFamilyLabel,
} from "@/lib/tyler-text-overview-notebook-display";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRIEF_USER = {
  role: "user" as const,
  content: "DAILY_SMS_WRITING_BRIEF_V1 (server truth — not copyable prose):\n{}",
};

const LEGACY_USER = {
  role: "user" as const,
  content: "RELATIONSHIP_PACKET_V1\n{}\nRELATIONSHIP_SNAPSHOT_V2\n{}",
};

const SYSTEM = { role: "system" as const, content: "You are a coach." };

describe("hasExactPrimaryWriterInput / legacy assistant-only", () => {
  it("detects exact system+user primary input", () => {
    expect(hasExactPrimaryWriterInput([SYSTEM, LEGACY_USER])).toBe(true);
    expect(hasExactPrimaryWriterInput([])).toBe(false);
    expect(hasExactPrimaryWriterInput([{ role: "assistant", content: "hi" }])).toBe(false);
  });

  it("detects legacy assistant-only weekly captures", () => {
    expect(
      isLegacyAssistantOnlyWriterCapture([{ role: "assistant", content: "candidate body" }])
    ).toBe(true);
    expect(isLegacyAssistantOnlyWriterCapture([SYSTEM, LEGACY_USER])).toBe(false);
    expect(isLegacyAssistantOnlyWriterCapture([])).toBe(false);
  });
});

describe("deriveNotebookFamily", () => {
  it("daily_writing_brief_v1 + 2 messages => daily_sms_writing_brief_v1", () => {
    expect(
      deriveNotebookFamily({
        messageCount: 2,
        writerPromptPath: "daily_writing_brief_v1",
        messages: [SYSTEM, BRIEF_USER],
      })
    ).toBe("daily_sms_writing_brief_v1");
  });

  it("messages containing DAILY_SMS_WRITING_BRIEF_V1 => daily_sms_writing_brief_v1", () => {
    expect(
      deriveNotebookFamily({
        messageCount: 2,
        writerPromptPath: null,
        messages: [SYSTEM, BRIEF_USER],
      })
    ).toBe("daily_sms_writing_brief_v1");
  });

  it("legacy_packet_v1 + 2 messages => legacy_relationship_packet_v1", () => {
    expect(
      deriveNotebookFamily({
        messageCount: 2,
        writerPromptPath: "legacy_packet_v1",
        messages: [SYSTEM, LEGACY_USER],
      })
    ).toBe("legacy_relationship_packet_v1");
  });

  it("messages containing RELATIONSHIP_PACKET_V1 => legacy_relationship_packet_v1", () => {
    expect(
      deriveNotebookFamily({
        messageCount: 2,
        writerPromptPath: null,
        messages: [SYSTEM, LEGACY_USER],
      })
    ).toBe("legacy_relationship_packet_v1");
  });

  it("morning_relationship_v1 + MORNING_RELATIONSHIP_PACKET_V1 marker", () => {
    expect(
      deriveNotebookFamily({
        messageCount: 2,
        writerPromptPath: "morning_relationship_v1",
        messages: [
          SYSTEM,
          {
            role: "user",
            content: "MORNING_RELATIONSHIP_PACKET_V1\n{}",
          },
        ],
      })
    ).toBe("morning_relationship_v1");
    expect(notebookFamilyLabel("morning_relationship_v1")).toBe(
      "Morning relationship packet v1"
    );
  });

  it("0 messages => writer_skipped", () => {
    expect(
      deriveNotebookFamily({
        messageCount: 0,
        writerPromptPath: null,
        messages: [],
      })
    ).toBe("writer_skipped");
  });
});

describe("deriveNotebookDisplayMode", () => {
  it("0 messages + intentional_space true => writer_skipped_intentional", () => {
    expect(
      deriveNotebookDisplayMode({
        messageCount: 0,
        machineShouldSend: false,
        machineNoSendReason: "silence_cadence_space_day9",
        capturePresent: false,
        intentionalSpace: true,
        skipSource: "silence_cadence_no_send",
      })
    ).toBe("writer_skipped_intentional");
  });

  it("0 messages + silence_cadence_space_day9 => writer_skipped_intentional", () => {
    expect(
      deriveNotebookDisplayMode({
        messageCount: 0,
        machineShouldSend: false,
        machineNoSendReason: "silence_cadence_space_day9",
        capturePresent: false,
        intentionalSpace: null,
        skipSource: null,
      })
    ).toBe("writer_skipped_intentional");
  });

  it("0 messages + unknown reason => writer_skipped_unknown", () => {
    expect(
      deriveNotebookDisplayMode({
        messageCount: 0,
        machineShouldSend: false,
        machineNoSendReason: "not_v2",
        capturePresent: false,
        intentionalSpace: null,
        skipSource: null,
      })
    ).toBe("writer_skipped_unknown");
  });

  it("messages > 0 + machine_should_send false => writer_ran_send_blocked", () => {
    expect(
      deriveNotebookDisplayMode({
        messageCount: 2,
        machineShouldSend: false,
        machineNoSendReason: "model_no_send",
        capturePresent: true,
        intentionalSpace: null,
        skipSource: null,
      })
    ).toBe("writer_ran_send_blocked");
  });

  it("messages > 0 + machine_should_send true => exact_primary_input", () => {
    expect(
      deriveNotebookDisplayMode({
        messageCount: 2,
        machineShouldSend: true,
        machineNoSendReason: null,
        capturePresent: true,
        intentionalSpace: null,
        skipSource: null,
      })
    ).toBe("exact_primary_input");
  });
});

describe("notebook labels", () => {
  it("exposes readable family and display labels", () => {
    expect(notebookFamilyLabel("daily_sms_writing_brief_v1")).toContain("Brief");
    expect(notebookDisplayHeadline("exact_primary_input")).toContain("Exact primary");
    expect(notebookDisplaySubtext("writer_skipped_intentional")).toContain("intentional no-send");
  });
});

describe("morning dashboard unchanged by weekly helpers", () => {
  it("morning dashboard still uses shared morning notebook helpers only", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx"),
      "utf8"
    );
    expect(src).toContain("getRawNotebookSectionCopy");
    expect(src).not.toContain("getWeeklyRawNotebookSectionCopy");
    expect(src).toContain("buildProvenanceExplanationBlocks");
    expect(src).not.toContain("buildWeeklyProvenanceExplanationBlocks");
  });
});
