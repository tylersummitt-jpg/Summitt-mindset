/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalVideoPlayer } from "@/components/personal-video-engagement";

type TimePayload = { seconds?: number; duration?: number };

const playerBag = vi.hoisted(() => ({
  handlers: {} as Record<string, Array<(data?: TimePayload) => void>>,
  getPlayed: vi.fn(async () => [] as Array<{ start: number; end: number }>),
  getDuration: vi.fn(async () => 100),
  destroy: vi.fn(async () => undefined),
  constructed: 0,
}));

vi.mock("@vimeo/player", () => ({
  default: class Player {
    constructor(_el: unknown) {
      playerBag.constructed += 1;
    }
    on(event: string, callback: (data?: TimePayload) => void) {
      (playerBag.handlers[event] ??= []).push(callback);
    }
    off(event: string, callback?: (data?: TimePayload) => void) {
      const current = playerBag.handlers[event] ?? [];
      playerBag.handlers[event] = callback ? current.filter((fn) => fn !== callback) : [];
    }
    destroy() {
      return playerBag.destroy();
    }
    getPlayed() {
      return playerBag.getPlayed();
    }
    getDuration() {
      return playerBag.getDuration();
    }
  },
}));

const VIDEO = "11111111-1111-4111-8111-111111111111";
const TOKEN = "recipient-token-recipient-token-recipient";

function posted() {
  return vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as {
    event_type: string;
    acquisition_journey?: string;
  });
}

async function mountTracked() {
  render(
    <PersonalVideoPlayer
      playerSrc="https://player.vimeo.com/video/1"
      personalVideoId={VIDEO}
      recipientToken={TOKEN}
      journeyToken="signed"
      track
    />,
  );
  await waitFor(() => expect(playerBag.constructed).toBe(1));
}

function tick(seconds: number, nowMs: number) {
  vi.spyOn(Date, "now").mockReturnValue(nowMs);
  playerBag.handlers.timeupdate?.[0]?.({ seconds, duration: 100 });
}

describe("PersonalVideoPlayer milestones", () => {
  beforeEach(() => {
    playerBag.handlers = {};
    playerBag.constructed = 0;
    playerBag.getPlayed.mockReset();
    playerBag.getDuration.mockReset();
    playerBag.getPlayed.mockResolvedValue([{ start: 0, end: 30 }]);
    playerBag.getDuration.mockResolvedValue(100);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records the first 25% once from usable getPlayed and does not invent 50% after a failed read", async () => {
    await mountTracked();
    playerBag.handlers.play?.[0]?.();
    tick(30, 1_000_000);
    tick(31, 1_001_000);
    await waitFor(() => expect(posted().some((row) => row.event_type === "personal_video_watched_25")).toBe(true));
    expect(posted().filter((row) => row.event_type === "personal_video_watched_25")).toHaveLength(1);
    expect(posted().filter((row) => row.event_type === "personal_video_played")).toHaveLength(1);
    expect(posted().some((row) => row.acquisition_journey === "signed")).toBe(true);

    playerBag.getPlayed.mockRejectedValueOnce(new Error("unread"));
    tick(32, 1_002_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted().some((row) => row.event_type === "personal_video_watched_50")).toBe(false);
  });

  it("falls back to timeupdate accumulation when getPlayed stays empty", async () => {
    playerBag.getPlayed.mockResolvedValue([]);
    await mountTracked();
    playerBag.handlers.play?.[0]?.();

    let now = 1_000_000;
    for (let seconds = 0; seconds <= 52; seconds += 1) {
      tick(seconds, now);
      now += 1000;
    }

    await waitFor(() => expect(posted().some((row) => row.event_type === "personal_video_watched_25")).toBe(true));
    await waitFor(() => expect(posted().some((row) => row.event_type === "personal_video_watched_50")).toBe(true));
    expect(posted().filter((row) => row.event_type === "personal_video_watched_25")).toHaveLength(1);
    expect(posted().filter((row) => row.event_type === "personal_video_watched_50")).toHaveLength(1);
  });

  it("does not credit a forward seek when getPlayed is empty", async () => {
    playerBag.getPlayed.mockResolvedValue([]);
    await mountTracked();
    tick(1, 1_000_000);
    tick(2, 1_001_000);
    tick(60, 1_002_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted().some((row) => row.event_type === "personal_video_watched_25")).toBe(false);
    expect(posted().some((row) => row.event_type === "personal_video_watched_50")).toBe(false);
  });

  it("records 95% on ended even when played ranges are empty", async () => {
    playerBag.getPlayed.mockResolvedValue([]);
    await mountTracked();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    playerBag.handlers.ended?.[0]?.({ seconds: 100, duration: 100 });
    await waitFor(() => expect(posted().some((row) => row.event_type === "personal_video_watched_95")).toBe(true));
  });

  it("does not ask a shared library page for watch milestones", async () => {
    render(
      <PersonalVideoPlayer playerSrc="https://player.vimeo.com/video/1" personalVideoId={VIDEO} track />,
    );
    await waitFor(() => expect(playerBag.constructed).toBe(1));
    expect(playerBag.handlers.timeupdate ?? []).toEqual([]);
    expect(posted().map((row) => row.event_type)).toContain("personal_video_visited");
    expect(posted().map((row) => row.event_type)).not.toContain("personal_video_player_ready");
  });
});
