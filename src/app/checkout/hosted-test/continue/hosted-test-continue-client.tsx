"use client";

import { useEffect, useState } from "react";

export function HostedTestContinueClient() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/checkout/hosted-test/link", { method: "POST" });
      if (cancelled) return;
      const body = (await response.json().catch(() => null)) as {
        next?: string;
      } | null;
      if (response.ok && body?.next) {
        window.location.assign(body.next);
        return;
      }
      setMessage(
        response.status === 403
          ? "Sign in with the email from checkout to finish."
          : "Membership could not be linked yet. Try again."
      );
      setPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Finish your membership</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-700">
        {pending ? "Linking this checkout to your account…" : "Signed in."}
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
