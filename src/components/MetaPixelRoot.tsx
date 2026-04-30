"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { getMetaPixelId, trackPageView } from "@/lib/meta-pixel";

/**
 * Survives React Strict Mode remounts so we don't double-count the same route.
 */
let lastMetaPageViewRouteKey: string | null = null;

function buildRouteKey(pathname: string, search: string): string {
  return search ? `${pathname}?${search}` : pathname;
}

export function MetaPixelRoot() {
  const pixelId = getMetaPixelId();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";

  useEffect(() => {
    if (!pixelId) return;

    const routeKey = buildRouteKey(pathname, search);
    if (lastMetaPageViewRouteKey === routeKey) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 80;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (cancelled) return;
      if (lastMetaPageViewRouteKey === routeKey) return;

      if (typeof window === "undefined") return;
      const fbq = (window as Window & { fbq?: unknown }).fbq;
      if (typeof fbq === "function") {
        lastMetaPageViewRouteKey = routeKey;
        trackPageView();
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        if (timeoutId) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(tick, 40);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [pixelId, pathname, search]);

  if (!pixelId) {
    return null;
  }

  const inlineSnippet = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');`;

  return (
    <Script
      id="meta-pixel-fbq-stub"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: inlineSnippet }}
    />
  );
}
