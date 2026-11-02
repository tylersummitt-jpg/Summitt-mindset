"use client";

import { useEffect } from "react";
import {
  SCREEN_READY_TIMEOUT_MS,
  classifyNavigation,
  classifyStartup,
  navigationSurfaceFromPath,
  shouldRecordStall,
  type NavigationSurface,
} from "@/lib/mobile-measurement";

type NativeSnapshot = { kind: string; elapsedMs?: number; measurementId?: string };

type PendingNavigation = {
  token: string;
  surface: NavigationSurface;
  startedAt: number;
  timer: number;
};

let watchInstalled = false;
let pending: PendingNavigation | null = null;
const settled = new Set<string>();

function installNavigationWatch() {
  if (watchInstalled || typeof document === "undefined") return;
  watchInstalled = true;
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      let path = "";
      try {
        path = new URL(href, window.location.href).pathname;
      } catch {
        return;
      }
      if (new URL(href, window.location.href).origin !== window.location.origin) return;
      const surface = navigationSurfaceFromPath(path);
      cancelPending();
      if (!surface) return;
      const token =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `nav-${Date.now()}`;
      const timer = window.setTimeout(() => {
        if (!pending || pending.token !== token) return;
        const stalled = pending;
        pending = null;
        if (!shouldRecordStall({ hidden: document.visibilityState === "hidden", superseded: false })) return;
        void postMeasurement({
          record: "navigation_failed",
          measurementId: stalled.token,
          surface: stalled.surface,
          launchKind: "navigation",
        });
      }, SCREEN_READY_TIMEOUT_MS);
      pending = { token, surface, startedAt: performance.now(), timer };
    },
    true
  );
}

function cancelPending() {
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending = null;
}

function takePending(surface: NavigationSurface): PendingNavigation | null {
  if (!pending || pending.surface !== surface) return null;
  const current = pending;
  window.clearTimeout(current.timer);
  pending = null;
  return current;
}

async function readNativeSnapshot(): Promise<NativeSnapshot | null> {
  const host = window as Window & {
    SummittLaunchTiming?: { snapshot?: () => string; acknowledge?: (id: string) => void };
    webkit?: { messageHandlers?: { summittLaunchTiming?: { postMessage?: (body: unknown) => Promise<unknown> } } };
  };
  try {
    if (typeof host.SummittLaunchTiming?.snapshot === "function") {
      return JSON.parse(host.SummittLaunchTiming.snapshot()) as NativeSnapshot;
    }
    const post = host.webkit?.messageHandlers?.summittLaunchTiming?.postMessage;
    if (typeof post === "function") {
      return (await post({ action: "snapshot" })) as NativeSnapshot;
    }
  } catch {
    return null;
  }
  return null;
}

async function acknowledgeNative(measurementId: string | undefined) {
  if (!measurementId) return;
  const host = window as Window & {
    SummittLaunchTiming?: { acknowledge?: (id: string) => void };
    webkit?: { messageHandlers?: { summittLaunchTiming?: { postMessage?: (body: unknown) => Promise<unknown> } } };
  };
  try {
    if (typeof host.SummittLaunchTiming?.acknowledge === "function") {
      host.SummittLaunchTiming.acknowledge(measurementId);
      return;
    }
    const post = host.webkit?.messageHandlers?.summittLaunchTiming?.postMessage;
    if (typeof post === "function") {
      await post({ action: "acknowledge", measurementId });
    }
  } catch {
    // The page does not depend on the clock.
  }
}

function readInteractiveAuth(): boolean {
  try {
    return sessionStorage.getItem("summitt-interactive-auth") === "1";
  } catch {
    return false;
  }
}

function clearInteractiveAuth() {
  try {
    sessionStorage.removeItem("summitt-interactive-auth");
  } catch {
    // Storage can throw. The flag already read still decides this launch.
  }
}

async function postMeasurement(body: {
  record: "startup" | "navigation" | "startup_failed" | "navigation_failed";
  measurementId: string;
  surface: NavigationSurface;
  launchKind: "cold" | "warm" | "navigation";
  elapsedMs?: number;
}): Promise<boolean> {
  const key = `${body.record}:${body.measurementId}`;
  if (settled.has(key)) return false;
  settled.add(key);
  try {
    const response = await fetch("/api/member-experience/app-measurement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      settled.delete(key);
      return false;
    }
    return true;
  } catch {
    settled.delete(key);
    return false;
  }
}

async function reportStartup(hidden: () => boolean) {
  const snapshot = await readNativeSnapshot();
  if (!snapshot?.measurementId) return;
  const interactiveAuth = readInteractiveAuth();
  if (interactiveAuth) clearInteractiveAuth();
  const decision = classifyStartup({
    interactiveAuth,
    hidden: hidden(),
    kind: snapshot.kind,
    elapsedMs: snapshot.elapsedMs,
  });
  if (decision.action === "ignore") return;
  if (decision.action === "drop") {
    await acknowledgeNative(snapshot.measurementId);
    return;
  }
  const recorded = await postMeasurement({
    record: "startup",
    measurementId: snapshot.measurementId,
    surface: "victory_room",
    launchKind: snapshot.kind === "warm" ? "warm" : "cold",
    elapsedMs: decision.elapsedMs,
  });
  if (recorded) await acknowledgeNative(snapshot.measurementId);
}

export function InteractiveAuthMarker() {
  useEffect(() => {
    cancelPending();
    const mark = () => {
      cancelPending();
      try {
        sessionStorage.setItem("summitt-interactive-auth", "1");
      } catch {
        // Without storage, this sign-in is not separately classified.
      }
    };
    document.addEventListener("submit", mark, true);
    return () => document.removeEventListener("submit", mark, true);
  }, []);
  return null;
}

export function AcknowledgeLaunchWithoutVictoryRoom() {
  useEffect(() => {
    let cancelled = false;
    void readNativeSnapshot().then((snapshot) => {
      if (cancelled) return;
      void acknowledgeNative(snapshot?.measurementId);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}

export function DismissMeasuredNavigation({ surface }: { surface: NavigationSurface }) {
  useEffect(() => {
    installNavigationWatch();
    takePending(surface);
  }, [surface]);
  return null;
}

export function UsableScreenMarker({
  surface,
  startup = false,
}: {
  surface: NavigationSurface;
  startup?: boolean;
}) {
  useEffect(() => {
    installNavigationWatch();
    let cancelled = false;
    let painted = false;
    const hidden = () => cancelled || document.visibilityState === "hidden";
    const onForeground = () => {
      if (!startup || !painted || hidden()) return;
      void reportStartup(hidden);
    };
    (window as Window & { __summittNativeForeground?: () => void }).__summittNativeForeground = onForeground;

    const timer = window.setTimeout(() => {
      if (!startup || painted || !shouldRecordStall({ hidden: hidden(), superseded: cancelled })) return;
      if (readInteractiveAuth()) {
        clearInteractiveAuth();
        void readNativeSnapshot().then((snapshot) => acknowledgeNative(snapshot?.measurementId));
        return;
      }
      void readNativeSnapshot().then((snapshot) => {
        if (!snapshot?.measurementId || snapshot.kind === "none" || snapshot.kind === "navigation") return;
        if (hidden()) return;
        void postMeasurement({
          record: "startup_failed",
          measurementId: snapshot.measurementId,
          surface: "victory_room",
          launchKind: snapshot.kind === "warm" ? "warm" : "cold",
        }).then((recorded) => {
          if (recorded) void acknowledgeNative(snapshot.measurementId);
        });
      });
    }, SCREEN_READY_TIMEOUT_MS);

    const first = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        painted = true;
        window.clearTimeout(timer);
        const navigation = takePending(surface);
        if (navigation) {
          const decision = classifyNavigation({
            hidden: hidden(),
            elapsedMs: Math.round(performance.now() - navigation.startedAt),
          });
          if (decision.action === "record") {
            void postMeasurement({
              record: "navigation",
              measurementId: navigation.token,
              surface,
              launchKind: "navigation",
              elapsedMs: decision.elapsedMs,
            });
          }
        }
        if (startup) void reportStartup(hidden);
      });
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(first);
    };
  }, [surface, startup]);
  return null;
}
