/**
 * Exact-Clerk ownership and reuse rules for OPEN Stripe Checkout Sessions.
 * No email. No expire. No Search. Pure helpers for create-checkout-session.
 */

export type CheckoutChannel = "web" | "coach";
export type CheckoutPlan = "monthly" | "annual";

export type PendingCheckoutSessionLike = {
  id?: string | null;
  status?: string | null;
  mode?: string | null;
  url?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  line_items?: {
    data?: Array<{
      price?: { id?: string | null } | string | null;
    }>;
  } | null;
};

export const CHECKOUT_PENDING_BODY = {
  error: "checkout_pending" as const,
  message:
    "You already have a checkout in progress. Continue from Subscribe to finish it.",
};

export const CHECKOUT_PROCESSING_BODY = {
  error: "checkout_processing" as const,
  message:
    "Your checkout is still finishing. Please wait a moment and try again.",
};

export const CHECKOUT_UNAVAILABLE_BODY = {
  error: "checkout_unavailable" as const,
  message:
    "Checkout could not be restarted. Please try again in a little while.",
};

export function checkoutCustomerIdempotencyKey(userId: string): string {
  return `checkout-customer-v1:${userId}`;
}

export function isStripeIdempotencyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { type?: unknown; rawType?: unknown; code?: unknown };
  return (
    e.type === "StripeIdempotencyError" ||
    e.type === "idempotency_error" ||
    e.rawType === "idempotency_error" ||
    e.code === "idempotency_error"
  );
}

export function checkoutChannelFromSrc(src: string | null): CheckoutChannel {
  return src === "coach" ? "coach" : "web";
}

export function checkoutIdempotencyKeyV2(args: {
  userId: string;
  plan: CheckoutPlan;
  channel: CheckoutChannel;
}): string {
  return `checkout-subscription-v2:${args.userId}:${args.plan}:${args.channel}`;
}

export function sessionCheckoutChannel(
  session: PendingCheckoutSessionLike
): CheckoutChannel {
  return session.metadata?.summittAcquisition === "coach" ? "coach" : "web";
}

function trimmedIdentity(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

export function checkoutSessionIdentityDisagrees(
  session: PendingCheckoutSessionLike
): boolean {
  const ref = trimmedIdentity(session.client_reference_id);
  const meta = trimmedIdentity(session.metadata?.userId);
  return Boolean(ref && meta && ref !== meta);
}

export function clerkIdentityMatchesCheckoutSession(
  session: PendingCheckoutSessionLike,
  userId: string
): boolean {
  if (checkoutSessionIdentityDisagrees(session)) return false;
  const ref = trimmedIdentity(session.client_reference_id);
  const meta = trimmedIdentity(session.metadata?.userId);
  if (ref && meta) return ref === userId && meta === userId;
  if (ref) return ref === userId;
  if (meta) return meta === userId;
  return false;
}

export function isUsableOpenCheckoutUrl(
  session: PendingCheckoutSessionLike
): boolean {
  return (
    session.status === "open" &&
    typeof session.url === "string" &&
    session.url.trim().length > 0
  );
}

function metadataPlan(
  session: PendingCheckoutSessionLike
): CheckoutPlan | null {
  const plan = session.metadata?.plan;
  if (plan === "monthly" || plan === "annual") return plan;
  return null;
}

function lineItemPriceIds(session: PendingCheckoutSessionLike): string[] {
  const items = session.line_items?.data;
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const raw = item?.price;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (raw && typeof raw === "object" && typeof raw.id === "string") {
      return raw.id.trim();
    }
    return "";
  });
}

export function hasExactExpectedMembershipPrice(
  session: PendingCheckoutSessionLike,
  expectedPriceId: string
): boolean {
  const ids = lineItemPriceIds(session);
  return ids.length === 1 && ids[0] === expectedPriceId;
}

export function isOwnedOpenSummittCheckoutSession(
  session: PendingCheckoutSessionLike,
  args: {
    userId: string;
    recognizedPriceIds: Set<string>;
  }
): boolean {
  if (session.status !== "open") return false;
  if (session.mode !== "subscription") return false;
  if (!clerkIdentityMatchesCheckoutSession(session, args.userId)) return false;

  const plan = metadataPlan(session);
  const ids = lineItemPriceIds(session);
  const recognizedPrice = ids.some((id) => args.recognizedPriceIds.has(id));
  const coach = session.metadata?.summittAcquisition === "coach";

  return plan != null || recognizedPrice || coach;
}

function isCompatibleOpenCheckoutShape(
  session: PendingCheckoutSessionLike,
  args: {
    userId: string;
    plan: CheckoutPlan;
    channel: CheckoutChannel;
    expectedPriceId: string;
  }
): boolean {
  if (session.status !== "open") return false;
  if (session.mode !== "subscription") return false;
  if (!clerkIdentityMatchesCheckoutSession(session, args.userId)) return false;
  if (metadataPlan(session) !== args.plan) return false;
  if (sessionCheckoutChannel(session) !== args.channel) return false;
  return hasExactExpectedMembershipPrice(session, args.expectedPriceId);
}

export function isReusableOpenCheckoutSession(
  session: PendingCheckoutSessionLike,
  args: {
    userId: string;
    plan: CheckoutPlan;
    channel: CheckoutChannel;
    expectedPriceId: string;
  }
): boolean {
  if (!isUsableOpenCheckoutUrl(session)) return false;
  return isCompatibleOpenCheckoutShape(session, args);
}

export type PendingCheckoutDecision =
  | { kind: "reuse"; session: PendingCheckoutSessionLike }
  | { kind: "retrieve"; session: PendingCheckoutSessionLike }
  | { kind: "conflict" }
  | { kind: "none" };

export function decidePendingCheckoutAction(
  sessions: PendingCheckoutSessionLike[],
  args: {
    userId: string;
    plan: CheckoutPlan;
    channel: CheckoutChannel;
    expectedPriceId: string;
    recognizedPriceIds: Set<string>;
  }
): PendingCheckoutDecision {
  if (sessions.some(checkoutSessionIdentityDisagrees)) {
    return { kind: "conflict" };
  }

  const owned = sessions.filter((session) =>
    isOwnedOpenSummittCheckoutSession(session, {
      userId: args.userId,
      recognizedPriceIds: args.recognizedPriceIds,
    })
  );

  const compatible = owned.filter((session) =>
    isCompatibleOpenCheckoutShape(session, {
      userId: args.userId,
      plan: args.plan,
      channel: args.channel,
      expectedPriceId: args.expectedPriceId,
    })
  );
  const incompatible = owned.filter(
    (session) =>
      !isCompatibleOpenCheckoutShape(session, {
        userId: args.userId,
        plan: args.plan,
        channel: args.channel,
        expectedPriceId: args.expectedPriceId,
      })
  );

  if (incompatible.length > 0) return { kind: "conflict" };
  if (compatible.length === 0) return { kind: "none" };

  const chosen = [...compatible].sort((a, b) => {
    const idA = typeof a.id === "string" ? a.id : "";
    const idB = typeof b.id === "string" ? b.id : "";
    return idB.localeCompare(idA);
  })[0];
  if (!chosen) return { kind: "none" };
  if (isUsableOpenCheckoutUrl(chosen)) {
    return { kind: "reuse", session: chosen };
  }
  if (typeof chosen.id === "string" && chosen.id.trim()) {
    return { kind: "retrieve", session: chosen };
  }
  return { kind: "conflict" };
}
