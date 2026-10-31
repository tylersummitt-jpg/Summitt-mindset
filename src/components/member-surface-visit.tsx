"use client";

import { useEffect } from "react";
import type { MemberSurface } from "@/lib/member-surface";

export function MemberSurfaceVisit({ surface }: { surface: MemberSurface }) {
  useEffect(() => {
    try {
      void fetch("/api/member-experience/surface-visit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({ surface }),
      }).catch(() => {});
    } catch {
      // The page does not depend on the visit write.
    }
  }, [surface]);

  return null;
}
