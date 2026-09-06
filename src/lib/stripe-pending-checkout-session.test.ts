import { describe, expect, it } from "vitest";
import {
  CHECKOUT_PENDING_BODY,
  CHECKOUT_PROCESSING_BODY,
  CHECKOUT_UNAVAILABLE_BODY,
  checkoutChannelFromSrc,
  checkoutCustomerIdempotencyKey,
  checkoutIdempotencyKeyV2,
  checkoutSessionIdentityDisagrees,
  clerkIdentityMatchesCheckoutSession,
  decidePendingCheckoutAction,
  hasExactExpectedMembershipPrice,
  isReusableOpenCheckoutSession,
  isStripeIdempotencyError,
  isUsableOpenCheckoutUrl,
  sessionCheckoutChannel,
} from "./stripe-pending-checkout-session";

const USER = "user_1";
const MONTHLY_PRICE = "price_monthly";
const ANNUAL_PRICE = "price_annual";
const RECOGNIZED = new Set([MONTHLY_PRICE, ANNUAL_PRICE]);

function session(partial: Record<string, unknown> = {}) {
  return {
    id: "cs_monthly",
    status: "open",
    mode: "subscription",
    url: "https://checkout.stripe.test/cs_monthly",
    client_reference_id: USER,
    metadata: { userId: USER, plan: "monthly" },
    line_items: { data: [{ price: { id: MONTHLY_PRICE } }] },
    ...partial,
  };
}

const monthlyArgs = {
  userId: USER,
  plan: "monthly" as const,
  channel: "web" as const,
  expectedPriceId: MONTHLY_PRICE,
  recognizedPriceIds: RECOGNIZED,
};

describe("pending checkout session identity and reuse", () => {
  it("matches Clerk id via client_reference_id or metadata.userId; both must agree", () => {
    expect(
      clerkIdentityMatchesCheckoutSession(
        { client_reference_id: USER, metadata: { userId: USER } },
        USER
      )
    ).toBe(true);
    expect(
      clerkIdentityMatchesCheckoutSession(
        { client_reference_id: USER, metadata: {} },
        USER
      )
    ).toBe(true);
    expect(
      clerkIdentityMatchesCheckoutSession(
        { metadata: { userId: USER } },
        USER
      )
    ).toBe(true);
    expect(
      clerkIdentityMatchesCheckoutSession(
        { client_reference_id: USER, metadata: { userId: "user_other" } },
        USER
      )
    ).toBe(false);
    expect(clerkIdentityMatchesCheckoutSession({}, USER)).toBe(false);
  });

  it("disagreeing identity fields are a conflict, not reuse or ignore", () => {
    const disagreed = session({
      client_reference_id: USER,
      metadata: { userId: "user_other", plan: "monthly" },
    });
    expect(checkoutSessionIdentityDisagrees(disagreed)).toBe(true);
    expect(
      decidePendingCheckoutAction([disagreed], monthlyArgs).kind
    ).toBe("conflict");
  });

  it("reuses only open subscription URLs with matching plan, price, and channel", () => {
    expect(
      isReusableOpenCheckoutSession(session(), {
        userId: USER,
        plan: "monthly",
        channel: "web",
        expectedPriceId: MONTHLY_PRICE,
      })
    ).toBe(true);
    expect(
      isReusableOpenCheckoutSession(session({ status: "expired" }), {
        userId: USER,
        plan: "monthly",
        channel: "web",
        expectedPriceId: MONTHLY_PRICE,
      })
    ).toBe(false);
    expect(
      isReusableOpenCheckoutSession(session({ status: "complete", url: null }), {
        userId: USER,
        plan: "monthly",
        channel: "web",
        expectedPriceId: MONTHLY_PRICE,
      })
    ).toBe(false);
    expect(isUsableOpenCheckoutUrl(session({ url: null }))).toBe(false);
  });

  it("does not treat coach metadata as a consumer session", () => {
    const coach = session({
      metadata: { userId: USER, plan: "monthly", summittAcquisition: "coach" },
    });
    expect(sessionCheckoutChannel(coach)).toBe("coach");
    expect(checkoutChannelFromSrc("coach")).toBe("coach");
    expect(checkoutChannelFromSrc(null)).toBe("web");
    expect(
      isReusableOpenCheckoutSession(coach, {
        userId: USER,
        plan: "monthly",
        channel: "web",
        expectedPriceId: MONTHLY_PRICE,
      })
    ).toBe(false);
  });

  it("annual open vs monthly request is a pending conflict, not reuse", () => {
    const annual = session({
      id: "cs_annual",
      metadata: { userId: USER, plan: "annual" },
      line_items: { data: [{ price: { id: ANNUAL_PRICE } }] },
    });
    expect(
      decidePendingCheckoutAction([annual], monthlyArgs)
    ).toEqual({ kind: "conflict" });
  });

  it("reuses a compatible monthly consumer session", () => {
    const open = session();
    expect(decidePendingCheckoutAction([open], monthlyArgs)).toEqual({
      kind: "reuse",
      session: open,
    });
  });

  it("compatible + incompatible owned sessions is conflict, not reuse", () => {
    const monthly = session({ id: "cs_monthly" });
    const annual = session({
      id: "cs_annual",
      metadata: { userId: USER, plan: "annual" },
      line_items: { data: [{ price: { id: ANNUAL_PRICE } }] },
    });
    expect(
      decidePendingCheckoutAction([monthly, annual], monthlyArgs).kind
    ).toBe("conflict");
    expect(
      decidePendingCheckoutAction([annual, monthly], monthlyArgs).kind
    ).toBe("conflict");
  });

  it("multiple line items are not reusable and conflict when owned", () => {
    const extra = session({
      line_items: {
        data: [
          { price: { id: MONTHLY_PRICE } },
          { price: { id: ANNUAL_PRICE } },
        ],
      },
    });
    expect(hasExactExpectedMembershipPrice(extra, MONTHLY_PRICE)).toBe(false);
    expect(
      decidePendingCheckoutAction([extra], monthlyArgs).kind
    ).toBe("conflict");
  });

  it("zero line items on an owned session is conflict", () => {
    const empty = session({
      line_items: { data: [] },
    });
    expect(
      decidePendingCheckoutAction([empty], monthlyArgs).kind
    ).toBe("conflict");
  });

  it("compatible open session without URL asks for retrieve, not reuse", () => {
    const noUrl = session({ url: null, id: "cs_needs_url" });
    expect(decidePendingCheckoutAction([noUrl], monthlyArgs)).toEqual({
      kind: "retrieve",
      session: noUrl,
    });
  });

  it("coach open vs consumer request is conflict; consumer open vs coach is conflict", () => {
    const coach = session({
      metadata: { userId: USER, plan: "monthly", summittAcquisition: "coach" },
    });
    const consumer = session();
    expect(
      decidePendingCheckoutAction([coach], monthlyArgs).kind
    ).toBe("conflict");
    expect(
      decidePendingCheckoutAction([consumer], {
        ...monthlyArgs,
        channel: "coach",
      }).kind
    ).toBe("conflict");
  });

  it("builds a stable v2 idempotency key without successor suffix", () => {
    expect(
      checkoutIdempotencyKeyV2({
        userId: USER,
        plan: "monthly",
        channel: "web",
      })
    ).toBe("checkout-subscription-v2:user_1:monthly:web");
    expect(checkoutCustomerIdempotencyKey(USER)).toBe(
      "checkout-customer-v1:user_1"
    );
    expect(CHECKOUT_PENDING_BODY.error).toBe("checkout_pending");
    expect(CHECKOUT_PROCESSING_BODY.error).toBe("checkout_processing");
    expect(CHECKOUT_UNAVAILABLE_BODY.error).toBe("checkout_unavailable");
    expect(
      isStripeIdempotencyError({
        type: "StripeIdempotencyError",
        rawType: "idempotency_error",
      })
    ).toBe(true);
    expect(isStripeIdempotencyError(new Error("nope"))).toBe(false);
  });
});
