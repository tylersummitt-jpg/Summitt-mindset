"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useIsNativeSummittMindsetApp } from "@/components/native-app/NativeAppProvider";
import {
  isTrialAcquisitionHref,
  trialCtaSurfaceFromHref,
} from "@/lib/marketing-attribution-pure";

function fireCta(path: string, href: string, ctaSurface: string) {
  try {
    void fetch("/api/marketing/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        event_type: "trial_cta_clicked",
        path,
        cta_surface: ctaSurface,
        href,
      }),
    });
  } catch {
    // fail open
  }
}

export function MarketingCtaCapture() {
  const pathname = usePathname();
  const isNative = useIsNativeSummittMindsetApp();

  useEffect(() => {
    if (isNative) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-growth-ignore]")) return;
      const marked = target.closest("[data-growth-cta='trial']");
      const anchor = target.closest("a");
      const href = anchor?.getAttribute("href") ?? "";
      if (marked) {
        const markedHref =
          marked instanceof HTMLAnchorElement
            ? marked.getAttribute("href") ?? href
            : href;
        fireCta(
          pathname ?? "/",
          markedHref,
          marked.getAttribute("data-growth-surface") ||
            trialCtaSurfaceFromHref(markedHref, pathname)
        );
        return;
      }
      if (!anchor || !href) return;
      if (!isTrialAcquisitionHref(href)) return;
      fireCta(pathname ?? "/", href, trialCtaSurfaceFromHref(href, pathname));
    };

    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [pathname, isNative]);

  return null;
}
