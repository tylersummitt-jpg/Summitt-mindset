/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TylerTextOverviewDashboard from "@/app/admin/tyler-text-overview/tyler-text-overview-dashboard";
import { ttoGenerateAllSessionStorageKey } from "@/lib/tyler-text-overview-dashboard-copy";
import {
  SMS_DAILY_EVENING_PREVIEW_SEND_SLOT,
  SMS_DAILY_PRODUCTION_SEND_SLOT,
} from "@/lib/tyler-text-overview-types";

const DAY = "2026-10-05";
const FROZEN_AUDIENCE = ["user_frozen_a", "user_frozen_b"];

const getTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: getTokenMock,
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "draft_for_day_key" ? DAY : null),
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

type GeneratePost = {
  url: string;
  authorization: string | null;
  contentType: string | null;
  credentials: RequestCredentials | undefined;
  redirect: RequestRedirect | undefined;
  cache: RequestCache | undefined;
  body: Record<string, unknown>;
};

const generatePosts: GeneratePost[] = [];
const allUrls: string[] = [];
const authEvents: string[] = [];
let chunkResponses: Array<Record<string, unknown>> = [];

function listBody() {
  return {
    ok: true,
    rows: [],
    counts: {
      sendableUsers: 2,
      noDraftYet: 2,
      draftCurrent: 0,
      draftCurrentReady: 0,
      draftCurrentTylerBlanked: 0,
      draftSent: 0,
      draftsMarkedSentDayTotal: 0,
      twilioAcceptedDayTotal: 0,
      draftSkipped: 0,
      machineShouldSendTrue: 0,
      machineShouldSendFalse: 0,
      generationLinkageErrors: 0,
    },
    availableDayKeys: [DAY],
    manifest: {
      manifestComplete: true,
      lastRefreshedAt: "2026-10-05T12:00:00.000Z",
    },
  };
}

function chunkResult(args: {
  isComplete: boolean;
  processed: number;
  failures?: Array<{ clerkUserId: string; preferredName: string | null; error: string }>;
}) {
  return {
    ok: true,
    result: {
      targeted: 2,
      generated: args.processed,
      generated_complete: args.isComplete ? 2 : 1,
      protectedTylerAuthority: 0,
      protected_complete: 0,
      skippedAlreadySent: 0,
      already_sent: 0,
      skippedNonCurrent: 0,
      noncurrent: 0,
      failed: args.failures?.length ?? 0,
      pending: args.isComplete ? 0 : 1,
      remaining: args.isComplete ? 0 : 1,
      processed_this_chunk: args.processed,
      is_complete: args.isComplete,
      audience_clerk_user_ids: FROZEN_AUDIENCE,
      failures: args.failures ?? [],
    },
  };
}

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? found[1] : null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

function installFetch() {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    allUrls.push(url);
    if (url.includes("generate-all")) {
      authEvents.push("post");
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      generatePosts.push({
        url,
        authorization: headerValue(init?.headers, "Authorization"),
        contentType: headerValue(init?.headers, "Content-Type"),
        credentials: init?.credentials,
        redirect: init?.redirect,
        cache: init?.cache,
        body,
      });
      const json = chunkResponses.shift() ?? chunkResult({ isComplete: true, processed: 1 });
      return Promise.resolve({
        ok: true,
        json: async () => json,
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => listBody(),
    });
  });
}

function renderDashboard(slot: "morning" | "evening_checkin") {
  render(
    <TylerTextOverviewDashboard
      sendSlot={
        slot === "morning"
          ? SMS_DAILY_PRODUCTION_SEND_SLOT
          : SMS_DAILY_EVENING_PREVIEW_SEND_SLOT
      }
    />
  );
}

async function clickGenerate(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  await userEvent.click(button);
}

function seedSnapshot(slot: "morning" | "evening_checkin") {
  sessionStorage.setItem(
    ttoGenerateAllSessionStorageKey({ sendSlot: slot, draftForDayKey: DAY }),
    JSON.stringify({
      draftForDayKey: DAY,
      sendSlot: slot,
      audienceClerkUserIds: FROZEN_AUDIENCE,
    })
  );
}

function snapshotRaw(slot: "morning" | "evening_checkin") {
  return sessionStorage.getItem(
    ttoGenerateAllSessionStorageKey({ sendSlot: slot, draftForDayKey: DAY })
  );
}

beforeEach(() => {
  generatePosts.length = 0;
  allUrls.length = 0;
  authEvents.length = 0;
  chunkResponses = [];
  sessionStorage.clear();
  getTokenMock.mockReset();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  installFetch();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Generate All Clerk bearer token", () => {
  it.each([
    ["morning", /Generate Morning for/, "/api/admin/tyler-text-overview/morning-generate-all"],
    [
      "evening_checkin",
      /Generate Evening for/,
      "/api/admin/tyler-text-overview/evening-generate-all",
    ],
  ] as const)(
    "%s calls getToken() with no arguments before each chunk and sends that chunk's token",
    async (slot, buttonName, endpoint) => {
      const tokens = ["bearer-chunk-1", "bearer-chunk-2"];
      getTokenMock.mockImplementation(async () => {
        authEvents.push("token");
        return tokens.shift();
      });
      chunkResponses = [
        chunkResult({
          isComplete: false,
          processed: 1,
          failures: [{ clerkUserId: "user_failed", preferredName: null, error: "soft" }],
        }),
        chunkResult({ isComplete: true, processed: 1 }),
      ];

      renderDashboard(slot);
      await clickGenerate(buttonName);

      await waitFor(() => expect(generatePosts).toHaveLength(2));

      expect(getTokenMock).toHaveBeenCalledTimes(2);
      expect(getTokenMock.mock.calls[0]).toEqual([]);
      expect(getTokenMock.mock.calls[1]).toEqual([]);
      expect(authEvents).toEqual(["token", "post", "token", "post"]);

      expect(generatePosts[0]).toMatchObject({
        url: endpoint,
        authorization: "Bearer bearer-chunk-1",
        contentType: "application/json",
        credentials: undefined,
        redirect: undefined,
        cache: undefined,
        body: { draft_for_day_key: DAY },
      });
      expect(generatePosts[0].body).not.toHaveProperty("audience_clerk_user_ids");
      expect(generatePosts[0].body).not.toHaveProperty("exclude_clerk_user_ids");

      expect(generatePosts[1]).toMatchObject({
        url: endpoint,
        authorization: "Bearer bearer-chunk-2",
        contentType: "application/json",
        credentials: undefined,
        redirect: undefined,
        cache: undefined,
        body: {
          draft_for_day_key: DAY,
          audience_clerk_user_ids: FROZEN_AUDIENCE,
          exclude_clerk_user_ids: ["user_failed"],
        },
      });
      expect(generatePosts[1].authorization).not.toBe(generatePosts[0].authorization);

      expect(allUrls.some((url) => url.includes("evening-send"))).toBe(false);
      expect(allUrls.some((url) => url.includes("morning-send"))).toBe(false);
      expect(allUrls.some((url) => url.includes("weekly-generate-all"))).toBe(false);
      expect(allUrls.some((url) => url.toLowerCase().includes("twilio"))).toBe(false);
    }
  );

  it("Resume obtains a fresh token immediately before its POST and keeps the frozen audience", async () => {
    seedSnapshot("evening_checkin");
    getTokenMock.mockImplementation(async () => {
      authEvents.push("token");
      return "bearer-resume";
    });
    chunkResponses = [chunkResult({ isComplete: true, processed: 1 })];

    renderDashboard("evening_checkin");
    await clickGenerate(/Resume Evening Generation for/);

    await waitFor(() => expect(generatePosts).toHaveLength(1));

    expect(getTokenMock).toHaveBeenCalledTimes(1);
    expect(getTokenMock.mock.calls[0]).toEqual([]);
    expect(authEvents).toEqual(["token", "post"]);
    expect(generatePosts[0]).toMatchObject({
      url: "/api/admin/tyler-text-overview/evening-generate-all",
      authorization: "Bearer bearer-resume",
      contentType: "application/json",
      body: {
        draft_for_day_key: DAY,
        audience_clerk_user_ids: FROZEN_AUDIENCE,
      },
    });
    expect(generatePosts[0].body).not.toHaveProperty("exclude_clerk_user_ids");
  });

  it.each([null, "", "   "])(
    "getToken() returning %j does not POST and does not clear the resume snapshot",
    async (token) => {
      seedSnapshot("evening_checkin");
      const before = snapshotRaw("evening_checkin");
      getTokenMock.mockResolvedValue(token);

      renderDashboard("evening_checkin");
      await clickGenerate(/Resume Evening Generation for/);

      expect((await screen.findAllByText("Generate All failed.")).length).toBeGreaterThan(0);
      expect(generatePosts).toHaveLength(0);
      expect(allUrls.some((url) => url.includes("generate-all"))).toBe(false);
      expect(snapshotRaw("evening_checkin")).toBe(before);
      expect(getTokenMock).toHaveBeenCalledTimes(1);
      expect(getTokenMock.mock.calls[0]).toEqual([]);
    }
  );

  it("getToken() rejecting does not POST and does not clear the resume snapshot", async () => {
    seedSnapshot("morning");
    const before = snapshotRaw("morning");
    getTokenMock.mockRejectedValue(new Error("clerk unavailable"));

    renderDashboard("morning");
    await clickGenerate(/Resume Morning Generation for/);

    expect((await screen.findAllByText("Generate All failed.")).length).toBeGreaterThan(0);
    expect(generatePosts).toHaveLength(0);
    expect(allUrls.some((url) => url.includes("generate-all"))).toBe(false);
    expect(allUrls.some((url) => url.includes("evening-send"))).toBe(false);
    expect(allUrls.some((url) => url.includes("morning-send"))).toBe(false);
    expect(allUrls.some((url) => url.includes("weekly-generate-all"))).toBe(false);
    expect(allUrls.some((url) => url.toLowerCase().includes("twilio"))).toBe(false);
    expect(snapshotRaw("morning")).toBe(before);
  });
});
