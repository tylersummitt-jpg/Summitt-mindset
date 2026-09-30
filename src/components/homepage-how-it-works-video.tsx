"use client";

import { useEffect, useRef } from "react";

import { useIsNativeSummittMindsetApp } from "@/components/native-app/NativeAppProvider";
import {
  playedFraction,
  type HomepageVideoEventType,
} from "@/lib/homepage-video";

type VimeoPlayer = {
  on(event: "playing" | "timeupdate" | "ended", callback: () => void): void;
  off(event: "playing" | "timeupdate" | "ended", callback?: () => void): void;
  destroy(): Promise<void>;
  getPlayed(): Promise<unknown>;
  getDuration(): Promise<number>;
};

const PRELOAD_ROOT_MARGIN = "400px";
const REACHED_ROOT_MARGIN = "0px";

function postHomepageVideoEvent(
  eventType: HomepageVideoEventType,
  videoId: string,
  isNative: boolean
) {
  if (isNative) return;
  try {
    void fetch("/api/marketing/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        event_type: eventType,
        path: "/",
        vimeo_video_id: videoId,
      }),
    });
  } catch {
    // fail open — the trial CTA does not depend on analytics
  }
}

export function HomepageHowItWorksVideo({ videoId }: { videoId: string }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const isNative = useIsNativeSummittMindsetApp();

  useEffect(() => {
    const shell = shellRef.current;
    const mount = mountRef.current;
    if (!shell || !mount) return;
    if (typeof IntersectionObserver === "undefined") return;

    let cancelled = false;
    let player: VimeoPlayer | null = null;
    let preloadObserver: IntersectionObserver | null = null;
    let reachedObserver: IntersectionObserver | null = null;
    let lastPlayedCheckMs = 0;
    const onPlaying = () => post("homepage_video_started");
    const onTimeUpdate = () => {
      void readPlayedFraction(false);
    };
    const onEnded = () => {
      void readPlayedFraction(true).then((fraction) => {
        if (fraction != null && fraction >= 0.9) post("homepage_video_completed");
      });
    };
    const fired: Record<HomepageVideoEventType, boolean> = {
      homepage_video_reached: false,
      homepage_video_started: false,
      homepage_video_50: false,
      homepage_video_completed: false,
    };

    function post(eventType: HomepageVideoEventType) {
      if (fired[eventType]) return;
      fired[eventType] = true;
      postHomepageVideoEvent(eventType, videoId, isNative);
    }

    async function readPlayedFraction(force: boolean): Promise<number | null> {
      if (!player) return null;
      const now = Date.now();
      if (!force && now - lastPlayedCheckMs < 1000) return null;
      lastPlayedCheckMs = now;
      try {
        const [played, duration] = await Promise.all([
          player.getPlayed(),
          player.getDuration(),
        ]);
        if (cancelled) return null;
        const fraction = playedFraction(played, duration);
        if (fraction != null && fraction >= 0.5) post("homepage_video_50");
        return fraction;
      } catch {
        return null;
      }
    }

    function destroyPlayer() {
      if (!player) return;
      const current = player;
      player = null;
      try {
        current.off("playing", onPlaying);
        current.off("timeupdate", onTimeUpdate);
        current.off("ended", onEnded);
      } catch {
        // fail open
      }
      void current.destroy().catch(() => {
        // fail open
      });
    }

    reachedObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries.some(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5
        );
        if (!visible) return;
        post("homepage_video_reached");
        reachedObserver?.disconnect();
        reachedObserver = null;
      },
      { root: null, rootMargin: REACHED_ROOT_MARGIN, threshold: 0.5 }
    );
    reachedObserver.observe(shell);

    preloadObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        preloadObserver?.disconnect();
        preloadObserver = null;
        void (async () => {
          try {
            const mod = await import("@vimeo/player");
            if (cancelled || !mountRef.current) return;
            const PlayerCtor = mod.default;
            const instance = new PlayerCtor(mountRef.current, {
              id: Number(videoId),
              dnt: true,
            }) as VimeoPlayer;
            if (cancelled) {
              void instance.destroy().catch(() => {});
              return;
            }
            player = instance;
            instance.on("playing", onPlaying);
            instance.on("timeupdate", onTimeUpdate);
            instance.on("ended", onEnded);
          } catch {
            // placeholder stays; CTA is outside this component
          }
        })();
      },
      { root: null, rootMargin: PRELOAD_ROOT_MARGIN, threshold: 0 }
    );
    preloadObserver.observe(shell);

    return () => {
      cancelled = true;
      preloadObserver?.disconnect();
      reachedObserver?.disconnect();
      destroyPlayer();
    };
  }, [isNative, videoId]);

  return (
    <div
      ref={shellRef}
      data-homepage-video-shell=""
      className="relative mx-auto mt-10 aspect-video w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 shadow-lg shadow-black/25"
    >
      <div
        ref={mountRef}
        className="absolute inset-0 [&_iframe]:!absolute [&_iframe]:!inset-0 [&_iframe]:!h-full [&_iframe]:!w-full"
      />
    </div>
  );
}
