"use client";

import { useAuth, useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  APP_SIGN_IN_HEADING,
  APP_SIGN_IN_SUCCESS_PATH,
  APP_SIGN_IN_SUPPORTING_COPY,
} from "@/lib/app-sign-in/app-sign-in-constants";
import {
  findEmailCodeFirstFactor,
  mapAppSignInError,
} from "@/lib/app-sign-in/app-sign-in-helpers";

type Step = "email" | "code";

/**
 * Custom Clerk email verification-code sign-in for the native app shell.
 * Intentionally does not render social or third-party identity buttons.
 */
export default function AppEmailCodeSignIn() {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace(APP_SIGN_IN_SUCCESS_PATH);
    }
  }, [authLoaded, isSignedIn, router]);

  async function handleSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signIn || submitting) return;

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter the email address for your account.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const created = await signIn.create({ identifier: trimmed });
      const emailFactor = findEmailCodeFirstFactor(
        created.supportedFirstFactors
      );

      if (!emailFactor) {
        setError(
          "Email verification is not available for this account. Please try again later."
        );
        return;
      }

      await signIn.prepareFirstFactor(emailFactor);
      setCode("");
      setStep("code");
    } catch (err) {
      setError(mapAppSignInError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signIn || !setActive || submitting) return;

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Enter the verification code from your email.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: trimmedCode,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.replace(APP_SIGN_IN_SUCCESS_PATH);
        return;
      }

      if (result.status === "needs_second_factor") {
        setError(
          "Additional verification is required for this account. Please sign in on the website, or contact support."
        );
        return;
      }

      setError("Unable to complete sign-in. Please try again.");
    } catch (err) {
      setError(mapAppSignInError(err));
    } finally {
      setSubmitting(false);
    }
  }

  function handleUseDifferentEmail() {
    setStep("email");
    setCode("");
    setError(null);
  }

  if (!authLoaded || !isLoaded || isSignedIn) {
    return (
      <div
        className="flex min-h-[50vh] items-center justify-center px-4"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <div
      className="mx-auto w-full max-w-md px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
      data-app-sign-in="email-code"
    >
      <header className="space-y-2 text-center">
        <p className="text-sm font-medium tracking-wide text-[var(--muted)]">
          Summitt Mindset
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          {APP_SIGN_IN_HEADING}
        </h1>
        <p className="text-base leading-7 text-[var(--muted)]">
          {APP_SIGN_IN_SUPPORTING_COPY}
        </p>
      </header>

      <div className="mt-8 space-y-4">
        {error ? (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {step === "email" ? (
          <form className="space-y-4" onSubmit={handleSendCode} noValidate>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-[var(--text)]">
                Email
              </span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                enterKeyHint="send"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base text-[var(--text)] outline-none focus:border-[var(--text)]"
                placeholder="you@example.com"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-[var(--text)] px-4 py-3 text-base font-medium text-[var(--bg)] disabled:opacity-60"
            >
              {submitting ? "Sending code…" : "Continue"}
            </button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleVerifyCode} noValidate>
            <p className="text-sm leading-6 text-[var(--muted)]">
              Enter the verification code we sent to your email. Check your spam
              folder if you do not see it.
            </p>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-[var(--text)]">
                Verification code
              </span>
              <input
                type="text"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                enterKeyHint="done"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={submitting}
                className="w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base tracking-widest text-[var(--text)] outline-none focus:border-[var(--text)]"
                placeholder="123456"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-[var(--text)] px-4 py-3 text-base font-medium text-[var(--bg)] disabled:opacity-60"
            >
              {submitting ? "Verifying…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={handleUseDifferentEmail}
              disabled={submitting}
              className="w-full rounded-md px-4 py-3 text-base text-[var(--muted)] underline underline-offset-4 disabled:opacity-60"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
