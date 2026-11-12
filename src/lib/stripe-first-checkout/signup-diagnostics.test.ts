import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashCheckoutBinding } from "@/lib/stripe-first-checkout/binding";

type StoredIntent = Record<string, string | null>;

let table: StoredIntent[] = [];
let failWrites = false;
let tail = Promise.resolve();

function enqueue<T>(work: () => T): Promise<T> {
  const run = tail.then(work, work);
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function query(rows: StoredIntent[]) {
  let current = rows;
  let patch: StoredIntent | null = null;
  const api = {
    select() {
      return api;
    },
    update(value: StoredIntent) {
      patch = value;
      return api;
    },
    eq(column: string, value: string) {
      current = current.filter((row) => row[column] === value);
      return api;
    },
    is(column: string, value: null) {
      current = current.filter((row) => row[column] == value);
      return api;
    },
    order() {
      return api;
    },
    limit(count: number) {
      current = current.slice(0, count);
      return api;
    },
    maybeSingle() {
      return Promise.resolve({ data: current[0] ?? null, error: null });
    },
    then(
      resolve: (value: { data: null; error: { code: string } | null }) => void,
      reject: (reason: unknown) => void
    ) {
      return enqueue(() => {
        if (failWrites) {
          resolve({ data: null, error: { code: "42703" } });
          return;
        }
        if (patch) {
          for (const row of current) {
            const column = Object.keys(patch).find((key) => key !== "updated_at");
            if (!column || row[column] != null) continue;
            Object.assign(row, patch);
          }
          resolve({ data: null, error: null });
          return;
        }
        resolve({ data: current, error: null });
      }).then(undefined, reject);
    },
  };
  return api;
}

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: () => query(table),
  },
}));

import {
  noteActivateRetry,
  noteAuthObserved,
  noteBoundCheckoutReturn,
  noteHoldReleaseRetry,
  noteLinkRetry,
  noteOnboardingReached,
  noteSignInClientReached,
  noteSignInRedirectIssued,
  noteUnboundCheckoutReturn,
  recordCheckoutReturn,
} from "@/lib/stripe-first-checkout/signup-diagnostics";

const SECRET = "browser-binding-secret";
const SESSION = "cs_test_return_session";

function intent(overrides: StoredIntent = {}): StoredIntent {
  return {
    id: "intent_1",
    binding_hash: hashCheckoutBinding(SECRET),
    stripe_checkout_session_id: SESSION,
    return_seen_at: null,
    return_unbound_at: null,
    activate_retry_at: null,
    sign_in_redirected_at: null,
    link_retry_at: null,
    hold_release_retry_at: null,
    sign_in_client_reached_at: null,
    auth_observed_at: null,
    onboarding_reached_at: null,
    clerk_user_id: null,
    email: null,
    ...overrides,
  };
}

beforeEach(() => {
  table = [intent()];
  failWrites = false;
  tail = Promise.resolve();
});

describe("signup diagnostics", () => {
  it("records the first bound return and keeps that timestamp", async () => {
    await noteBoundCheckoutReturn(SECRET);
    const first = table[0]?.return_seen_at;
    expect(first).toBeTruthy();
    await noteBoundCheckoutReturn(SECRET);
    expect(table[0]?.return_seen_at).toBe(first);
  });

  it("records an unbound return without reading customer fields back", async () => {
    await noteUnboundCheckoutReturn(SESSION);
    expect(table[0]?.return_unbound_at).toBeTruthy();
    expect(table[0]?.email).toBeNull();
    expect(table[0]?.clerk_user_id).toBeNull();
    await noteUnboundCheckoutReturn("not a session");
    await noteUnboundCheckoutReturn(undefined);
    expect(table[0]?.return_seen_at).toBeNull();
  });

  it("keeps a missing cookie on the unbound path and a present cookie on the bound path", async () => {
    await recordCheckoutReturn({ bindingCookie: undefined, sessionId: SESSION });
    expect(table[0]?.return_unbound_at).toBeTruthy();
    expect(table[0]?.return_seen_at).toBeNull();
    await recordCheckoutReturn({ bindingCookie: SECRET, sessionId: SESSION });
    expect(table[0]?.return_seen_at).toBeTruthy();
  });

  it("contains a diagnostic write failure", async () => {
    failWrites = true;
    await expect(recordCheckoutReturn({ bindingCookie: SECRET, sessionId: SESSION })).resolves.toBeUndefined();
    await expect(noteActivateRetry(SECRET)).resolves.toBeUndefined();
    await expect(noteLinkRetry(SECRET)).resolves.toBeUndefined();
    await expect(noteHoldReleaseRetry("intent_1")).resolves.toBeUndefined();
    expect(table[0]?.return_seen_at).toBeNull();
    expect(table[0]?.activate_retry_at).toBeNull();
  });

  it("records activate, redirect, link, and hold-release retries once", async () => {
    await noteActivateRetry(SECRET);
    await noteSignInRedirectIssued(SECRET);
    await noteLinkRetry(SECRET);
    await noteHoldReleaseRetry("intent_1");
    const stamp = {
      activate: table[0]?.activate_retry_at,
      redirect: table[0]?.sign_in_redirected_at,
      link: table[0]?.link_retry_at,
      hold: table[0]?.hold_release_retry_at,
    };
    await noteActivateRetry(SECRET);
    await noteSignInRedirectIssued(SECRET);
    await noteLinkRetry(SECRET);
    await noteHoldReleaseRetry("intent_1");
    expect(table[0]?.activate_retry_at).toBe(stamp.activate);
    expect(table[0]?.sign_in_redirected_at).toBe(stamp.redirect);
    expect(table[0]?.link_retry_at).toBe(stamp.link);
    expect(table[0]?.hold_release_retry_at).toBe(stamp.hold);
    expect(table[0]?.clerk_user_id).toBeNull();
  });

  it("records the sign-in call, observed authentication, and onboarding entry once", async () => {
    table[0].clerk_user_id = "user_1";
    await noteSignInClientReached(SECRET);
    await noteAuthObserved(SECRET);
    await noteOnboardingReached("user_1");
    const first = {
      signIn: table[0]?.sign_in_client_reached_at,
      auth: table[0]?.auth_observed_at,
      onboarding: table[0]?.onboarding_reached_at,
    };
    expect(first.signIn).toBeTruthy();
    expect(first.auth).toBeTruthy();
    expect(first.onboarding).toBeTruthy();
    await noteSignInClientReached(SECRET);
    await noteAuthObserved(SECRET);
    await noteOnboardingReached("user_1");
    expect(table[0]?.sign_in_client_reached_at).toBe(first.signIn);
    expect(table[0]?.auth_observed_at).toBe(first.auth);
    expect(table[0]?.onboarding_reached_at).toBe(first.onboarding);
    expect(table[0]?.email).toBeNull();
  });

  it("does not record onboarding for a different Clerk user", async () => {
    table[0].clerk_user_id = "user_1";
    await noteOnboardingReached("user_2");
    await noteOnboardingReached("");
    expect(table[0]?.onboarding_reached_at).toBeNull();
  });

  it("lets one of two overlapping writes keep the original timestamp", async () => {
    await Promise.all([noteBoundCheckoutReturn(SECRET), noteBoundCheckoutReturn(SECRET)]);
    expect(table[0]?.return_seen_at).toBeTruthy();
    const updates = table.filter((row) => row.return_seen_at === table[0]?.return_seen_at);
    expect(updates).toHaveLength(1);
  });

  it("does not persist the binding secret or treat a redirect as page arrival", () => {
    const diagnostics = readFileSync(
      "src/lib/stripe-first-checkout/signup-diagnostics.ts",
      "utf8"
    );
    const migration = readFileSync(
      "supabase/migrations/20261112160000_checkout_intent_signup_diagnostics.sql",
      "utf8"
    );
    const activate = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const hold = activate.slice(
      activate.indexOf("async function finishActivationHold"),
      activate.indexOf("async function requireBoundIntent")
    );
    const returnPage = readFileSync("src/app/checkout/return/page.tsx", "utf8");
    const continuePage = readFileSync("src/app/checkout/continue/page.tsx", "utf8");
    const signInPage = readFileSync("src/app/sign-in/[[...sign-in]]/page.tsx", "utf8");
    const beacon = readFileSync("src/app/checkout/sign-in-reached-beacon.tsx", "utf8");
    const signInReached = readFileSync(
      "src/app/api/checkout/stripe-first/sign-in-reached/route.ts",
      "utf8"
    );
    const milestones = readFileSync(
      "supabase/migrations/20261112170000_checkout_intent_signup_milestones.sql",
      "utf8"
    );
    const postSignIn = readFileSync("src/app/post-sign-in/page.tsx", "utf8");
    const identity = readFileSync("src/app/onboarding/identity/page.tsx", "utf8");
    const confirmRoute = readFileSync(
      "src/app/api/checkout/stripe-first/confirm-session/route.ts",
      "utf8"
    );
    const linkRoute = readFileSync("src/app/api/checkout/stripe-first/link/route.ts", "utf8");
    const activateRoute = readFileSync(
      "src/app/api/checkout/stripe-first/activate/route.ts",
      "utf8"
    );
    const store = readFileSync("src/lib/stripe-first-checkout/intent-store.ts", "utf8");
    const unbound = store.slice(
      store.indexOf("export async function markUnboundCheckoutReturn"),
      store.indexOf("export async function markOnboardingReachedForClerkUser")
    );
    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    const pass = readFileSync(
      "src/lib/stripe-first-checkout/prepare-confirmed-pass.ts",
      "utf8"
    );
    const recovery = readFileSync("src/lib/stripe-first-checkout/activate.ts", "utf8");
    const resumeStart = recovery.indexOf("export async function resumeExistingAccountActivation");

    expect(diagnostics).not.toContain("sm_checkout_bind");
    expect(unbound).toContain("return_unbound_at: timestamp");
    expect(unbound).not.toContain(".select(");
    expect(unbound).not.toContain("email");
    expect(migration).toContain("does not prove the browser received or displayed the page");
    expect(migration).toContain("does not mean the sign-in page loaded");
    expect(signInPage).not.toContain("sign_in_redirected_at");
    expect(signInPage).toContain("CheckoutSignInReachedBeacon");
    expect(beacon).not.toContain("session_id");
    expect(beacon).not.toContain("intentId");
    expect(signInReached).not.toContain("req.json");
    expect(signInReached).toContain("status: 204");
    expect(milestones).toContain("does not prove the screen was displayed");
    expect(milestones).toContain("does not link the user or the subscription");
    expect(postSignIn.indexOf("await noteAuthObserved")).toBeLessThan(
      postSignIn.indexOf("await resumeExistingAccountActivation")
    );
    expect(identity).toContain("noteOnboardingReached(user.id)");
    expect(identity).not.toContain("searchParams");
    expect(confirmRoute).toContain("noteAuthObserved");
    expect(continuePage).toContain("noteSignInRedirectIssued");
    expect(continuePage).toContain("redirect(signInUrlPreservingInternalRedirect");
    expect(returnPage).toContain("notFound()");
    expect(returnPage).toContain("recordCheckoutReturn");
    expect(linkRoute).toContain('status: 503');
    expect(activateRoute).toContain("noteActivateRetry");
    expect(hold).toContain('if (hold === "retry")');
    expect(hold).toContain("noteHoldReleaseRetry");
    expect(hold).not.toContain("markHoldReleased");
    expect(webhook).not.toContain("signup-diagnostics");
    expect(pass).not.toContain("signup-diagnostics");
    expect(recovery.slice(resumeStart)).not.toContain("noteHoldReleaseRetry");
    expect(diagnostics).toContain("A missing timestamp is an unrecorded event");
  });
});
