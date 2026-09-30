/** @vitest-environment jsdom */

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeAppProvider } from "@/components/native-app/NativeAppProvider";
import { HomepageHowItWorksVideo } from "@/components/homepage-how-it-works-video";

type Obs = {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  disconnected: boolean;
  trigger: (ratio: number) => void;
};

const observers: Obs[] = [];

const playerBag = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  handlers: {} as Record<string, Array<() => void>>,
  getPlayed: vi.fn(async () => [] as Array<{ start: number; end: number }>),
  getDuration: vi.fn(async () => 100),
  destroy: vi.fn(async () => undefined),
  play: vi.fn(async () => undefined),
  constructed: 0,
}));

vi.mock("@vimeo/player", () => ({
  default: class Player {
    constructor(_el: unknown, options?: Record<string, unknown>) {
      playerBag.options = options ?? null;
      playerBag.constructed += 1;
    }
    on(event: string, callback: () => void) {
      (playerBag.handlers[event] ??= []).push(callback);
    }
    off(event: string, callback?: () => void) {
      const current = playerBag.handlers[event] ?? [];
      playerBag.handlers[event] = callback
        ? current.filter((fn) => fn !== callback)
        : [];
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
    play() {
      return playerBag.play();
    }
  },
}));

class MockObserver {
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    const obs: Obs = {
      callback,
      options: options ?? {},
      disconnected: false,
      trigger(ratio: number) {
        callback(
          [
            {
              isIntersecting: ratio > 0,
              intersectionRatio: ratio,
              target: document.createElement("div"),
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver
        );
      },
    };
    observers.push(obs);
    (this as unknown as { obs: Obs }).obs = obs;
  }
  observe() {}
  unobserve() {}
  disconnect() {
    (this as unknown as { obs: Obs }).obs.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds: number[] = [];
}

function byMargin(margin: string) {
  return observers.find((obs) => obs.options.rootMargin === margin);
}

function posted() {
  return vi.mocked(fetch).mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    return JSON.parse(String(init.body)) as {
      event_type: string;
      path: string;
      vimeo_video_id: string;
    };
  });
}

async function mountPlayer() {
  const obs = byMargin("400px");
  expect(obs).toBeTruthy();
  obs!.trigger(1);
  await waitFor(() => expect(playerBag.constructed).toBe(1));
}

describe("HomepageHowItWorksVideo", () => {
  beforeEach(() => {
    observers.length = 0;
    playerBag.options = null;
    playerBag.handlers = {};
    playerBag.constructed = 0;
    playerBag.getPlayed.mockReset();
    playerBag.getDuration.mockReset();
    playerBag.destroy.mockReset();
    playerBag.play.mockReset();
    playerBag.getPlayed.mockResolvedValue([]);
    playerBag.getDuration.mockResolvedValue(100);
    playerBag.destroy.mockResolvedValue(undefined);
    playerBag.play.mockResolvedValue(undefined);
    vi.stubGlobal("IntersectionObserver", MockObserver);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("preloads near the viewport without counting a reach, and does not autoplay", async () => {
    render(<HomepageHowItWorksVideo videoId="1231615684" />);
    expect(posted()).toEqual([]);
    await mountPlayer();
    expect(posted()).toEqual([]);
    expect(playerBag.play).not.toHaveBeenCalled();
    expect(playerBag.options).toEqual({ id: 1231615684, dnt: true });
    expect(playerBag.options).not.toHaveProperty("autoplay");
  });

  it("emits reached once when the shell is half visible", async () => {
    render(<HomepageHowItWorksVideo videoId="1231615684" />);
    const reached = byMargin("0px");
    expect(reached?.options.threshold).toBe(0.5);
    reached!.trigger(0.5);
    reached!.trigger(0.5);
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]).toEqual({
      event_type: "homepage_video_reached",
      path: "/",
      vimeo_video_id: "1231615684",
    });
  });

  it("emits start once on playing and ignores a repeated playing event", async () => {
    render(<HomepageHowItWorksVideo videoId="1231615684" />);
    await mountPlayer();
    playerBag.handlers.playing[0]();
    playerBag.handlers.playing[0]();
    await waitFor(() => expect(posted().map((row) => row.event_type)).toEqual([
      "homepage_video_started",
    ]));
  });

  it("counts played ranges, not a seeked playhead, and emits 50 once", async () => {
    render(<HomepageHowItWorksVideo videoId="1231615684" />);
    await mountPlayer();
    playerBag.getPlayed.mockResolvedValue([{ start: 0, end: 10 }]);
    (playerBag.options as { currentTime?: number }).currentTime = 60;
    playerBag.handlers.timeupdate[0]();
    await waitFor(() => expect(playerBag.getPlayed).toHaveBeenCalled());
    expect(posted().map((row) => row.event_type)).not.toContain("homepage_video_50");

    vi.mocked(Date.now).mockReturnValue(1_002_000);
    playerBag.getPlayed.mockResolvedValue([{ start: 0, end: 30 }, { start: 40, end: 60 }]);
    playerBag.handlers.timeupdate[0]();
    playerBag.handlers.timeupdate[0]();
    await waitFor(() =>
      expect(posted().map((row) => row.event_type)).toContain("homepage_video_50")
    );
    expect(posted().filter((row) => row.event_type === "homepage_video_50")).toHaveLength(1);
  });

  it("completes on ended only after 90 percent was actually played", async () => {
    render(<HomepageHowItWorksVideo videoId="1231615684" />);
    await mountPlayer();
    playerBag.getPlayed.mockResolvedValue([{ start: 0, end: 80 }]);
    playerBag.handlers.ended[0]();
    await waitFor(() => expect(playerBag.getPlayed).toHaveBeenCalled());
    expect(posted().map((row) => row.event_type)).not.toContain("homepage_video_completed");

    vi.mocked(Date.now).mockReturnValue(1_002_000);
    playerBag.getPlayed.mockResolvedValue([{ start: 0, end: 95 }]);
    playerBag.handlers.ended[0]();
    playerBag.handlers.ended[0]();
    await waitFor(() =>
      expect(posted().filter((row) => row.event_type === "homepage_video_completed")).toHaveLength(1)
    );
  });

  it("does not emit 50 or completed when duration is zero or non-finite", async () => {
    render(<HomepageHowItWorksVideo videoId="1231615684" />);
    await mountPlayer();
    playerBag.getPlayed.mockResolvedValue([{ start: 0, end: 100 }]);
    playerBag.getDuration.mockResolvedValueOnce(0).mockResolvedValueOnce(Number.NaN);
    playerBag.handlers.timeupdate[0]();
    await waitFor(() => expect(playerBag.getDuration).toHaveBeenCalled());
    vi.mocked(Date.now).mockReturnValue(1_002_000);
    playerBag.handlers.ended[0]();
    await waitFor(() => expect(playerBag.getDuration).toHaveBeenCalledTimes(2));
    expect(posted()).toEqual([]);
  });

  it("skips preload and reached analytics when IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<HomepageHowItWorksVideo videoId="1231615684" />);
    expect(playerBag.constructed).toBe(0);
    expect(posted()).toEqual([]);
  });

  it("does not post from the native app", async () => {
    render(
      <NativeAppProvider isNativeSummittMindsetApp>
        <HomepageHowItWorksVideo videoId="1231615684" />
      </NativeAppProvider>
    );
    byMargin("0px")!.trigger(0.5);
    await mountPlayer();
    playerBag.handlers.playing[0]();
    expect(posted()).toEqual([]);
  });

  it("keeps a single explicit player and does not render an SDK auto-embed hook or fake play control", async () => {
    const view = render(<HomepageHowItWorksVideo videoId="1231615684" />);
    const shell = view.container.querySelector("[data-homepage-video-shell]");
    expect(shell).toBeTruthy();
    expect(shell?.getAttribute("data-vimeo-id")).toBeNull();
    expect(shell?.getAttribute("data-vimeo-url")).toBeNull();
    expect(view.container.innerHTML).not.toContain("data-vimeo-id");
    expect(view.container.innerHTML).not.toContain("data-vimeo-url");
    expect(view.container.querySelector("svg")).toBeNull();
    expect(shell?.className).toContain("aspect-video");
    await mountPlayer();
    expect(playerBag.constructed).toBe(1);
    expect(playerBag.options).toEqual({ id: 1231615684, dnt: true });
    expect(playerBag.play).not.toHaveBeenCalled();
    expect(playerBag.options).not.toHaveProperty("autoplay");
  });

  it("removes listeners, destroys the player, and disconnects observers", async () => {
    const view = render(<HomepageHowItWorksVideo videoId="1231615684" />);
    await mountPlayer();
    view.unmount();
    expect(playerBag.destroy).toHaveBeenCalledTimes(1);
    expect(playerBag.handlers.playing ?? []).toEqual([]);
    expect(playerBag.handlers.timeupdate ?? []).toEqual([]);
    expect(playerBag.handlers.ended ?? []).toEqual([]);
    expect(observers.every((obs) => obs.disconnected)).toBe(true);
  });
});
