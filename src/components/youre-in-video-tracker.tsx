"use client";

import { useEffect } from "react";

import {
  accumulateForwardPlayback,
  accumulatedShare,
  emptyPlaybackProgress,
  preferredPlayedShare,
  type PlaybackProgress,
} from "@/lib/acquisition/video-milestones";
import {
  crossedYoureInWatchMilestones,
  type YoureInVideoEventType,
} from "@/lib/youre-in-video";

type VimeoTimeEvent = {
  seconds?: unknown;
  duration?: unknown;
};

type VimeoPlayer = {
  on(event: "play" | "timeupdate" | "ended", callback: (data?: VimeoTimeEvent) => void): void;
  off(event: "play" | "timeupdate" | "ended", callback?: (data?: VimeoTimeEvent) => void): void;
  getPlayed(): Promise<unknown>;
  getDuration(): Promise<unknown>;
};

const PLAYER_SELECTOR = "iframe[data-youre-in-player]";

function postYoureInEvent(eventType: YoureInVideoEventType) {
  try {
    void fetch("/api/member-experience/youre-in-video", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ event: eventType }),
    }).catch(() => {
      // Playback and Enter the Film Room do not depend on this write.
    });
  } catch {
    // Playback and Enter the Film Room do not depend on this write.
  }
}

export function YoureInVideoTracker() {
  useEffect(() => {
    let cancelled = false;
    let player: VimeoPlayer | null = null;
    let lastPlayedReadMs = 0;
    let progress: PlaybackProgress = emptyPlaybackProgress();
    let lastDuration: number | null = null;
    const fired = new Set<string>();

    const post = (eventType: YoureInVideoEventType) => {
      if (cancelled || fired.has(eventType)) return;
      fired.add(eventType);
      postYoureInEvent(eventType);
    };

    post("youre_in_page_reached");

    const iframe = document.querySelector<HTMLIFrameElement>(PLAYER_SELECTOR);
    if (!iframe) return;

    function emit(playedFraction: number | null, ended: boolean) {
      for (const eventType of crossedYoureInWatchMilestones({
        playedFraction,
        ended,
        already: fired,
      })) {
        post(eventType);
      }
    }

    async function onTimeUpdate(data: VimeoTimeEvent | undefined, ended: boolean) {
      if (data && (typeof data.duration === "number" || typeof data.duration === "string")) {
        const duration = Number(data.duration);
        if (Number.isFinite(duration) && duration > 0) lastDuration = duration;
      }
      if (data) {
        progress = accumulateForwardPlayback({
          progress,
          seconds: data.seconds,
          duration: data.duration ?? lastDuration,
        });
      }

      let share: number | null = null;
      const now = Date.now();
      const shouldReadPlayed = Boolean(player) && (ended || now - lastPlayedReadMs >= 1000);
      if (shouldReadPlayed && player) {
        lastPlayedReadMs = now;
        try {
          const [played, duration] = await Promise.all([player.getPlayed(), player.getDuration()]);
          if (!cancelled) {
            if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
              lastDuration = duration;
            }
            share = preferredPlayedShare(played, duration);
          }
        } catch {
          // Fall back to continuous timeupdate progress when ranges cannot be read.
        }
      }
      if (cancelled) return;
      if (share == null) share = accumulatedShare(progress, data?.duration ?? lastDuration);
      emit(share, ended);
    }

    void import("@vimeo/player")
      .then((mod) => {
        if (cancelled || !iframe.isConnected) return;
        const instance = new mod.default(iframe) as VimeoPlayer;
        if (cancelled) return;
        player = instance;
        instance.on("play", () => {
          post("youre_in_video_started");
        });
        instance.on("timeupdate", (data) => {
          void onTimeUpdate(data, false);
        });
        instance.on("ended", (data) => {
          void onTimeUpdate(data, true);
        });
      })
      .catch(() => {
        // A missing player still leaves the page and the finish button usable.
      });

    return () => {
      cancelled = true;
      const current = player;
      player = null;
      if (!current) return;
      try {
        current.off("play");
        current.off("timeupdate");
        current.off("ended");
      } catch {
        // The player can already be gone during navigation.
      }
    };
  }, []);

  return null;
}
