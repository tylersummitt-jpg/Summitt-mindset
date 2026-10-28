"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import type { PersonalVideoEventType } from "@/lib/personal-videos/analytics";
import {
  crossedMilestones,
  playedShare,
  type AcquisitionVideoEventType,
} from "@/lib/acquisition/video-milestones";

type VimeoPlayer = {
  on(event: "play" | "timeupdate" | "ended", callback: () => void): void;
  off(event: "play" | "timeupdate" | "ended", callback?: () => void): void;
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
    let lastReadMs = 0;
    const fired = new Set<string>();
    const post = (eventType: PersonalVideoEventType | AcquisitionVideoEventType) => {
      if (fired.has(eventType)) return;
      fired.add(eventType);
      postPersonalVideoEvent(eventType, personalVideoId, recipientToken, journeyToken);
    };
    post("personal_video_visited");

    async function readPlayed(force: boolean, ended: boolean) {
      if (!player) return;
      const now = Date.now();
      if (!force && now - lastReadMs < 1000) return;
      lastReadMs = now;
      try {
        const [played, duration] = await Promise.all([player.getPlayed(), player.getDuration()]);
        if (cancelled) return;
        for (const eventType of crossedMilestones({
          playedFraction: playedShare(played, duration),
          ended,
          already: fired,
        })) {
          post(eventType);
        }
      } catch {
        // A failed read stays missing. It is not recorded as zero watched.
      }
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
        instance.on("timeupdate", () => {
          void readPlayed(false, false);
        });
        instance.on("ended", () => {
          void readPlayed(true, true);
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
