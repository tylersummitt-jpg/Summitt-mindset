/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TylerTextOverviewDashboard from "@/app/admin/tyler-text-overview/tyler-text-overview-dashboard";
import TylerTextOverviewWeeklyDashboard from "@/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard";
import {
  MORNING_ORIGINAL_MACHINE_DRAFT_HEADING,
  TTO_CURRENT_BODY_COPY_PASTE_LABEL,
} from "@/lib/tyler-text-overview-dashboard-sections";
import type { TylerTextOverviewAdminDraftRow } from "@/lib/tyler-text-overview-types";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "draft_for_day_key" ? "2026-10-05" : null),
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
}));

const DAY = "2026-10-05";
const MACHINE_BODY = "MACHINE ORIGINAL — not the current outgoing SMS";
const WRITER_RAW = "WRITER_RAW_NOT_THE_OUTGOING_SMS";
const TYLER_SAVED = "Tyler saved this exact outgoing line.";
const TYLER_UNSAVED = "Tyler unsaved edit that must copy.";

const fetchUrls: string[] = [];
let nextRows: TylerTextOverviewAdminDraftRow[] = [];

function adminRow(
  overrides: Partial<TylerTextOverviewAdminDraftRow> &
    Pick<TylerTextOverviewAdminDraftRow, "sendSlot" | "currentBodyToSend">
): TylerTextOverviewAdminDraftRow {
  return {
    draftId: "draft-stacy",
    clerkUserId: "user_stacy",
    preferredName: "Stacy",
    phoneNumber: "+15551110001",
    timezone: "America/New_York",
    rowState: "draft_current",
    draftForDayKey: DAY,
    draftStatus: "current",
    sentAt: null,
    finalBodySent: null,
    twilioMessageSid: null,
    sourceSmsSendEventId: null,
    currentBodySource: "tyler_edit",
    editedByTyler: true,
    editedAt: "2026-10-05T12:00:00.000Z",
    writerOpenAiMessages: [],
    authoritativeRetryMessages: [],
    authoritativeMachineDraftBody: MACHINE_BODY,
    authoritativeMachineDraftStatus: "available",
    authoritativeWriterModel: "gpt-test",
    authoritativeRetryOccurred: null,
    authoritativeGeneratedAt: null,
    currentGenerationId: "gen-1",
    currentGenerationNumber: 1,
    latestGenerationId: "gen-1",
    latestGenerationNumber: 1,
    isLatestGeneration: true,
    writerPromptPath: "morning_brief_writer_v1",
    notebookHash: null,
    notebookMessageCount: 0,
    notebookFamily: "morning_relationship_v1",
    notebookDisplayMode: "writer_skipped_unknown",
    machineShouldSend: true,
    machineNoSendReason: null,
    capturePresent: true,
    silenceCadenceRoute: null,
    silenceDay: null,
    intentionalSpace: null,
    messageRequiredToday: null,
    laneStage: null,
    slotCoachingContext: null,
    morningBriefInterpreterV1: null,
    morningCoachingBriefV1: { confidence: "low" },
    morningWriterCaptureV1: {
      model: "gpt-test",
      temperature: null,
      reasoningEffort: null,
      maxCompletionTokens: null,
      latencyMs: null,
      error: null,
      openaiError: null,
      rawResponse: WRITER_RAW,
      rawRetryResponse: null,
      retryOccurred: false,
      retrySucceeded: null,
    },
    messageFor: null,
    morningRelationshipPacketV1: null,
    coachingStack: "shared_sol_v1",
    weekKey: "2026-10-05",
    weekStart: "2026-09-29",
    weekEnd: DAY,
    ...overrides,
  };
}

function listBody(rows: TylerTextOverviewAdminDraftRow[]) {
  return {
    ok: true,
    rows,
    counts: {
      sendableUsers: 1,
      noDraftYet: 0,
      draftCurrent: 1,
      draftCurrentReady: 1,
      draftCurrentTylerBlanked: 0,
      draftSent: 0,
      draftSkipped: 0,
      machineShouldSendTrue: 1,
      machineShouldSendFalse: 0,
      generationLinkageErrors: 0,
      draftsMarkedSentDayTotal: 0,
      twilioAcceptedDayTotal: 0,
    },
    availableDayKeys: [DAY],
    manifest: {
      manifestComplete: true,
      lastRefreshedAt: "2026-10-05T12:00:00.000Z",
    },
  };
}

function copyMirror(card: HTMLElement): HTMLElement {
  const pre = within(card).getByTestId("tto-current-body-copy");
  expect(pre.tagName).toBe("PRE");
  expect(pre.textContent).not.toContain(TTO_CURRENT_BODY_COPY_PASTE_LABEL);
  const label = within(card).getByText(TTO_CURRENT_BODY_COPY_PASTE_LABEL);
  expect(pre.contains(label)).toBe(false);
  return pre;
}

function editor(card: HTMLElement): HTMLTextAreaElement {
  const box = within(card).getByRole("textbox");
  expect(box.tagName).toBe("TEXTAREA");
  return box as HTMLTextAreaElement;
}

function expectNoSendOrSaveRequest() {
  expect(fetchUrls.some((url) => url.includes("/weekly-send"))).toBe(false);
  expect(fetchUrls.some((url) => url.includes("/evening-send"))).toBe(false);
  expect(fetchUrls.some((url) => /\/tyler-text-overview\/draft-/.test(url))).toBe(false);
  expect(fetchUrls.every((url) => url.includes("/api/admin/tyler-text-overview?"))).toBe(true);
}

async function openPage(page: "morning" | "evening" | "weekly") {
  if (page === "weekly") {
    render(<TylerTextOverviewWeeklyDashboard />);
  } else {
    render(
      <TylerTextOverviewDashboard
        sendSlot={
          page === "morning"
            ? SMS_DAILY_PRODUCTION_SEND_SLOT
            : SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
        }
      />
    );
  }
  const card = (await screen.findByText("Stacy")).closest("li");
  if (!card) throw new Error("missing row card");
  return card;
}

beforeEach(() => {
  fetchUrls.length = 0;
  nextRows = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    fetchUrls.push(String(input));
    const rows = nextRows;
    return Promise.resolve({
      ok: true,
      json: async () => listBody(rows),
    });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("current body copy/paste mirror", () => {
  it("keeps the mirror bound to the live editor string in both dashboards", () => {
    const labelSource = readFileSync(
      join(process.cwd(), "src/lib/tyler-text-overview-dashboard-sections.ts"),
      "utf8"
    );
    expect(labelSource).toContain(
      `export const TTO_CURRENT_BODY_COPY_PASTE_LABEL = "${TTO_CURRENT_BODY_COPY_PASTE_LABEL}"`
    );
    for (const file of [
      "src/app/admin/tyler-text-overview/tyler-text-overview-dashboard.tsx",
      "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      const marker = 'data-testid="tto-current-body-copy"';
      const at = src.indexOf(marker);
      expect(at).toBeGreaterThan(-1);
      const block = src.slice(Math.max(0, at - 250), at + 400);
      expect(block).toContain('{edits[row.draftId as string] ?? ""}');
      expect(block).toContain("TTO_CURRENT_BODY_COPY_PASTE_LABEL");
      expect(block).not.toContain("authoritativeMachineDraftBody");
      expect(block).not.toContain("rawResponse");
      expect(block).not.toContain("—");
    }
  });

  it.each(["morning", "evening", "weekly"] as const)(
    "%s renders the saved Tyler body as ordinary text and keeps the machine draft separate",
    async (page) => {
      nextRows = [
        adminRow({
          sendSlot:
            page === "morning"
              ? "morning"
              : page === "evening"
                ? "evening_checkin"
                : "weekly_review",
          currentBodyToSend: TYLER_SAVED,
          notebookFamily: page === "weekly" ? "weekly_relationship_v1" : "morning_relationship_v1",
        }),
      ];
      const card = await openPage(page);
      const pre = copyMirror(card);
      expect(pre.textContent).toBe(TYLER_SAVED);
      expect(editor(card).value).toBe(TYLER_SAVED);
      expect(pre.textContent).not.toBe(MACHINE_BODY);
      expect(pre.textContent).not.toContain(WRITER_RAW);

      if (page === "weekly") {
        expect(screen.queryByText(MACHINE_BODY)).toBeNull();
        expect(screen.queryByText(WRITER_RAW)).toBeNull();
        expect(screen.queryByText(MORNING_ORIGINAL_MACHINE_DRAFT_HEADING)).toBeNull();
      } else {
        expect(within(card).getByText(MORNING_ORIGINAL_MACHINE_DRAFT_HEADING)).toBeTruthy();
        expect(within(card).getByText(MACHINE_BODY)).toBeTruthy();
        expect(within(card).getByText(WRITER_RAW)).toBeTruthy();
        expect(pre.textContent).not.toContain(MORNING_ORIGINAL_MACHINE_DRAFT_HEADING);
      }
      expectNoSendOrSaveRequest();
    }
  );

  it.each(["morning", "evening", "weekly"] as const)(
    "%s shows an unsaved Tyler edit in the textarea and the mirror immediately",
    async (page) => {
      nextRows = [
        adminRow({
          sendSlot:
            page === "morning"
              ? "morning"
              : page === "evening"
                ? "evening_checkin"
                : "weekly_review",
          currentBodyToSend: TYLER_SAVED,
          notebookFamily: page === "weekly" ? "weekly_relationship_v1" : "morning_relationship_v1",
        }),
      ];
      const card = await openPage(page);
      const user = userEvent.setup();
      const box = editor(card);
      await user.clear(box);
      await user.type(box, TYLER_UNSAVED);
      expect(box.value).toBe(TYLER_UNSAVED);
      expect(copyMirror(card).textContent).toBe(TYLER_UNSAVED);
      expectNoSendOrSaveRequest();
    }
  );

  it.each(["morning", "evening", "weekly"] as const)(
    "%s blank editor mirror contains no placeholder or historical SMS",
    async (page) => {
      nextRows = [
        adminRow({
          sendSlot:
            page === "morning"
              ? "morning"
              : page === "evening"
                ? "evening_checkin"
                : "weekly_review",
          currentBodyToSend: "",
          notebookFamily: page === "weekly" ? "weekly_relationship_v1" : "morning_relationship_v1",
        }),
      ];
      const card = await openPage(page);
      const pre = copyMirror(card);
      expect(editor(card).value).toBe("");
      expect(pre.textContent).toBe("");
      expect(pre.innerHTML).toBe("");
      if (page !== "weekly") {
        expect(within(card).getByText(MACHINE_BODY)).toBeTruthy();
        expect(within(card).getByText(WRITER_RAW)).toBeTruthy();
      }
      expectNoSendOrSaveRequest();
    }
  );
});
