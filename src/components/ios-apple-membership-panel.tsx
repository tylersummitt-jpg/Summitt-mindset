"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  createWebkitAppleIapBridge,
  isAppleAppAccountTokenUuid,
  type AppleIapBridgePort,
  type NativeToWebAppleIapEvent,
} from "@/lib/native-apple-iap/bridge";
import { APPLE_IAP_MONTHLY_PRODUCT_ID } from "@/lib/native-apple-iap/constants";
import {
  fetchAppleAccountToken,
  postAppleSignedTransaction,
  shouldAckNativeTransactionFinish,
  type AppleVerifyResult,
} from "@/lib/native-apple-iap/verify-client";

export type IosAppleMembershipUiState =
  | "waiting_bridge"
  | "loading_product"
  | "ready"
  | "purchasing"
  | "pending"
  | "verifying"
  | "restoring"
  | "success"
  | "unavailable"
  | "conflict"
  | "error";

const USER_MESSAGES: Record<IosAppleMembershipUiState, string> = {
  waiting_bridge: "Connecting to App Store…",
  loading_product: "Loading membership…",
  ready: "",
  purchasing: "Confirming with Apple…",
  pending: "This purchase is pending approval. You can return here once it is approved.",
  verifying: "Confirming your membership…",
  restoring: "Restoring purchases…",
  success: "Membership confirmed. Continuing…",
  unavailable:
    "The App Store membership is unavailable right now. Try again, or email Support@SummittMindset.com.",
  conflict:
    "This Apple subscription belongs to a different Summitt Mindset account. Sign in with the account that purchased it, or email Support@SummittMindset.com.",
  error:
    "We couldn't complete this right now. Try again, or email Support@SummittMindset.com.",
};

type VerifyFn = (jws: string) => Promise<AppleVerifyResult>;
type TokenFn = () => Promise<
  Awaited<ReturnType<typeof fetchAppleAccountToken>>
>;

export type IosAppleMembershipPanelProps = {
  bridge?: AppleIapBridgePort;
  fetchAccountToken?: TokenFn;
  verifyTransaction?: VerifyFn;
};

export default function IosAppleMembershipPanel({
  bridge,
  fetchAccountToken = fetchAppleAccountToken,
  verifyTransaction = postAppleSignedTransaction,
}: IosAppleMembershipPanelProps) {
  const router = useRouter();
  const { user } = useUser();
  const bridgeRef = useRef<AppleIapBridgePort>(
    bridge ?? createWebkitAppleIapBridge()
  );
  const [state, setState] = useState<IosAppleMembershipUiState>("waiting_bridge");
  const [displayPrice, setDisplayPrice] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Summitt Mindset membership");
  const inFlightRef = useRef(false);
  const verifyingIdRef = useRef<string | null>(null);

  const busy =
    state === "purchasing" ||
    state === "verifying" ||
    state === "restoring" ||
    state === "success";

  const completeMembership = useCallback(async () => {
    setState("success");
    try {
      await user?.reload();
    } catch {
      // Router refresh still re-reads server Clerk metadata.
    }
    router.refresh();
    router.push("/post-sign-in");
  }, [router, user]);

  const verifyJws = useCallback(
    async (transactionId: string, jws: string) => {
      if (verifyingIdRef.current === transactionId) return;
      verifyingIdRef.current = transactionId;
      setState("verifying");
      const result = await verifyTransaction(jws);
      if (shouldAckNativeTransactionFinish(result)) {
        bridgeRef.current.post({
          type: "backendVerified",
          transactionId,
        });
        await completeMembership();
        return;
      }
      verifyingIdRef.current = null;
      inFlightRef.current = false;
      if (result.kind === "conflict") {
        setState("conflict");
        return;
      }
      if (result.kind === "retryable") {
        setState("error");
        return;
      }
      setState("error");
    },
    [completeMembership, verifyTransaction]
  );

  useEffect(() => {
    const port = bridgeRef.current;
    const unsubscribe = port.subscribe((event: NativeToWebAppleIapEvent) => {
      switch (event.type) {
        case "bridgeReady":
          setState((current) =>
            current === "waiting_bridge" ? "loading_product" : current
          );
          port.post({ type: "requestProducts" });
          break;
        case "products":
          setDisplayPrice(event.displayPrice);
          if (event.displayName.trim()) setDisplayName(event.displayName);
          setState((current) =>
            current === "verifying" ||
            current === "purchasing" ||
            current === "restoring" ||
            current === "pending" ||
            current === "success" ||
            current === "conflict"
              ? current
              : "ready"
          );
          break;
        case "productsUnavailable":
          setState((current) =>
            current === "verifying" || current === "success"
              ? current
              : "unavailable"
          );
          break;
        case "signedTransaction":
          void verifyJws(event.transactionId, event.jws);
          break;
        case "purchaseCancelled":
          inFlightRef.current = false;
          setState(displayPrice ? "ready" : "loading_product");
          break;
        case "purchasePending":
          inFlightRef.current = false;
          setState("pending");
          break;
        case "purchaseFailed":
          inFlightRef.current = false;
          setState(
            event.code === "unavailable" ? "unavailable" : "error"
          );
          break;
        case "restoreEmpty":
          inFlightRef.current = false;
          setState(displayPrice ? "ready" : "unavailable");
          break;
      }
    });
    port.post({ type: "ready" });
    return unsubscribe;
  }, [displayPrice, verifyJws]);

  async function onPurchase() {
    if (busy || inFlightRef.current || state !== "ready") return;
    inFlightRef.current = true;
    setState("purchasing");
    const token = await fetchAccountToken();
    if (!token.ok || !isAppleAppAccountTokenUuid(token.appAccountToken)) {
      inFlightRef.current = false;
      setState("error");
      return;
    }
    const posted = bridgeRef.current.post({
      type: "purchase",
      appAccountToken: token.appAccountToken,
    });
    if (!posted) {
      inFlightRef.current = false;
      setState("error");
    }
  }

  async function onRestore() {
    if (busy || inFlightRef.current) return;
    inFlightRef.current = true;
    setState("restoring");
    const posted = bridgeRef.current.post({ type: "restore" });
    if (!posted) {
      inFlightRef.current = false;
      setState("error");
    }
  }

  const statusMessage = USER_MESSAGES[state];

  return (
    <section
      className="space-y-6"
      data-app-membership="apple-iap"
      data-apple-iap-state={state}
    >
      <p className="text-base leading-7 text-[var(--muted)]">
        Your account does not currently have an active Summitt Mindset
        membership.
      </p>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-5 space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text)]">
          {displayName}
        </h2>
        <p className="text-sm text-[var(--muted)]">Monthly membership</p>
        <p
          className="text-2xl font-semibold tracking-tight text-[var(--text)]"
          data-testid="apple-iap-display-price"
        >
          {displayPrice ?? "—"}
        </p>
        {statusMessage ? (
          <p className="text-sm leading-6 text-[var(--muted)]" role="status">
            {statusMessage}
          </p>
        ) : (
          <p className="text-sm leading-6 text-[var(--muted)]">
            Auto-renewing. Charged to your Apple ID. Cancel anytime in your
            Apple subscription settings.
          </p>
        )}
        <button
          type="button"
          onClick={() => void onPurchase()}
          disabled={state !== "ready" || !displayPrice || busy}
          className="w-full rounded-md bg-[var(--text)] px-4 py-3 font-semibold text-[var(--bg)] disabled:opacity-50"
          data-testid="apple-iap-subscribe"
        >
          Subscribe with Apple
        </button>
        <button
          type="button"
          onClick={() => void onRestore()}
          disabled={busy || state === "waiting_bridge"}
          className="w-full rounded-md border border-[var(--border)] px-4 py-3 font-medium text-[var(--text)] disabled:opacity-50"
          data-testid="apple-iap-restore"
        >
          Restore Purchases
        </button>
        <div className="flex justify-center gap-4 text-sm underline">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Use</Link>
        </div>
        <p className="sr-only">{APPLE_IAP_MONTHLY_PRODUCT_ID}</p>
      </div>
    </section>
  );
}
