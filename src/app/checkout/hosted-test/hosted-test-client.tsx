"use client";

import { useState } from "react";

export function HostedTestEnable() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function enable() {
    setPending(true);
    setError(null);
    const response = await fetch("/api/checkout/hosted-test/access", { method: "POST" });
    if (!response.ok) {
      setError("This browser could not be enabled.");
      setPending(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Hosted checkout test</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-700">
        Enable this browser, sign out, then start a test checkout. The public
        trial buttons are unchanged.
      </p>
      <button
        type="button"
        onClick={enable}
        disabled={pending}
        className="mt-6 rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Enabling…" : "Enable hosted test"}
      </button>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export function HostedTestStart({
  canceled,
  signedIn,
}: {
  canceled: boolean;
  signedIn: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"monthly" | "annual" | null>(null);

  async function start(plan: "monthly" | "annual") {
    setPending(plan);
    setError(null);
    const response = await fetch("/api/checkout/hosted-test/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    const body = (await response.json().catch(() => null)) as { url?: unknown } | null;
    if (!response.ok || typeof body?.url !== "string") {
      setError("Checkout could not start. Nothing was charged.");
      setPending(null);
      return;
    }
    window.location.assign(body.url);
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-2xl font-bold text-gray-900">Hosted checkout test</h1>
      <p className="mt-3 text-sm leading-relaxed text-gray-700">
        Stripe test mode only. This page is not linked from the public site.
      </p>
      {signedIn ? (
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          Sign out before you pay so the new customer session is the one that
          continues into Coach Pat.
        </p>
      ) : null}
      {canceled ? (
        <p className="mt-3 text-sm text-gray-700">
          Checkout was canceled. You can try again.
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => start("monthly")}
          disabled={pending != null}
          className="rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending === "monthly" ? "Starting…" : "Monthly test checkout"}
        </button>
        <button
          type="button"
          onClick={() => start("annual")}
          disabled={pending != null}
          className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-900 disabled:opacity-60"
        >
          {pending === "annual" ? "Starting…" : "Annual test checkout"}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
