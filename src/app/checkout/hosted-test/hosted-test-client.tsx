"use client";

import { useState } from "react";

export function HostedTestEnable({ canary = false }: { canary?: boolean }) {
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
        {canary
          ? "Enable this browser for 30 minutes, sign out, then start the one live monthly checkout with a new email you control. The public trial buttons are unchanged."
          : "Enable this browser, sign out, then start a test checkout. The public trial buttons are unchanged."}
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
  canary = false,
}: {
  canceled: boolean;
  signedIn: boolean;
  canary?: boolean;
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
    const body = (await response.json().catch(() => null)) as {
      url?: unknown;
      error?: unknown;
    } | null;
    if (body?.error === "canary_used") {
      setError("This canary already started its one checkout. Nothing else was started.");
      setPending(null);
      return;
    }
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
        {canary
          ? "One live monthly checkout. $0 today, then the live monthly price after 7 days. Use a new email that is not already a Summitt account. This page is not linked from the public site."
          : "Stripe test mode only. This page is not linked from the public site."}
      </p>
      {signedIn ? (
        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          Sign out before you pay so the new customer session is the one that
          continues into Coach Pat.
        </p>
      ) : null}
      {canceled ? (
        <p className="mt-3 text-sm text-gray-700">
          {canary
            ? "Checkout was canceled. This canary will not start a second checkout."
            : "Checkout was canceled. You can try again."}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={() => start("monthly")}
          disabled={pending != null}
          className="rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending === "monthly"
            ? "Starting…"
            : canary
              ? "Start the one live monthly checkout"
              : "Monthly test checkout"}
        </button>
        {canary ? null : (
          <button
            type="button"
            onClick={() => start("annual")}
            disabled={pending != null}
            className="rounded-lg border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-900 disabled:opacity-60"
          >
            {pending === "annual" ? "Starting…" : "Annual test checkout"}
          </button>
        )}
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
