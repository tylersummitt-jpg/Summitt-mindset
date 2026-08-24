import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IosAppleMembershipPanel from "@/components/ios-apple-membership-panel";
import { APPLE_IAP_MONTHLY_PRODUCT_ID } from "@/lib/native-apple-iap/constants";
import type {
  AppleIapBridgePort,
  NativeToWebAppleIapEvent,
  WebToNativeAppleIapCommand,
} from "@/lib/native-apple-iap/bridge";

const reload = vi.fn(async () => {});
const refresh = vi.fn();
const push = vi.fn();

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({ user: { reload } }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

function createMockBridge(): AppleIapBridgePort & {
  handlers: Array<(event: NativeToWebAppleIapEvent) => void>;
  posted: WebToNativeAppleIapCommand[];
  emit: (event: NativeToWebAppleIapEvent) => void;
} {
  const handlers: Array<(event: NativeToWebAppleIapEvent) => void> = [];
  const posted: WebToNativeAppleIapCommand[] = [];
  return {
    handlers,
    posted,
    isAvailable: () => true,
    post(command) {
      posted.push(command);
      return true;
    },
    subscribe(handler) {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    emit(event) {
      for (const handler of handlers) handler(event);
    },
  };
}

describe("IosAppleMembershipPanel", () => {
  afterEach(() => {
    cleanup();
    reload.mockClear();
    refresh.mockClear();
    push.mockClear();
  });

  it("waits for the native bridge before enabling purchase", () => {
    const bridge = createMockBridge();
    render(<IosAppleMembershipPanel bridge={bridge} />);
    expect(bridge.posted).toEqual([{ type: "ready" }]);
    expect((screen.getByTestId("apple-iap-subscribe") as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByTestId("apple-iap-display-price").textContent).toBe("—");
  });

  it("shows StoreKit displayPrice and no hardcoded $29", async () => {
    const bridge = createMockBridge();
    render(<IosAppleMembershipPanel bridge={bridge} />);
    bridge.emit({ type: "bridgeReady" });
    bridge.emit({
      type: "products",
      productId: APPLE_IAP_MONTHLY_PRODUCT_ID,
      displayName: "Summitt Mindset",
      displayPrice: "US$4.99",
    });
    expect(await screen.findByText("US$4.99")).toBeTruthy();
    expect((screen.getByTestId("apple-iap-subscribe") as HTMLButtonElement).disabled).toBe(
      false
    );
    expect(document.body.textContent).not.toMatch(/\$29/);
    expect(document.body.textContent).not.toMatch(/managed on the Summitt Mindset website/i);
    expect(screen.getByText("Privacy Policy")).toBeTruthy();
    expect(screen.getByText("Terms of Use")).toBeTruthy();
  });

  it("lists paid membership benefits before Subscribe with Apple", async () => {
    const bridge = createMockBridge();
    render(<IosAppleMembershipPanel bridge={bridge} />);
    bridge.emit({ type: "bridgeReady" });
    bridge.emit({
      type: "products",
      productId: APPLE_IAP_MONTHLY_PRODUCT_ID,
      displayName: "Summitt Mindset",
      displayPrice: "US$4.99",
    });
    expect(await screen.findByText("US$4.99")).toBeTruthy();
    expect(screen.getByText("Membership includes:")).toBeTruthy();
    expect(
      screen.getByText("Victory Room for your identity, Current Goal, and Wins")
    ).toBeTruthy();
    expect(
      screen.getByText("Ask Pat coaching inspired by Pat Summitt’s standards")
    ).toBeTruthy();
    expect(screen.getByText("Film Room leadership lessons")).toBeTruthy();
    expect(screen.getByText("Restore Purchases")).toBeTruthy();
    expect(screen.getByText("Privacy Policy")).toBeTruthy();
    expect(screen.getByText("Terms of Use")).toBeTruthy();

    const body = document.body.textContent ?? "";
    expect(body.indexOf("Membership includes:")).toBeGreaterThan(-1);
    expect(body.indexOf("Membership includes:")).toBeLessThan(
      body.indexOf("Subscribe with Apple")
    );
    expect(body).not.toMatch(/\$29/);
    expect(body).not.toContain("/subscribe");
  });

  it("passes the account-token UUID to native purchase and verifies JWS", async () => {
    const bridge = createMockBridge();
    const fetchAccountToken = vi.fn(async () => ({
      ok: true as const,
      appAccountToken: "550e8400-e29b-41d4-a716-446655440000",
    }));
    const verifyTransaction = vi.fn(async () => ({ kind: "verified" as const }));
    render(
      <IosAppleMembershipPanel
        bridge={bridge}
        fetchAccountToken={fetchAccountToken}
        verifyTransaction={verifyTransaction}
      />
    );
    bridge.emit({ type: "bridgeReady" });
    bridge.emit({
      type: "products",
      productId: APPLE_IAP_MONTHLY_PRODUCT_ID,
      displayName: "Membership",
      displayPrice: "US$4.99",
    });
    await userEvent.click(screen.getByTestId("apple-iap-subscribe"));
    await waitFor(() => {
      expect(fetchAccountToken).toHaveBeenCalledTimes(1);
    });
    expect(bridge.posted).toContainEqual({
      type: "purchase",
      appAccountToken: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(JSON.stringify(bridge.posted)).not.toContain("userId");

    bridge.emit({
      type: "signedTransaction",
      transactionId: "1001",
      jws: "aaa.bbb.ccc",
    });
    await waitFor(() => {
      expect(verifyTransaction).toHaveBeenCalledWith("aaa.bbb.ccc");
    });
    await waitFor(() => {
      expect(bridge.posted).toContainEqual({
        type: "backendVerified",
        transactionId: "1001",
      });
    });
    expect(reload).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/post-sign-in");
  });

  it("does not ack finish on retryable 500", async () => {
    const bridge = createMockBridge();
    const verifyTransaction = vi.fn(async () => ({ kind: "retryable" as const }));
    render(
      <IosAppleMembershipPanel
        bridge={bridge}
        verifyTransaction={verifyTransaction}
      />
    );
    bridge.emit({
      type: "signedTransaction",
      transactionId: "1001",
      jws: "aaa.bbb.ccc",
    });
    await waitFor(() => {
      expect(verifyTransaction).toHaveBeenCalled();
    });
    expect(bridge.posted.some((c) => c.type === "backendVerified")).toBe(
      false
    );
    expect(push).not.toHaveBeenCalled();
    expect(await screen.findByText(/couldn't complete this right now/i)).toBeTruthy();
  });

  it("shows conflict on 409 and does not finish", async () => {
    const bridge = createMockBridge();
    const verifyTransaction = vi.fn(async () => ({ kind: "conflict" as const }));
    render(
      <IosAppleMembershipPanel
        bridge={bridge}
        verifyTransaction={verifyTransaction}
      />
    );
    bridge.emit({
      type: "signedTransaction",
      transactionId: "1001",
      jws: "aaa.bbb.ccc",
    });
    expect(
      await screen.findByText(/belongs to a different Summitt Mindset account/i)
    ).toBeTruthy();
    expect(bridge.posted.some((c) => c.type === "backendVerified")).toBe(
      false
    );
  });

  it("restore posts the native restore command", async () => {
    const bridge = createMockBridge();
    render(<IosAppleMembershipPanel bridge={bridge} />);
    bridge.emit({ type: "bridgeReady" });
    bridge.emit({
      type: "products",
      productId: APPLE_IAP_MONTHLY_PRODUCT_ID,
      displayName: "Membership",
      displayPrice: "US$4.99",
    });
    await userEvent.click(screen.getByTestId("apple-iap-restore"));
    expect(bridge.posted).toContainEqual({ type: "restore" });
  });
});
