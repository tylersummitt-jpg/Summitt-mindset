"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import type { PersonalVideoEventType } from "@/lib/personal-videos/analytics";
import {
  accumulateForwardPlayback,
  accumulatedShare,
  crossedMilestones,
  emptyPlaybackProgress,
  preferredPlayedShare,
  type AcquisitionVideoEventType,
  type PlaybackProgress,
} from "@/lib/acquisition/video-milestones";

type VimeoTimeEvent = {
  seconds?: unknown;
  duration?: unknown;
  percent?: unknown;
};

type VimeoPlayer = {
  on(event: "play" | "timeupdate" | "ended", callback: (data?: VimeoTimeEvent) => void): void;
  off(event: "play" | "timeupdate" | "ended", callback?: (data?: VimeoTimeEvent) => void): void;
  destroy(): Promise<void>;
  getPlayed(): Promise<unknown>;
  getDuration(): Promise<unknown>;
};

function postPersonalVideoEvent(
  eventType: PersonalVideoEventType | AcquisitionVideoEventType,
  personalVideoId: string,
  recipientToken?: string | null,
  journeyToken?: string | null,
) {
  try {
    void fetch("/api/marketing/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        event_type: eventType,
        personal_video_id: personalVideoId,
        ...(recipientToken ? { recipient_token: recipientToken } : {}),
        ...(journeyToken ? { acquisition_journey: journeyToken } : {}),
      }),
    });
  } catch {
    // The video and trial button still work if analytics does not.
  }
}

export function PersonalVideoPlayer({
  playerSrc,
  personalVideoId,
  recipientToken = null,
  journeyToken = null,
  track,
}: {
  playerSrc: string;
  personalVideoId: string;
  recipientToken?: string | null;
  journeyToken?: string | null;
  track: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    let player: VimeoPlayer | null = null;
    let lastPlayedReadMs = 0;
    let progress: PlaybackProgress = emptyPlaybackProgress();
    let lastDuration: number | null = null;
    const fired = new Set<string>();
    const post = (eventType: PersonalVideoEventType | AcquisitionVideoEventType) => {
      if (fired.has(eventType)) return;
      fired.add(eventType);
      postPersonalVideoEvent(eventType, personalVideoId, recipientToken, journeyToken);
    };
    post("personal_video_visited");

    function emitMilestones(playedFraction: number | null, ended: boolean) {
      for (const eventType of crossedMilestones({ playedFraction, ended, already: fired })) {
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
          // Prefer timeupdate accumulation when played ranges cannot be read.
        }
      }
      if (cancelled) return;
      if (share == null) {
        share = accumulatedShare(progress, data?.duration ?? lastDuration);
      }
      emitMilestones(share, ended);
    }

    void import("@vimeo/player")
      .then((mod) => {
        if (cancelled || !frameRef.current) return;
        const instance = new mod.default(frameRef.current) as VimeoPlayer;
        if (cancelled) {
          void instance.destroy().catch(() => {});
          return;
        }
        player = instance;
        instance.on("play", () => {
          post("personal_video_played");
        });
        if (!recipientToken) return;
        post("personal_video_player_ready");
        instance.on("timeupdate", (data) => {
          void onTimeUpdate(data, false);
        });
        instance.on("ended", (data) => {
          void onTimeUpdate(data, true);
        });
      })
      .catch(() => {});
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
        // fail open
      }
      void current.destroy().catch(() => {});
    };
  }, [journeyToken, personalVideoId, recipientToken, track]);

  return (
    <div className="relative mt-8 aspect-video overflow-hidden rounded-2xl bg-black">
      <iframe
        ref={frameRef}
        title="A personal message from Tyler Summitt"
        src={playerSrc}
        className="absolute inset-0 h-full w-full"
        allow="fullscreen; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

export function PersonalVideoTrialLink({
  href,
  className,
  personalVideoId,
  recipientToken = null,
  journeyToken = null,
  track,
  children,
}: {
  href: string;
  className: string;
  personalVideoId: string;
  recipientToken?: string | null;
  journeyToken?: string | null;
  track: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (!track) return;
        postPersonalVideoEvent("personal_video_cta_clicked", personalVideoId, recipientToken, journeyToken);
      }}
    >
      {children}
    </Link>
  );
}
