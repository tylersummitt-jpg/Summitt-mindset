/**
 * Minimal WKWebView ↔ web Apple IAP bridge.
 *
 * Web owns Clerk auth. Native owns StoreKit. This module only serializes
 * known JSON command/event shapes. It never reads cookies, user IDs, or JWS
 * as membership authority.
 */

import {
  APPLE_IAP_MONTHLY_PRODUCT_ID,
  APPLE_IAP_WEBKIT_HANDLER,
  APPLE_IAP_WINDOW_EVENT,
} from "./constants";

export type WebToNativeAppleIapCommand =
  | { type: "ready" }
  | { type: "requestProducts" }
  | { type: "purchase"; appAccountToken: string }
  | { type: "restore" }
  | { type: "backendVerified"; transactionId: string };

export type NativeToWebAppleIapEvent =
  | { type: "bridgeReady" }
  | {
      type: "products";
      productId: string;
      displayName: string;
      displayPrice: string;
    }
  | { type: "productsUnavailable" }
  | { type: "signedTransaction"; transactionId: string; jws: string }
  | { type: "purchaseCancelled" }
  | { type: "purchasePending" }
  | {
      type: "purchaseFailed";
      code: "unverified" | "invalid_token" | "unavailable" | "unknown";
    }
  | { type: "restoreEmpty" };

export type AppleIapBridgePort = {
  isAvailable: () => boolean;
  post: (command: WebToNativeAppleIapCommand) => boolean;
  subscribe: (handler: (event: NativeToWebAppleIapEvent) => void) => () => void;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAppleAppAccountTokenUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseNativeToWebAppleIapEvent(
  raw: unknown
): NativeToWebAppleIapEvent | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (type === "bridgeReady") return { type: "bridgeReady" };
  if (type === "productsUnavailable") return { type: "productsUnavailable" };
  if (type === "purchaseCancelled") return { type: "purchaseCancelled" };
  if (type === "purchasePending") return { type: "purchasePending" };
  if (type === "restoreEmpty") return { type: "restoreEmpty" };
  if (type === "products") {
    const productId =
      typeof raw.productId === "string" ? raw.productId.trim() : "";
    const displayName =
      typeof raw.displayName === "string" ? raw.displayName : "";
    const displayPrice =
      typeof raw.displayPrice === "string" ? raw.displayPrice.trim() : "";
    if (productId !== APPLE_IAP_MONTHLY_PRODUCT_ID || !displayPrice) {
      return null;
    }
    return { type: "products", productId, displayName, displayPrice };
  }
  if (type === "signedTransaction") {
    const transactionId =
      typeof raw.transactionId === "string" ? raw.transactionId.trim() : "";
    const jws = typeof raw.jws === "string" ? raw.jws.trim() : "";
    if (!transactionId || !jws) return null;
    return { type: "signedTransaction", transactionId, jws };
  }
  if (type === "purchaseFailed") {
    const code = raw.code;
    if (
      code === "unverified" ||
      code === "invalid_token" ||
      code === "unavailable" ||
      code === "unknown"
    ) {
      return { type: "purchaseFailed", code };
    }
    return { type: "purchaseFailed", code: "unknown" };
  }
  return null;
}

export function serializeWebToNativeAppleIapCommand(
  command: WebToNativeAppleIapCommand
): Record<string, string> {
  switch (command.type) {
    case "ready":
    case "requestProducts":
    case "restore":
      return { type: command.type };
    case "purchase":
      return { type: "purchase", appAccountToken: command.appAccountToken };
    case "backendVerified":
      return { type: "backendVerified", transactionId: command.transactionId };
  }
}

type WebkitWindow = Window & {
  webkit?: {
    messageHandlers?: Record<string, { postMessage: (body: unknown) => void }>;
  };
};

export function createWebkitAppleIapBridge(
  target: Pick<WebkitWindow, "webkit" | "addEventListener" | "removeEventListener"> | null = typeof window === "undefined" ? null : window
): AppleIapBridgePort {
  return {
    isAvailable() {
      return Boolean(
        target?.webkit?.messageHandlers?.[APPLE_IAP_WEBKIT_HANDLER]?.postMessage
      );
    },
    post(command) {
      const handler =
        target?.webkit?.messageHandlers?.[APPLE_IAP_WEBKIT_HANDLER];
      if (!handler) return false;
      handler.postMessage(serializeWebToNativeAppleIapCommand(command));
      return true;
    },
    subscribe(handler) {
      if (!target) return () => {};
      const listener = (event: Event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        const parsed = parseNativeToWebAppleIapEvent(detail);
        if (parsed) handler(parsed);
      };
      target.addEventListener(APPLE_IAP_WINDOW_EVENT, listener as EventListener);
      return () => {
        target.removeEventListener(
          APPLE_IAP_WINDOW_EVENT,
          listener as EventListener
        );
      };
    },
  };
}
