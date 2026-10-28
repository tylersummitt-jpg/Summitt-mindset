/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PersonalVideoPlayer } from "@/components/personal-video-engagement";

const playerBag = vi.hoisted(() => ({
  handlers: {} as Record<string, Array<() => void>>,
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
    on(event: string, callback: () => void) {
      (playerBag.handlers[event] ??= []).push(callback);
    }
    off(event: string, callback?: () => void) {
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

function posted() {
  return vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)) as { event_type: string });
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

  it("records the first 25% once and does not treat a missing read as zero", async () => {
    render(
      <PersonalVideoPlayer
        playerSrc="https://player.vimeo.com/video/1"
        personalVideoId={VIDEO}
        recipientToken="recipient-token-recipient-token-recipient"
        journeyToken="signed"
        track
      />,
    );
    await waitFor(() => expect(playerBag.constructed).toBe(1));
    playerBag.handlers.play?.[0]?.();
    playerBag.handlers.timeupdate?.[0]?.();
    playerBag.handlers.timeupdate?.[0]?.();
    await waitFor(() => expect(posted().some((row) => row.event_type === "personal_video_watched_25")).toBe(true));
    expect(posted().filter((row) => row.event_type === "personal_video_watched_25")).toHaveLength(1);
    expect(posted().filter((row) => row.event_type === "personal_video_played")).toHaveLength(1);
    playerBag.getPlayed.mockRejectedValueOnce(new Error("unread"));
    vi.spyOn(Date, "now").mockReturnValue(1_002_000);
    playerBag.handlers.timeupdate?.[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted().some((row) => row.event_type === "personal_video_watched_50")).toBe(false);
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
