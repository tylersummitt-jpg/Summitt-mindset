"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useRef } from "react";

/**
 * One-shot POST /api/attribution/coach after coach funnel auth when redirect_url targets /subscribe?src=coach.
 * Silent; does not block Clerk UI.
 */
export function CoachAttributionSync({ enabled }: { enabled: boolean }) {
  const { isLoaded, isSignedIn } = useUser();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !isLoaded || !isSignedIn) return;
    if (firedRef.current) return;
    firedRef.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/attribution/coach", {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          if (process.env.NODE_ENV === "development") {
            const text = await res.text().catch(() => "");
            console.warn("[CoachAttributionSync]", res.status, text);
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[CoachAttributionSync] fetch failed", err);
        }
      }
    })();
  }, [enabled, isLoaded, isSignedIn]);

  return null;
}
