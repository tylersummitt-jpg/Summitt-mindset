"use client";

import { useEffect } from "react";

type Playable = {
  on(event: "play", callback: () => void): void;
  off(event: "play", callback?: () => void): void;
};

export function FilmRoomPlayListener({ filmId }: { filmId: string }) {
  useEffect(() => {
    const iframe = document.querySelector<HTMLIFrameElement>("iframe[data-film-room-player]");
    if (!iframe) return;

    let cancelled = false;
    let posted = false;
    let player: Playable | null = null;
    const onPlay = () => {
      if (cancelled || posted) return;
      posted = true;
      try {
        void fetch("/api/member-experience/film-play", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          keepalive: true,
          body: JSON.stringify({ filmId }),
        }).catch(() => {});
      } catch {
        // Playback does not depend on the event write.
      }
    };

    void import("@vimeo/player")
      .then((mod) => {
        if (cancelled) return;
        const instance = new mod.default(iframe) as Playable;
        player = instance;
        instance.on("play", onPlay);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      try {
        player?.off("play", onPlay);
      } catch {
        // The player can already be gone during navigation.
      }
    };
  }, [filmId]);

  return null;
}
