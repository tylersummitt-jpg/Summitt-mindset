/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const SUNDAY_A = "2026-07-12";
const SUNDAY_B = "2026-07-05";
const SUNDAY_C = "2026-06-28";

type Deferred = {
  url: string;
  resolve: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
};

const listRequests: Deferred[] = [];
const actionRequests: Deferred[] = [];

function weeklyRow(
  overrides: Partial<TylerTextOverviewAdminDraftRow> &
    Pick<TylerTextOverviewAdminDraftRow, "draftId" | "clerkUserId" | "preferredName">
): TylerTextOverviewAdminDraftRow {
  return {
    timezone: "America/New_York",
    rowState: "draft_current",
    draftForDayKey: SUNDAY_A,
    sendSlot: "weekly_review",
    draftStatus: "current",
    sentAt: null,
    finalBodySent: null,
    twilioMessageSid: null,
    sourceSmsSendEventId: null,
    phoneNumber: "+15551110001",
    currentBodyToSend: "server body",
    currentBodySource: "machine",
    editedByTyler: false,
    editedAt: null,
    writerOpenAiMessages: [],
    authoritativeRetryMessages: [],
    authoritativeMachineDraftBody: "server body",
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
    weekEnd: SUNDAY_A,
    ...overrides,
  } as TylerTextOverviewAdminDraftRow;
}

const COUNTS = {
  sendableUsers: 7,
  noDraftYet: 0,
  draftCurrent: 2,
  draftSent: 0,
  draftSkipped: 0,
  machineShouldSendTrue: 2,
  machineShouldSendFalse: 0,
};

function listBody(args: {
  rows: TylerTextOverviewAdminDraftRow[];
  counts?: typeof COUNTS;
  availableDayKeys?: string[];
  ok?: boolean;
  error?: string;
}) {
  return {
    ok: args.ok !== false,
    rows: args.rows,
    counts: args.counts ?? COUNTS,
    availableDayKeys: args.availableDayKeys ?? [SUNDAY_A, SUNDAY_B, SUNDAY_C],
    error: args.error,
  };
}

function resolveDeferred(deferred: Deferred, body: unknown, httpOk = true) {
  deferred.resolve({
    ok: httpOk,
    json: async () => body,
  });
}

function listUrls() {
  return listRequests.map((request) => request.url);
}

async function settleInitial(rows: TylerTextOverviewAdminDraftRow[]) {
  await waitFor(() => expect(listRequests.length).toBe(1));
  resolveDeferred(listRequests[0], listBody({ rows }));
  await screen.findByText(rows[0]?.preferredName ?? "missing");
}

function rowCard(name: string): HTMLElement {
  const card = screen.getByText(name).closest("li");
  if (!card) throw new Error(`No card for ${name}`);
  return card;
}

beforeEach(() => {
  listRequests.length = 0;
  actionRequests.length = 0;
  sessionStorage.clear();
  vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    return new Promise((resolve) => {
      const deferred = { url, resolve };
      if (url.includes("/api/admin/tyler-text-overview?")) {
        listRequests.push(deferred);
      } else {
        actionRequests.push(deferred);
      }
    });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("weekly dashboard edit lifecycle", () => {
  it("shows the full-page loader until the first load succeeds", async () => {
    render(<TylerTextOverviewWeeklyDashboard />);
    expect(screen.getByText("Loading drafts…")).toBeTruthy();
    expect(screen.queryByText("Refreshing…")).toBeNull();

    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    await settleInitial([alpha]);
    expect(screen.queryByText("Loading drafts…")).toBeNull();
    expect(screen.getByDisplayValue("Alpha server")).toBeTruthy();
  });

  it("keeps a dirty row when a clean row is regenerated", async () => {
    const user = userEvent.setup();
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    const bravo = weeklyRow({
      draftId: "draft-b",
      clerkUserId: "user_b",
      preferredName: "Bravo",
      phoneNumber: "+15551110002",
      currentBodyToSend: "Bravo server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha, bravo]);

    const bravoBox = within(rowCard("Bravo")).getByRole("textbox");
    await user.clear(bravoBox);
    await user.type(bravoBox, "Bravo dirty");

    await user.click(within(rowCard("Alpha")).getByRole("button", { name: "Regenerate Weekly Draft" }));
    await waitFor(() => expect(actionRequests.length).toBe(1));
    resolveDeferred(actionRequests[0], { ok: true, machine_should_send: true, machine_draft_body: "Alpha generated" });

    await waitFor(() => expect(listRequests.length).toBe(2));
    expect(screen.getByText("Refreshing…")).toBeTruthy();
    expect(screen.queryByText("Loading drafts…")).toBeNull();
    expect(within(rowCard("Bravo")).getByRole("textbox")).toBeTruthy();

    resolveDeferred(
      listRequests[1],
      listBody({
        rows: [
          { ...alpha, currentBodyToSend: "Alpha generated" },
          { ...bravo, currentBodyToSend: "Bravo server" },
        ],
      })
    );

    await waitFor(() => {
      expect(within(rowCard("Alpha")).getByRole("textbox")).toHaveProperty("value", "Alpha generated");
    });
    expect(within(rowCard("Bravo")).getByRole("textbox")).toHaveProperty("value", "Bravo dirty");
    expect(listUrls().every((url) => !url.includes("q="))).toBe(true);
    expect(listUrls()[1]).toContain(`draft_for_day_key=${SUNDAY_A}`);
  });

  it("keeps text typed into another row while a same-Sunday reload is in flight", async () => {
    const user = userEvent.setup();
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    const bravo = weeklyRow({
      draftId: "draft-b",
      clerkUserId: "user_b",
      preferredName: "Bravo",
      phoneNumber: "+15551110002",
      currentBodyToSend: "Bravo server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha, bravo]);

    await user.click(within(rowCard("Alpha")).getByRole("button", { name: "Regenerate Weekly Draft" }));
    await waitFor(() => expect(actionRequests.length).toBe(1));
    resolveDeferred(actionRequests[0], { ok: true, machine_should_send: true });
    await waitFor(() => expect(listRequests.length).toBe(2));

    const alphaBox = within(rowCard("Alpha")).getByRole("textbox");
    const bravoBox = within(rowCard("Bravo")).getByRole("textbox");
    await user.clear(alphaBox);
    await user.type(alphaBox, "typed into generated");
    await user.clear(bravoBox);
    await user.type(bravoBox, "typed during");

    resolveDeferred(
      listRequests[1],
      listBody({
        rows: [
          { ...alpha, currentBodyToSend: "Alpha generated" },
          bravo,
        ],
      })
    );

    await waitFor(() => {
      expect(within(rowCard("Alpha")).getByRole("textbox")).toHaveProperty("value", "typed into generated");
    });
    expect(within(rowCard("Bravo")).getByRole("textbox")).toHaveProperty("value", "typed during");
  });

  it("keeps dirty text when Generate Missing returns a new body for a clean row", async () => {
    const user = userEvent.setup();
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "",
      authoritativeMachineDraftBody: null,
      authoritativeMachineDraftStatus: "failed",
      machineShouldSend: false,
    });
    const bravo = weeklyRow({
      draftId: "draft-b",
      clerkUserId: "user_b",
      preferredName: "Bravo",
      phoneNumber: "+15551110002",
      currentBodyToSend: "Bravo server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha, bravo]);
    const bravoBox = within(rowCard("Bravo")).getByRole("textbox");
    await user.clear(bravoBox);
    await user.type(bravoBox, "Bravo dirty");

    await user.click(screen.getByRole("button", { name: "Generate Missing Weekly Drafts" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Generate Missing Weekly Drafts" }));
    await waitFor(() => expect(actionRequests.length).toBe(1));
    resolveDeferred(actionRequests[0], {
      result: {
        targeted: 1,
        generated_complete: 1,
        protected_complete: 0,
        already_sent: 0,
        failed: 0,
        remaining: 0,
        processed_this_chunk: 1,
        is_complete: true,
        audience_clerk_user_ids: ["user_a"],
        failures: [],
      },
    });
    await waitFor(() => expect(listRequests.length).toBe(2));
    resolveDeferred(
      listRequests[1],
      listBody({
        rows: [
          { ...alpha, currentBodyToSend: "Alpha generated", machineShouldSend: true },
          bravo,
        ],
      })
    );
    await waitFor(() => {
      expect(within(rowCard("Alpha")).getByRole("textbox")).toHaveProperty("value", "Alpha generated");
    });
    expect(within(rowCard("Bravo")).getByRole("textbox")).toHaveProperty("value", "Bravo dirty");
  });

  it("updates a sent row without clearing an unrelated dirty row", async () => {
    const user = userEvent.setup();
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    const bravo = weeklyRow({
      draftId: "draft-b",
      clerkUserId: "user_b",
      preferredName: "Bravo",
      phoneNumber: "+15551110002",
      currentBodyToSend: "Bravo server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha, bravo]);
    const bravoBox = within(rowCard("Bravo")).getByRole("textbox");
    await user.clear(bravoBox);
    await user.type(bravoBox, "Bravo dirty");

    await user.click(within(rowCard("Alpha")).getByRole("button", { name: "Send Weekly Text" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send Weekly Text" }));
    await waitFor(() => expect(actionRequests.length).toBe(1));
    resolveDeferred(actionRequests[0], { ok: true });
    await waitFor(() => expect(listRequests.length).toBe(2));
    resolveDeferred(
      listRequests[1],
      listBody({
        rows: [
          {
            ...alpha,
            rowState: "draft_sent",
            draftStatus: "sent",
            finalBodySent: "Alpha sent body",
            currentBodyToSend: "Alpha sent body",
          },
          bravo,
        ],
      })
    );
    await waitFor(() => expect(screen.getByText("Alpha sent body")).toBeTruthy());
    expect(within(rowCard("Alpha")).queryByRole("textbox")).toBeNull();
    expect(within(rowCard("Bravo")).getByRole("textbox")).toHaveProperty("value", "Bravo dirty");
  });

  it("keeps keystrokes typed while a save is in flight", async () => {
    const user = userEvent.setup();
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha]);
    const box = within(rowCard("Alpha")).getByRole("textbox");
    await user.clear(box);
    await user.type(box, "X");
    await user.click(screen.getByRole("button", { name: "Save Weekly Text" }));
    await waitFor(() => expect(actionRequests.length).toBe(1));
    await user.clear(box);
    await user.type(box, "Y");
    resolveDeferred(actionRequests[0], {
      ok: true,
      row: { ...alpha, currentBodyToSend: "X", editedByTyler: true, currentBodySource: "tyler_edit" },
    });
    await screen.findByText("Saved. Draft only — did not send.");
    expect(within(rowCard("Alpha")).getByRole("textbox")).toHaveProperty("value", "Y");
    expect(screen.getAllByText("Save changes before sending.").length).toBeGreaterThan(0);
  });

  it("replaces local edits after a confirmed bulk apply", async () => {
    const user = userEvent.setup();
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha]);
    const box = within(rowCard("Alpha")).getByRole("textbox");
    await user.clear(box);
    await user.type(box, "local dirty");

    const bulk = screen.getByLabelText(/Text for every current Weekly draft/i);
    await user.type(bulk, "Bulk server text");
    await user.click(screen.getByRole("button", { name: "Apply text to all" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Apply text to all" }));
    await waitFor(() => expect(actionRequests.length).toBe(1));
    resolveDeferred(actionRequests[0], { result: { message: "Applied." } });
    await waitFor(() => expect(listRequests.length).toBe(2));
    resolveDeferred(
      listRequests[1],
      listBody({
        rows: [{ ...alpha, currentBodyToSend: "Bulk server text", editedByTyler: true }],
      })
    );
    await waitFor(() => {
      expect(within(rowCard("Alpha")).getByRole("textbox")).toHaveProperty("value", "Bulk server text");
    });
    expect(screen.queryByDisplayValue("local dirty")).toBeNull();
  });

  it("asks before leaving a dirty Sunday and stays when cancelled, including a hidden row", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha]);
    const box = within(rowCard("Alpha")).getByRole("textbox");
    await user.clear(box);
    await user.type(box, "hidden dirty");
    await user.type(screen.getByPlaceholderText("name, phone, user id"), "nobody");
    expect(screen.queryByDisplayValue("hidden dirty")).toBeNull();

    await user.selectOptions(screen.getByRole("combobox"), SUNDAY_B);
    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved edits. Change draft day and discard local unsaved changes?"
    );
    expect(listRequests).toHaveLength(1);
    expect(screen.getByRole("combobox")).toHaveProperty("value", SUNDAY_A);
    await user.clear(screen.getByPlaceholderText("name, phone, user id"));
    expect(screen.getByDisplayValue("hidden dirty")).toBeTruthy();
  });

  it("loads the next Sunday after confirm and does not keep the previous dirty text", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha]);
    const box = within(rowCard("Alpha")).getByRole("textbox");
    await user.clear(box);
    await user.type(box, "Alpha dirty");

    await user.selectOptions(screen.getByRole("combobox"), SUNDAY_B);
    await waitFor(() => expect(listRequests.length).toBe(2));
    expect(screen.getByText("Loading drafts…")).toBeTruthy();
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(listUrls()[1]).toContain(`draft_for_day_key=${SUNDAY_B}`);
    expect(listUrls()[1]).not.toContain("q=");

    const bravo = weeklyRow({
      draftId: "draft-b",
      clerkUserId: "user_b",
      preferredName: "Bravo",
      draftForDayKey: SUNDAY_B,
      currentBodyToSend: "Bravo sunday",
    });
    resolveDeferred(listRequests[1], listBody({ rows: [bravo] }));
    await screen.findByText("Bravo");
    expect(screen.queryByDisplayValue("Alpha dirty")).toBeNull();
    expect(screen.getByDisplayValue("Bravo sunday")).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveProperty("value", SUNDAY_B);
  });

  it("restores the previous Sunday when the new Sunday fails, without fetching it again", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha]);
    const box = within(rowCard("Alpha")).getByRole("textbox");
    await user.clear(box);
    await user.type(box, "Alpha dirty");

    await user.selectOptions(screen.getByRole("combobox"), SUNDAY_B);
    await waitFor(() => expect(listRequests.length).toBe(2));
    resolveDeferred(listRequests[1], { ok: false, error: "Sunday B failed" });

    await screen.findByText("Sunday B failed");
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveProperty("value", SUNDAY_A));
    expect(screen.getByDisplayValue("Alpha dirty")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByRole("option", { name: SUNDAY_B })).toBeTruthy();
    expect(listRequests).toHaveLength(2);
  });

  it("does not let a stale Sunday failure restore an older Sunday", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha]);
    await user.clear(within(rowCard("Alpha")).getByRole("textbox"));
    await user.type(within(rowCard("Alpha")).getByRole("textbox"), "Alpha dirty");

    await user.selectOptions(screen.getByRole("combobox"), SUNDAY_B);
    await waitFor(() => expect(listRequests.length).toBe(2));
    await user.selectOptions(screen.getByRole("combobox"), SUNDAY_C);
    await waitFor(() => expect(listRequests.length).toBe(3));

    await act(async () => {
      resolveDeferred(listRequests[1], { ok: false, error: "Sunday B failed" });
    });
    expect(screen.queryByText("Sunday B failed")).toBeNull();
    expect(screen.getByRole("combobox")).toHaveProperty("value", SUNDAY_C);

    const charlie = weeklyRow({
      draftId: "draft-c",
      clerkUserId: "user_c",
      preferredName: "Charlie",
      draftForDayKey: SUNDAY_C,
      currentBodyToSend: "Charlie body",
    });
    resolveDeferred(listRequests[2], listBody({ rows: [charlie] }));
    await screen.findByText("Charlie");
    expect(screen.getByRole("combobox")).toHaveProperty("value", SUNDAY_C);
    expect(screen.queryByDisplayValue("Alpha dirty")).toBeNull();
  });

  it("keeps known-good rows when a same-Sunday refresh fails", async () => {
    const user = userEvent.setup();
    const alpha = weeklyRow({
      draftId: "draft-a",
      clerkUserId: "user_a",
      preferredName: "Alpha",
      currentBodyToSend: "Alpha server",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([alpha]);
    await user.clear(within(rowCard("Alpha")).getByRole("textbox"));
    await user.type(within(rowCard("Alpha")).getByRole("textbox"), "Alpha dirty");

    await user.click(screen.getByRole("button", { name: "Generate Missing Weekly Drafts" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Generate Missing Weekly Drafts" }));
    await waitFor(() => expect(actionRequests.length).toBe(1));
    resolveDeferred(actionRequests[0], {
      result: {
        targeted: 1,
        generated_complete: 0,
        protected_complete: 0,
        already_sent: 0,
        failed: 0,
        remaining: 0,
        processed_this_chunk: 0,
        is_complete: true,
        audience_clerk_user_ids: ["user_a"],
        failures: [],
      },
    });
    await waitFor(() => expect(listRequests.length).toBe(2));
    resolveDeferred(listRequests[1], { ok: false, error: "refresh failed" });

    await screen.findByText("refresh failed");
    expect(screen.getByDisplayValue("Alpha dirty")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByRole("option", { name: SUNDAY_A })).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveProperty("value", SUNDAY_A);
    expect(listRequests).toHaveLength(2);
  });

  it("keeps an intentional-space row editable", async () => {
    const space = weeklyRow({
      draftId: "draft-space",
      clerkUserId: "user_space",
      preferredName: "Space",
      currentBodyToSend: "",
      authoritativeMachineDraftBody: null,
      authoritativeMachineDraftStatus: "intentional_space",
      machineShouldSend: false,
      machineNoSendReason: "intentional_space",
    });
    render(<TylerTextOverviewWeeklyDashboard />);
    await settleInitial([space]);
    expect(screen.getAllByText(/INTENTIONAL SPACE/).length).toBeGreaterThan(0);
    expect(within(rowCard("Space")).getByRole("textbox")).toBeTruthy();
  });
});
