"use client";

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { getMetaPageViewDecision } from "@/lib/meta-pixel-route-policy";
import { getMetaPixelId, isMetaPixelEnabled, trackSafePageView } from "@/lib/meta-pixel";

/**
 * Survives React Strict Mode remounts — pathname-only dedupe (no query string).
 */
let lastMetaPageViewPathname: string | null = null;

function MetaPixelInner({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ?? "";

  useEffect(() => {
    const decision = getMetaPageViewDecision(pathname, search);
    if (decision.action === "block") {
      return;
    }

    const pagePath = decision.pagePath;
    if (lastMetaPageViewPathname === pagePath) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 80;
    let timeoutId: number | null = null;

    const tick = () => {
      if (cancelled) return;
      if (lastMetaPageViewPathname === pagePath) return;

      if (typeof window === "undefined") return;
      const fbq = (window as Window & { fbq?: unknown }).fbq;
      if (typeof fbq === "function") {
        lastMetaPageViewPathname = pagePath;
        trackSafePageView(pathname, search);
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(tick, 40);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [pixelId, pathname, search]);

  const inlineSnippet = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');`;

  return (
    <Script
      id="meta-pixel-fbq-stub"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: inlineSnippet }}
    />
  );
}

export function MetaPixelRoot() {
  const pixelId = getMetaPixelId();

  if (!pixelId || !isMetaPixelEnabled()) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <MetaPixelInner pixelId={pixelId} />
    </Suspense>
  );
}
