/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TylerTextOverviewAdminDraftRow } from "@/lib/tyler-text-overview-types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "draft_for_day_key" ? "2026-07-12" : null),
  }),
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

import TylerTextOverviewWeeklyDashboard from "@/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard";

type ListDeferred = {
  url: string;
  resolve: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
  reject: (err: unknown) => void;
  settled: boolean;
};

function weeklyRow(args: {
  draftId: string;
  name: string;
  body: string;
}): TylerTextOverviewAdminDraftRow {
  return {
    draftId: args.draftId,
    clerkUserId: `user_${args.draftId}`,
    preferredName: args.name,
    phoneNumber: "+15551110001",
    timezone: "America/New_York",
    rowState: "draft_current",
    draftForDayKey: "2026-07-12",
    sendSlot: "weekly_review",
    draftStatus: "current",
    sentAt: null,
    finalBodySent: null,
    twilioMessageSid: null,
    sourceSmsSendEventId: null,
    currentBodyToSend: args.body,
    currentBodySource: "machine",
    editedByTyler: false,
    editedAt: null,
    writerOpenAiMessages: [],
    authoritativeRetryMessages: [],
    authoritativeMachineDraftBody: args.body,
    authoritativeMachineDraftStatus: "available",
    authoritativeWriterModel: null,
    authoritativeRetryOccurred: null,
    authoritativeGeneratedAt: null,
    currentGenerationId: null,
    currentGenerationNumber: null,
    latestGenerationId: null,
    latestGenerationNumber: null,
    isLatestGeneration: null,
    writerPromptPath: null,
    notebookHash: null,
    notebookMessageCount: 0,
    notebookFamily: "weekly_relationship_v1",
    notebookDisplayMode: "writer_skipped_unknown",
    machineShouldSend: true,
    machineNoSendReason: null,
    capturePresent: null,
    silenceCadenceRoute: null,
    silenceDay: null,
    intentionalSpace: null,
    messageRequiredToday: null,
    laneStage: null,
    slotCoachingContext: null,
    morningBriefInterpreterV1: null,
    morningCoachingBriefV1: null,
    morningWriterCaptureV1: null,
    messageFor: null,
    morningRelationshipPacketV1: null,
    coachingStack: null,
    weekKey: "2026-07-06",
    weekStart: "2026-07-06",
    weekEnd: "2026-07-12",
  } as TylerTextOverviewAdminDraftRow;
}

function listBody(args: {
  name: string;
  body: string;
  draftId: string;
  sendableUsers: number;
  dayKeys: string[];
}) {
  return {
    ok: true,
    rows: [weeklyRow({ draftId: args.draftId, name: args.name, body: args.body })],
    counts: {
      sendableUsers: args.sendableUsers,
      noDraftYet: 0,
      draftCurrent: args.sendableUsers,
      draftSent: 0,
      draftSkipped: 0,
      machineShouldSendTrue: 0,
      machineShouldSendFalse: 0,
    },
    availableDayKeys: args.dayKeys,
  };
}

function response(body: unknown) {
  return { ok: true, json: async () => body };
}

const INITIAL = listBody({
  name: "Initial Person",
  body: "Initial server body",
  draftId: "draft-initial",
  sendableUsers: 1,
  dayKeys: ["2026-07-12", "2026-07-05"],
});
const STALE = listBody({
  name: "Stale Alpha",
  body: "Stale alpha body",
  draftId: "draft-alpha",
  sendableUsers: 44,
  dayKeys: ["1999-01-01"],
});
const CURRENT = listBody({
  name: "Current Beta",
  body: "Current beta body",
  draftId: "draft-beta",
  sendableUsers: 9,
  dayKeys: ["2026-07-12", "2099-01-01"],
});

function sendableCount(): string {
  return screen.getByText("Sendable users").nextElementSibling?.textContent ?? "";
}

describe("weekly dashboard stale list requests", () => {
  const listRequests: ListDeferred[] = [];
  let rejectOnAbort = false;
  let generateAllResolve: ((value: { ok: boolean; json: () => Promise<unknown> }) => void) | null =
    null;

  function installFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/weekly-generate-all")) {
          return new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
            generateAllResolve = resolve;
          });
        }
        return new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
          const item: ListDeferred = { url, resolve, reject, settled: false };
          listRequests.push(item);
          const signal = init?.signal;
          if (!signal) return;
          const onAbort = () => {
            if (!rejectOnAbort || item.settled) return;
            item.settled = true;
            reject(new DOMException("The operation was aborted.", "AbortError"));
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort);
        });
      })
    );
  }

  function resolveList(index: number, body: unknown) {
    const item = listRequests[index];
    if (!item || item.settled) {
      throw new Error(`list request ${index} is not pending`);
    }
    item.settled = true;
    item.resolve(response(body));
  }

  afterEach(() => {
    cleanup();
    listRequests.length = 0;
    rejectOnAbort = false;
    generateAllResolve = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderLoaded() {
    installFetch();
    const user = userEvent.setup();
    render(<TylerTextOverviewWeeklyDashboard />);
    await waitFor(() => expect(listRequests).toHaveLength(1));
    resolveList(0, INITIAL);
    await screen.findByText("Initial Person");
    return user;
  }

  it("keeps the newer response when an older list request resolves later", async () => {
    const user = await renderLoaded();
    await user.selectOptions(screen.getByRole("combobox"), "2026-07-05");
    await waitFor(() => expect(listRequests).toHaveLength(2));
    await user.selectOptions(screen.getByRole("combobox"), "2026-07-12");
    await waitFor(() => expect(listRequests).toHaveLength(3));

    resolveList(2, CURRENT);
    await screen.findByText("Current Beta");
    expect(screen.getByDisplayValue("Current beta body")).toBeTruthy();
    expect(sendableCount()).toBe("9");
    expect(screen.getByRole("option", { name: "2099-01-01" })).toBeTruthy();

    resolveList(1, STALE);
    await screen.findByText("Current Beta");
    expect(screen.queryByText("Stale Alpha")).toBeNull();
    expect(screen.queryByDisplayValue("Stale alpha body")).toBeNull();
    expect(screen.getByDisplayValue("Current beta body")).toBeTruthy();
    expect(sendableCount()).toBe("9");
    expect(screen.getByRole("option", { name: "2099-01-01" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "1999-01-01" })).toBeNull();
  });

  it("does not let an older finally clear loading for the newer request", async () => {
    const user = await renderLoaded();
    await user.selectOptions(screen.getByRole("combobox"), "2026-07-05");
    await waitFor(() => expect(listRequests).toHaveLength(2));
    await user.selectOptions(screen.getByRole("combobox"), "2026-07-12");
    await waitFor(() => expect(listRequests).toHaveLength(3));

    resolveList(1, STALE);
    await screen.findByText("Loading drafts…");
    expect(screen.queryByText("Stale Alpha")).toBeNull();
    expect(sendableCount()).toBe("1");
    expect(screen.queryByRole("option", { name: "1999-01-01" })).toBeNull();

    resolveList(2, CURRENT);
    await screen.findByText("Current Beta");
    expect(screen.queryByText("Loading drafts…")).toBeNull();
    expect(sendableCount()).toBe("9");
  });

  it("does not toast or write state when a superseded request aborts", async () => {
    rejectOnAbort = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await renderLoaded();
    await user.selectOptions(screen.getByRole("combobox"), "2026-07-05");
    await waitFor(() => expect(listRequests).toHaveLength(2));
    await user.selectOptions(screen.getByRole("combobox"), "2026-07-12");
    await waitFor(() => expect(listRequests).toHaveLength(3));
    await screen.findByText("Loading drafts…");

    expect(screen.queryByText("Could not load weekly drafts.")).toBeNull();
    expect(screen.queryByText("Stale Alpha")).toBeNull();
    expect(sendableCount()).toBe("1");
    expect(consoleError).not.toHaveBeenCalled();

    resolveList(2, CURRENT);
    await screen.findByText("Current Beta");
    expect(screen.queryByText("Could not load weekly drafts.")).toBeNull();
    expect(screen.queryByText("Loading drafts…")).toBeNull();
    expect(sendableCount()).toBe("9");
  });

  it("keeps the Generate Missing reload when an older Sunday load resolves later", async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Generate Missing Weekly Drafts" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Generate Missing Weekly Drafts" })
    );
    await waitFor(() => expect(generateAllResolve).not.toBeNull());

    await user.selectOptions(screen.getByRole("combobox"), "2026-07-05");
    await waitFor(() => expect(listRequests).toHaveLength(2));

    generateAllResolve?.(
      response({
        result: {
          targeted: 1,
          generated_complete: 1,
          protected_complete: 0,
          already_sent: 0,
          failed: 0,
          remaining: 0,
          processed_this_chunk: 1,
          is_complete: true,
          audience_clerk_user_ids: ["user_beta"],
          failures: [],
        },
      })
    );
    await waitFor(() => expect(listRequests).toHaveLength(3));

    resolveList(2, CURRENT);
    await screen.findByText("Current Beta");
    resolveList(1, STALE);
    await screen.findByText("Current Beta");
    expect(screen.queryByText("Stale Alpha")).toBeNull();
    expect(screen.getByDisplayValue("Current beta body")).toBeTruthy();
    expect(sendableCount()).toBe("9");
    expect(screen.getByRole("option", { name: "2099-01-01" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "1999-01-01" })).toBeNull();
  });
});
