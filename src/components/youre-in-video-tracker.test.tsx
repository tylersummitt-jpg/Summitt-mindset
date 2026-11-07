/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { YoureInVideoTracker } from "@/components/youre-in-video-tracker";

type TimePayload = { seconds?: number; duration?: number };

const playerBag = vi.hoisted(() => ({
  handlers: {} as Record<string, Array<(data?: TimePayload) => void>>,
  getPlayed: vi.fn(async () => [] as Array<{ start: number; end: number }>),
  getDuration: vi.fn(async () => 100),
  constructed: 0,
  fail: false,
}));

vi.mock("@vimeo/player", () => ({
  default: class Player {
    constructor() {
      playerBag.constructed += 1;
      if (playerBag.fail) throw new Error("sdk missing");
    }
    on(event: string, callback: (data?: TimePayload) => void) {
      (playerBag.handlers[event] ??= []).push(callback);
    }
    off(event: string) {
      playerBag.handlers[event] = [];
    }
    getPlayed() {
      return playerBag.getPlayed();
    }
    getDuration() {
      return playerBag.getDuration();
    }
  },
}));

function posted() {
  return vi.mocked(fetch).mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    return {
      url: String(call[0]),
      event: JSON.parse(String(init.body)).event as string,
      keepalive: init.keepalive,
    };
  });
}

function mount(withFrame: boolean) {
  render(
    <>
      {withFrame ? (
        <iframe
          data-youre-in-player=""
          title="Welcome to Summitt Mindset"
          src="https://player.vimeo.com/video/1244458037?dnt=1"
        />
      ) : null}
      <YoureInVideoTracker />
    </>
  );
}

describe("You're In video tracker", () => {
  beforeEach(() => {
    playerBag.handlers = {};
    playerBag.constructed = 0;
    playerBag.fail = false;
    playerBag.getPlayed.mockReset();
    playerBag.getDuration.mockReset();
    playerBag.getPlayed.mockResolvedValue([]);
    playerBag.getDuration.mockResolvedValue(100);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records that the page was reached before playback", async () => {
    mount(true);
    await waitFor(() => expect(posted().some((row) => row.event === "youre_in_page_reached")).toBe(true));
    expect(posted().every((row) => row.keepalive === true)).toBe(true);
    expect(posted().some((row) => row.event === "youre_in_video_started")).toBe(false);
  });

  it("records one start and played-range 25% and 50% milestones", async () => {
    playerBag.getPlayed.mockResolvedValue([{ start: 0, end: 60 }]);
    mount(true);
    await waitFor(() => expect(playerBag.constructed).toBe(1));
    playerBag.handlers.play?.[0]?.();
    playerBag.handlers.play?.[0]?.();
    playerBag.handlers.timeupdate?.[0]?.({ seconds: 60, duration: 100 });
    await waitFor(() => expect(posted().some((row) => row.event === "youre_in_video_watched_50")).toBe(true));
    expect(posted().filter((row) => row.event === "youre_in_video_started")).toHaveLength(1);
    expect(posted().filter((row) => row.event === "youre_in_video_watched_25")).toHaveLength(1);
    expect(posted().filter((row) => row.event === "youre_in_video_watched_50")).toHaveLength(1);
  });

  it("does not count a seek as 25% or 50% when played ranges are empty", async () => {
    mount(true);
    await waitFor(() => expect(playerBag.handlers.timeupdate?.length).toBe(1));
    playerBag.handlers.timeupdate?.[0]?.({ seconds: 1, duration: 100 });
    playerBag.handlers.timeupdate?.[0]?.({ seconds: 80, duration: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted().some((row) => row.event === "youre_in_video_watched_25")).toBe(false);
    expect(posted().some((row) => row.event === "youre_in_video_watched_50")).toBe(false);
  });

  it("does not count a playhead seek when the played range is still short", async () => {
    playerBag.getPlayed.mockResolvedValue([{ start: 40, end: 45 }]);
    mount(true);
    await waitFor(() => expect(playerBag.handlers.timeupdate?.length).toBe(1));
    playerBag.handlers.timeupdate?.[0]?.({ seconds: 45, duration: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posted().some((row) => row.event === "youre_in_video_watched_25")).toBe(false);
  });

  it("records completion from the player ended event", async () => {
    mount(true);
    await waitFor(() => expect(playerBag.handlers.ended?.length).toBe(1));
    playerBag.handlers.ended?.[0]?.({ seconds: 100, duration: 100 });
    await waitFor(() => expect(posted().some((row) => row.event === "youre_in_video_completed")).toBe(true));
    expect(posted().some((row) => row.event === "youre_in_video_watched_25")).toBe(false);
  });

  it("still records the page when the player cannot be created", async () => {
    playerBag.fail = true;
    mount(true);
    await waitFor(() => expect(posted().some((row) => row.event === "youre_in_page_reached")).toBe(true));
    await waitFor(() => expect(playerBag.constructed).toBe(1));
    expect(posted().some((row) => row.event === "youre_in_video_started")).toBe(false);
  });

  it("records the page when the iframe is missing and ignores a failed analytics write", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    expect(() => mount(false)).not.toThrow();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(playerBag.constructed).toBe(0);
    expect(posted()[0]?.event).toBe("youre_in_page_reached");
  });
});
