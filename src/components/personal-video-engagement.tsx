"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import type { PersonalVideoEventType } from "@/lib/personal-videos/analytics";

type VimeoPlayer = {
  on(event: "play", callback: () => void): void;
  off(event: "play", callback?: () => void): void;
  destroy(): Promise<void>;
};

function postPersonalVideoEvent(
  eventType: PersonalVideoEventType,
  personalVideoId: string,
  recipientToken?: string | null
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
  track,
}: {
  playerSrc: string;
  personalVideoId: string;
  recipientToken?: string | null;
  track: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    let player: VimeoPlayer | null = null;
    const played = { current: false };
    postPersonalVideoEvent("personal_video_visited", personalVideoId, recipientToken);
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
          if (played.current) return;
          played.current = true;
          postPersonalVideoEvent("personal_video_played", personalVideoId, recipientToken);
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
      } catch {
        // fail open
      }
      void current.destroy().catch(() => {});
    };
  }, [personalVideoId, recipientToken, track]);

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
  track,
  children,
}: {
  href: string;
  className: string;
  personalVideoId: string;
  recipientToken?: string | null;
  track: boolean;
  children: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (!track) return;
        postPersonalVideoEvent("personal_video_cta_clicked", personalVideoId, recipientToken);
      }}
    >
      {children}
    </Link>
  );
}
