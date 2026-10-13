"use client";

import { useSignIn } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ONBOARDING_IDENTITY_PATH } from "@/lib/stripe-first-checkout/constants";

type ActivateBody = {
  status?: string;
  ticket?: string;
  signInUrl?: string;
};

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
      if (body?.status === "continue") {
        router.push(ONBOARDING_IDENTITY_PATH);
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

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Finishing checkout</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-700">
        {!sessionId
          ? "This checkout link is incomplete."
          : pending && !message
            ? "Confirming your checkout…"
            : "Checkout confirmation runs in this browser."}
      </p>
      {message ? <p className="mt-3 text-sm text-gray-800">{message}</p> : null}
      {message ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
