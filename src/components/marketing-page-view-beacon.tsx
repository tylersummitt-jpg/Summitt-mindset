"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { useIsNativeSummittMindsetApp } from "@/components/native-app/NativeAppProvider";
import { isMarketingPageViewPath } from "@/lib/marketing-attribution-pure";

function firePageView(path: string) {
  try {
    void fetch("/api/marketing/collect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({ event_type: "page_viewed", path }),
    });
  } catch {
    // fail open
  }
}

export function MarketingPageViewBeacon() {
  const pathname = usePathname();
  const isNative = useIsNativeSummittMindsetApp();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (isNative) return;
    if (!pathname || !isMarketingPageViewPath(pathname)) return;
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    firePageView(pathname);
  }, [pathname, isNative]);

  return null;
}
