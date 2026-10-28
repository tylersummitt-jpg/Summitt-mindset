/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, () => void>();

vi.mock("@vimeo/player", () => ({
  default: class MockPlayer {
    on(event: string, callback: () => void) {
      handlers.set(event, callback);
    }
    off(event: string) {
      handlers.delete(event);
    }
  },
}));

import { FilmRoomPlayListener } from "@/components/film-room-play-listener";

describe("Film Room play listener", () => {
  afterEach(() => {
    cleanup();
    handlers.clear();
    vi.unstubAllGlobals();
  });

  it("does not request an event when the page opens, and requests once for a real play", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <>
        <iframe data-film-room-player title="Film" src="https://player.vimeo.com/video/42?dnt=1" />
        <FilmRoomPlayListener filmId="film-1" />
      </>
    );

    await waitFor(() => expect(handlers.has("play")).toBe(true));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(handlers.has("ready")).toBe(false);

    handlers.get("play")?.();
    handlers.get("play")?.();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/member-experience/film-play");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ filmId: "film-1" });
  });

  it("does not request a play after the listener unmounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(
      <>
        <iframe data-film-room-player title="Film" src="https://player.vimeo.com/video/42?dnt=1" />
        <FilmRoomPlayListener filmId="film-1" />
      </>
    );
    await waitFor(() => expect(handlers.has("play")).toBe(true));
    view.unmount();
    expect(handlers.has("play")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
