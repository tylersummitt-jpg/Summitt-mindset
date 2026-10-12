"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useIsNativeSummittMindsetApp } from "@/components/native-app/NativeAppProvider";
import {
  parseLandingAssignments,
  PROUD_TEST_COOKIE,
} from "@/lib/landing-experiment-shared";
import {
  ENGAGED_BUCKETS,
  SCROLL_MILESTONES,
  parseEngagedBucket,
  parseScrollMilestone,
} from "@/lib/landing-experiment-telemetry";

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
 * One behavior record per assigned visit. Direct visitors are not measured here.
 * Sends only when a section, scroll milestone, or engaged-time bucket increases.
 */
export function ExperimentBehaviorBeacon() {
  const pathname = usePathname();
  const isNative = useIsNativeSummittMindsetApp();

  useEffect(() => {
    if (isNative || !pathname) return;
    const assigned = parseLandingAssignments(readAssignmentCookie()).some(
      (assignment) => assignment.path === pathname
    );
    if (!assigned) return;

    const sections = new Set<string>();
    let scroll = 0;
    let engagedSeconds = 0;
    let sentScroll = 0;
    let sentEngaged = 0;
    let sentSections = 0;
    let lastActivity = Date.now();
    let visible = document.visibilityState === "visible";
    let timer: number | null = null;

    const payload = () =>
      JSON.stringify({
        event_type: "page_viewed",
        path: pathname,
        experiment_behavior: true,
        sections: [...sections],
        scroll,
        engaged: parseEngagedBucket(engagedSeconds),
      });

    const send = (keepalive = false) => {
      const nextScroll = parseScrollMilestone(scroll);
      const nextEngaged = parseEngagedBucket(engagedSeconds);
      if (nextScroll <= sentScroll && nextEngaged <= sentEngaged && sections.size <= sentSections) {
        return;
      }
      sentScroll = nextScroll;
      sentEngaged = nextEngaged;
      sentSections = sections.size;
      try {
        void fetch("/api/marketing/collect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          keepalive,
          body: payload(),
        });
      } catch {
        // Analytics must not affect the page.
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        let grew = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.expSection;
          if (!id || sections.has(id)) continue;
          sections.add(id);
          grew = true;
        }
        if (grew) send();
      },
      { threshold: 0.4 }
    );
    for (const node of document.querySelectorAll<HTMLElement>("[data-exp-section]")) {
      observer.observe(node);
    }

    const onScroll = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = height <= 0 ? 1 : window.scrollY / height;
      const milestone = SCROLL_MILESTONES.reduce(
        (best, mark) => (ratio * 100 >= mark ? mark : best),
        0
      );
      if (milestone > scroll) {
        scroll = milestone;
        send();
      }
    };

    const markActive = () => {
      lastActivity = Date.now();
    };

    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      if (visible) lastActivity = Date.now();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    document.addEventListener("visibilitychange", onVisibility);
    const onHide = () => send(true);
    window.addEventListener("pagehide", onHide);
    timer = window.setInterval(() => {
      if (!visible || Date.now() - lastActivity > 30_000) return;
      engagedSeconds += 1;
      const bucket = ENGAGED_BUCKETS.find((mark) => mark === engagedSeconds);
      if (bucket) send();
    }, 1000);
    onScroll();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      if (timer != null) window.clearInterval(timer);
    };
  }, [pathname, isNative]);

  return null;
}
