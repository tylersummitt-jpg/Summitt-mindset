"use client";

import { useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  CHECKOUT_ACTIVATE_TRACE_HEADER,
  ONBOARDING_IDENTITY_PATH,
} from "@/lib/stripe-first-checkout/constants";

type ActivateBody = {
  status?: string;
  error?: string;
  signedIn?: boolean;
  ticket?: string;
  signInUrl?: string;
  next?: string;
};

const RETRY_COPY =
  "We're still confirming your membership. Please try again here. You don't need to enter your payment information again.";
const SAFE_CATEGORY_RE = /^[a-z_]{1,40}$/;
const TRACE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function noteUnclassifiedActivate(response: Response, body: ActivateBody | null) {
  try {
    const trace = response.headers?.get(CHECKOUT_ACTIVATE_TRACE_HEADER) ?? null;
    const status = body?.status;
    const error = body?.error;
    console.info("[checkout-activate]", {
      trace: typeof trace === "string" && TRACE_ID_RE.test(trace) ? trace : null,
      http: response.status,
      status: typeof status === "string" && SAFE_CATEGORY_RE.test(status) ? status : null,
      error: typeof error === "string" && SAFE_CATEGORY_RE.test(error) ? error : null,
    });
  } catch {
    // The confirmation screen must not depend on this diagnostic.
  }
}

export function HostedTestReturnClient({
  activatePath = "/api/checkout/hosted-test/activate",
  confirmPath = "/api/checkout/hosted-test/confirm-session",
}: {
  activatePath?: string;
  confirmPath?: string;
} = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [message, setMessage] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<"retry" | "unsigned" | "mismatch" | null>(null);
  const [pending, setPending] = useState(true);
  const sessionId = searchParams.get("session_id") ?? "";

  useEffect(() => {
    if (!sessionId || !isLoaded || !signIn || !setActive) return;
    let cancelled = false;

    void (async () => {
      const response = await fetch(activatePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (cancelled) return;
      const body = (await response.json().catch(() => null)) as ActivateBody | null;

      if (body?.status === "sign_in_required" && body.signInUrl) {
        window.location.assign(body.signInUrl);
        return;
      }
      if (body?.status === "preserved") {
        router.push(body.next || "/post-sign-in");
        return;
      }
      if (body?.status === "continue") {
        router.push(ONBOARDING_IDENTITY_PATH);
        return;
      }
      if (response.status === 503 && body?.error === "retry") {
        setRecovery("retry");
        setPending(false);
        return;
      }
      if (body?.status === "account_mismatch") {
        setRecovery(body.signedIn === true ? "mismatch" : "unsigned");
        setPending(false);
        return;
      }
      if (body?.status === "incomplete") {
        setMessage("Checkout is not finished. You can return and try again.");
        setPending(false);
        return;
      }
      if (body?.status === "unprotected") {
        setMessage("This trial is not protected yet, so the account was not created.");
        setPending(false);
        return;
      }
      if (body?.status === "ticket" && body.ticket && signIn && setActive) {
        try {
          const attempt = await signIn.create({
            strategy: "ticket",
            ticket: body.ticket,
          });
          if (cancelled) return;
          if (attempt.status !== "complete" || !attempt.createdSessionId) {
            throw new Error("ticket_incomplete");
          }
          await setActive({ session: attempt.createdSessionId });
          let confirmed = await fetch(confirmPath, {
            method: "POST",
          });
          if (confirmed.status === 401) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            confirmed = await fetch(confirmPath, {
              method: "POST",
            });
          }
          if (cancelled) return;
          const confirmedBody = (await confirmed.json().catch(() => null)) as {
            next?: string;
          } | null;
          if (!confirmed.ok || !confirmedBody?.next) {
            setMessage("Your session did not finish. Try again.");
            setPending(false);
            return;
          }
          router.push(confirmedBody.next);
          return;
        } catch {
          if (cancelled) return;
          setMessage("Sign-in did not finish. Try again.");
          setPending(false);
          return;
        }
      }

      noteUnclassifiedActivate(response, body);
      setMessage(
        response.status === 403
          ? "This checkout link cannot be confirmed in this browser."
          : "Checkout could not be confirmed. Try again."
      );
      setPending(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [activatePath, confirmPath, isLoaded, router, sessionId, setActive, signIn]);

  const title =
    recovery === "retry"
      ? "Finishing your free trial"
      : recovery === "mismatch" || recovery === "unsigned"
        ? "Sign in to finish"
        : "Finishing checkout";
  const recoveryCopy =
    recovery === "retry"
      ? RETRY_COPY
      : recovery === "mismatch"
        ? "This browser is signed in to a different Summitt Mindset account. Sign in with the email you used at checkout, then try again here. You don't need to enter payment information again."
        : recovery === "unsigned"
          ? "Sign in with the email you used at checkout, then try again here. You don't need to enter payment information again."
          : null;

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      {recoveryCopy ? (
        <p className="mt-3 text-sm leading-relaxed text-gray-700">{recoveryCopy}</p>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          {!sessionId
            ? "This checkout link is incomplete."
            : pending && !message
              ? "Confirming your checkout…"
              : "Checkout confirmation runs in this browser."}
        </p>
      )}
      {message ? <p className="mt-3 text-sm text-gray-800">{message}</p> : null}
      {recovery || message ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white"
        >
          {recovery ? "Try Again" : "Try again"}
        </button>
      ) : null}
    </div>
  );
}
