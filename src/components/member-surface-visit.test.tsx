/** @vitest-environment jsdom */

import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberSurfaceVisit } from "@/components/member-surface-visit";

describe("MemberSurfaceVisit", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("posts the surface once after mount and renders nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<MemberSurfaceVisit surface="dashboard" />);

    expect(view.container.innerHTML).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/member-experience/surface-visit");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      surface: "dashboard",
    });

    view.rerender(<MemberSurfaceVisit surface="dashboard" />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the visit request fails", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() => render(<MemberSurfaceVisit surface="film_room" />)).not.toThrow();
  });
});

describe("member surface visit mounts", () => {
  const root = process.cwd();

  function source(path: string): string {
    return readFileSync(join(root, path), "utf8");
  }

  it("mounts only on the approved pages and leaves Victory Room and play tracking alone", () => {
    expect(source("src/app/dashboard/page.tsx")).toContain(
      '<MemberSurfaceVisit surface="dashboard" />'
    );
    expect(source("src/app/ask-pat/page.tsx")).toContain(
      '<MemberSurfaceVisit surface="ask_pat" />'
    );
    expect(source("src/app/film-room/page.tsx")).toContain(
      '<MemberSurfaceVisit surface="film_room" />'
    );
    expect(source("src/app/film-room/[id]/page.tsx")).toContain(
      '<MemberSurfaceVisit surface="film_room" />'
    );
    expect(source("src/app/film-room/[id]/page.tsx")).toContain("FilmRoomPlayListener");
    expect(source("src/app/programs/page.tsx")).toContain(
      '<MemberSurfaceVisit surface="programs" />'
    );
    expect(source("src/app/programs/[collectionSlug]/[programSlug]/page.tsx")).toContain(
      '<MemberSurfaceVisit surface="programs" />'
    );
    expect(
      source("src/app/programs/[collectionSlug]/[programSlug]/[stepId]/page.tsx")
    ).toContain('<MemberSurfaceVisit surface="programs" />');

    const victory = source("src/app/dashboard/victory-room/page.tsx");
    expect(victory).toContain('eventType: "victory_room_visited"');
    expect(victory).not.toContain("MemberSurfaceVisit");
    expect(source("src/app/dashboard/layout.tsx")).not.toContain("MemberSurfaceVisit");
    expect(source("src/components/film-room-play-listener.tsx")).toContain(
      "/api/member-experience/film-play"
    );
    expect(source("src/components/film-room-play-listener.tsx")).not.toContain(
      "surface-visit"
    );
    expect(source("src/components/member-surface-visit.tsx")).toContain("useEffect");
    expect(source("src/app/dashboard/page.tsx")).not.toContain("recordMemberExperienceEvent");
  });
});
