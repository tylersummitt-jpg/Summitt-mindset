/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const DASHBOARD_PATH = join(
  process.cwd(),
  "src/app/admin/tyler-text-overview/tyler-text-overview-weekly-dashboard.tsx"
);
const API_ROUTE_PATH = join(
  process.cwd(),
  "src/app/api/admin/tyler-text-overview/route.ts"
);

function weeklyRow(args: {
  draftId: string;
  clerkUserId: string;
  preferredName: string;
  phoneNumber: string;
  body: string;
}): TylerTextOverviewAdminDraftRow {
  return {
    draftId: args.draftId,
    clerkUserId: args.clerkUserId,
    preferredName: args.preferredName,
    phoneNumber: args.phoneNumber,
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

const JORDAN = weeklyRow({
  draftId: "draft-jordan",
  clerkUserId: "user_jordan",
  preferredName: "Jordan Hale",
  phoneNumber: "+15551110001",
  body: "Jordan server body",
});
const PAT = weeklyRow({
  draftId: "draft-pat",
  clerkUserId: "user_pat",
  preferredName: "Pat Example",
  phoneNumber: "+15551110002",
  body: "Pat server body",
});

const COUNTS = {
  sendableUsers: 2,
  noDraftYet: 0,
  draftCurrent: 2,
  draftCurrentReady: 2,
  draftCurrentTylerBlanked: 0,
  draftSent: 0,
  draftSkipped: 0,
  machineShouldSendTrue: 2,
  machineShouldSendFalse: 0,
  generationLinkageErrors: 0,
  draftsMarkedSentDayTotal: 0,
  twilioAcceptedDayTotal: null,
};

function jsonResponse(dayKey: string) {
  return {
    ok: true,
    json: async () => ({
      ok: true,
      rows: dayKey === "2026-07-05" ? [] : [JORDAN, PAT],
      counts: COUNTS,
      availableDayKeys: ["2026-07-12", "2026-07-05"],
    }),
  };
}

describe("weekly dashboard local search", () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    return jsonResponse(url.searchParams.get("draft_for_day_key") ?? "");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("filters loaded Sunday rows locally and keeps unsaved textarea text", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<TylerTextOverviewWeeklyDashboard />);

    const jordanBox = await screen.findByDisplayValue("Jordan server body");
    expect(screen.getByDisplayValue("Pat server body")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(firstUrl).toContain("send_slot=weekly_review");
    expect(firstUrl).toContain("draft_for_day_key=2026-07-12");
    expect(firstUrl).not.toContain("q=");
    expect(screen.getByText("Sendable users").nextElementSibling?.textContent).toBe("2");

    await user.click(jordanBox);
    await user.paste("UNSAVED PASTE");
    const pasted = (jordanBox as HTMLTextAreaElement).value;
    expect(pasted).toContain("UNSAVED PASTE");
    expect(pasted).not.toBe("Jordan server body");

    await user.type(screen.getByPlaceholderText("name, phone, user id"), "jordan");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Loading drafts…")).toBeNull();
    expect(screen.getByText("Jordan Hale")).toBeTruthy();
    expect(screen.queryByText("Pat Example")).toBeNull();
    expect(screen.getByDisplayValue(pasted)).toBe(jordanBox);
    expect(screen.getByText("Visible filtered rows: 1 (search does not change global counts)")).toBeTruthy();
    expect(screen.getByText("Sendable users").nextElementSibling?.textContent).toBe("2");

    await user.clear(screen.getByPlaceholderText("name, phone, user id"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Loading drafts…")).toBeNull();
    expect(screen.getByText("Pat Example")).toBeTruthy();
    expect(screen.getByDisplayValue(pasted)).toBeTruthy();
    expect(screen.getByDisplayValue("Pat server body")).toBeTruthy();
    expect(screen.queryByText(/Visible filtered rows/)).toBeNull();
    expect(screen.getByText("Sendable users").nextElementSibling?.textContent).toBe("2");

    const search = screen.getByPlaceholderText("name, phone, user id");
    await user.type(search, "pat");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue(pasted)).toBeNull();
    expect(screen.getByDisplayValue("Pat server body")).toBeTruthy();
    expect(screen.getByText("Sendable users").nextElementSibling?.textContent).toBe("2");

    await user.clear(search);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Loading drafts…")).toBeNull();
    expect(screen.getByDisplayValue(pasted)).toBeTruthy();
    expect(screen.getByDisplayValue("Pat server body")).toBeTruthy();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.selectOptions(screen.getByRole("combobox"), "2026-07-05");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondUrl).toContain("draft_for_day_key=2026-07-05");
    expect(secondUrl).not.toContain("q=");
    expect(secondUrl).toContain("send_slot=weekly_review");
  });
});

describe("weekly dashboard search source contract", () => {
  const dashboard = readFileSync(DASHBOARD_PATH, "utf8");
  const apiRoute = readFileSync(API_ROUTE_PATH, "utf8");

  it("does not load or send q when search changes, and Sunday change loads explicitly", () => {
    expect(dashboard).toContain("void load(selectedDayKeyRef.current, { forceOverwrite: true });");
    expect(dashboard).toContain("void load(nextDay, { forceOverwrite: true, revertDayKeyOnFailure: previousDayKey });");
    expect(dashboard).not.toContain("load(selectedDayKey, searchQuery)");
    expect(dashboard).not.toContain("[load, selectedDayKey, searchQuery]");
    expect(dashboard).not.toContain("[load, selectedDayKey]");
    expect(dashboard).not.toContain('params.set("q"');
    expect(dashboard).toContain("matchesTylerTextOverviewSearchQuery");
    expect(dashboard).toContain("visibleRows");
    expect(dashboard).toContain('value={edits[row.draftId as string] ?? ""}');
    expect(dashboard).toContain("{counts[key]}");
    expect(dashboard).toContain("rows.filter((r) => countsAsWeeklyBlankNeedsGeneration(r))");
    expect(dashboard).toContain('onChange={(e) => setSearchQuery(e.target.value)}');
    expect(dashboard).toContain("requestSundayChange(e.target.value)");
    expect(dashboard).toContain("await load(selectedDayKeyRef.current, { forceOverwrite: false });");
    expect(dashboard).toContain("hasWeeklyUnsavedEdits(rowsRef.current, editsRef.current)");

    const loadEffect = dashboard.slice(
      dashboard.indexOf("useEffect(() => {\n    void load(selectedDayKeyRef.current, { forceOverwrite: true });"),
      dashboard.indexOf("function requestSundayChange")
    );
    expect(loadEffect).not.toContain("searchQuery");
    expect(loadEffect).not.toContain("setEdits");
    expect(loadEffect).not.toContain("setLoading");

    expect(apiRoute).toContain('url.searchParams.get("q")');
    expect(apiRoute).toContain("searchQuery");
  });
});
