"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { suggestEmailDomain } from "@/lib/stripe-first-checkout/email-typo";

export function OnboardingEmailBanner({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextEmail, setNextEmail] = useState(email);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const suggestion = suggestEmailDomain(nextEmail);

  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const response = await fetch("/api/onboarding/checkout-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: nextEmail }),
    });
    if (response.ok) {
      setOpen(false);
      router.refresh();
      setPending(false);
      return;
    }
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === "taken") {
      setMessage("That email is already in use.");
    } else if (body?.error === "stripe_retry") {
      setMessage("The sign-in email was updated. Billing email still needs another try.");
    } else {
      setMessage("The email could not be changed. Try again.");
    }
    setPending(false);
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm text-gray-800">
      <p>
        Your membership email is <span className="font-semibold">{email}</span>
      </p>
      <button
        type="button"
        className="mt-1 font-semibold text-[var(--brand)] underline-offset-2 hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        Wrong email? Change it
      </button>
      {open ? (
        <form onSubmit={save} className="mt-3 space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            Email
            <input
              type="email"
              required
              value={nextEmail}
              onChange={(event) => setNextEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </label>
          {suggestion ? (
            <button
              type="button"
              className="text-sm text-gray-700 underline"
              onClick={() => setNextEmail(suggestion)}
            >
              Did you mean {suggestion}?
            </button>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save email"}
          </button>
          {message ? <p className="text-sm text-gray-800">{message}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
