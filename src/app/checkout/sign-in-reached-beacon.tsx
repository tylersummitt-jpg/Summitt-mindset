"use client";

import { useEffect } from "react";

/**
 * Tells our server that this sign-in page's JavaScript ran.
 * The server uses the existing httpOnly binding cookie. This component
 * sends no checkout id, and a failure does not affect Clerk.
 */
export function CheckoutSignInReachedBeacon() {
  useEffect(() => {
    if (typeof fetch !== "function") return;
    void fetch("/api/checkout/stripe-first/sign-in-reached", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }, []);
  return null;
}
