"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useIsNativeSummittMindsetApp } from "@/components/native-app/NativeAppProvider";
import {
  parseLandingAssignments,
  PROUD_TEST_COOKIE,
} from "@/lib/landing-experiment-shared";

function readAssignmentCookie(): string | null {
  const parts = document.cookie.split("; ");
  const row = parts.find((part) => part.startsWith(`${PROUD_TEST_COOKIE}=`));
  if (!row) return null;
  try {
    return decodeURIComponent(row.slice(PROUD_TEST_COOKIE.length + 1));
  } catch {
    return null;
  }
}

/**
 * Renders nothing. Posts one exposure after the assigned destination is viewed.
 * Visitors without an assignment cookie do not make a request.
 */
export function ExperimentExposureBeacon() {
  const pathname = usePathname();
  const isNative = useIsNativeSummittMindsetApp();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (isNative || !pathname) return;
    const matches = parseLandingAssignments(readAssignmentCookie()).filter(
      (assignment) => assignment.path === pathname
    );
    if (matches.length === 0) return;
    const key = `${matches
      .map((assignment) => assignment.experimentId)
      .sort()
      .join(",")}:${pathname}`;
    if (sent.current === key) return;
    try {
      if (window.sessionStorage.getItem(key) === "1") return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Private mode can block storage. The server still ignores a repeat exposure.
    }
    sent.current = key;
    try {
      void fetch("/api/marketing/collect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify({
          event_type: "page_viewed",
          path: pathname,
          experiment_exposure: true,
        }),
      });
    } catch {
      // Analytics must not affect the page.
    }
  }, [pathname, isNative]);

  return null;
}
