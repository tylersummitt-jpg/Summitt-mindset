import { describe, expect, it, vi } from "vitest";
import {
  createWebkitAppleIapBridge,
  isAppleAppAccountTokenUuid,
  parseNativeToWebAppleIapEvent,
  serializeWebToNativeAppleIapCommand,
} from "./bridge";
import { APPLE_IAP_MONTHLY_PRODUCT_ID } from "./constants";

describe("Apple IAP web bridge", () => {
  it("accepts a UUID appAccountToken and rejects junk", () => {
    expect(
      isAppleAppAccountTokenUuid("550e8400-e29b-41d4-a716-446655440000")
    ).toBe(true);
    expect(isAppleAppAccountTokenUuid("not-a-uuid")).toBe(false);
    expect(isAppleAppAccountTokenUuid("")).toBe(false);
  });

  it("serializes only known commands without userId", () => {
    expect(serializeWebToNativeAppleIapCommand({ type: "ready" })).toEqual({
      type: "ready",
    });
    expect(
      serializeWebToNativeAppleIapCommand({
        type: "purchase",
        appAccountToken: "550e8400-e29b-41d4-a716-446655440000",
      })
    ).toEqual({
      type: "purchase",
      appAccountToken: "550e8400-e29b-41d4-a716-446655440000",
    });
    const purchase = JSON.stringify(
      serializeWebToNativeAppleIapCommand({
        type: "purchase",
        appAccountToken: "550e8400-e29b-41d4-a716-446655440000",
      })
    );
    expect(purchase).not.toContain("userId");
    expect(purchase).not.toContain("clerk");
  });

  it("parses StoreKit displayPrice products and rejects wrong product ids", () => {
    expect(
      parseNativeToWebAppleIapEvent({
        type: "products",
        productId: APPLE_IAP_MONTHLY_PRODUCT_ID,
        displayName: "Membership",
        displayPrice: "$29.00",
      })
    ).toEqual({
      type: "products",
      productId: APPLE_IAP_MONTHLY_PRODUCT_ID,
      displayName: "Membership",
      displayPrice: "$29.00",
    });
    expect(
      parseNativeToWebAppleIapEvent({
        type: "products",
        productId: "com.other.sku",
        displayName: "X",
        displayPrice: "$1.00",
      })
    ).toBeNull();
  });

  it("parses signedTransaction without treating extra fields as commands", () => {
    expect(
      parseNativeToWebAppleIapEvent({
        type: "signedTransaction",
        transactionId: "tx_1",
        jws: "aaa.bbb.ccc",
        clerkUserId: "user_attacker",
      })
    ).toEqual({
      type: "signedTransaction",
      transactionId: "tx_1",
      jws: "aaa.bbb.ccc",
    });
    expect(parseNativeToWebAppleIapEvent({ type: "explode" })).toBeNull();
  });

  it("posts JSON objects to the WK handler only", () => {
    const postMessage = vi.fn();
    const listeners = new Map<string, EventListener>();
    const target = {
      webkit: {
        messageHandlers: {
          summittAppleIap: { postMessage },
        },
      },
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    };
    const bridge = createWebkitAppleIapBridge(target);
    expect(bridge.isAvailable()).toBe(true);
    expect(bridge.post({ type: "requestProducts" })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "requestProducts" });
  });
});
