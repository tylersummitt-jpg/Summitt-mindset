"use client";

import { useAuth, useSignIn, useSignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  APP_POST_AUTH_PATH,
  APP_SIGN_IN_HEADING,
  APP_SIGN_IN_LEGAL_MID,
  APP_SIGN_IN_LEGAL_PREFIX,
  APP_SIGN_IN_SUPPORTING_COPY,
} from "@/lib/app-sign-in/app-sign-in-constants";
import {
  findEmailCodeFirstFactor,
  mapAppAuthError,
  type AppAuthErrorKind,
} from "@/lib/app-sign-in/app-sign-in-helpers";

type Mode = "choose" | "sign-in" | "sign-up";
type Step = "email" | "code";

const fieldClass =
  "w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-base text-[var(--text)] outline-none focus:border-[var(--text)]";
const primaryBtnClass =
  "w-full rounded-md bg-[var(--text)] px-4 py-3 text-base font-medium text-[var(--bg)] disabled:opacity-60";
const secondaryBtnClass =
  "w-full rounded-md border border-[var(--border)] px-4 py-3 text-base font-medium text-[var(--text)] disabled:opacity-60";
const linkBtnClass =
  "w-full rounded-md px-4 py-3 text-base text-[var(--muted)] underline underline-offset-4 disabled:opacity-60";

/**
 * Combined native-app Clerk email-code Sign in + Create account.
 * No social providers. No purchase CTAs. Post-auth → /post-sign-in.
 */
export default function AppEmailCodeSignIn() {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const {
    isLoaded: signInLoaded,
    signIn,
    setActive: setActiveFromSignIn,
  } = useSignIn();
  const {
    isLoaded: signUpLoaded,
    signUp,
    setActive: setActiveFromSignUp,
  } = useSignUp();

  const [mode, setMode] = useState<Mode>("choose");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<AppAuthErrorKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clerkReady = signInLoaded && signUpLoaded;
  const setActive = setActiveFromSignIn ?? setActiveFromSignUp;

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace(APP_POST_AUTH_PATH);
    }
  }, [authLoaded, isSignedIn, router]);

  function clearFeedback() {
    setError(null);
    setErrorKind(null);
  }

  function showMappedError(err: unknown) {
    const mapped = mapAppAuthError(err);
    setError(mapped.message);
    setErrorKind(mapped.kind);
  }

  function goToMode(next: Mode, preserveEmail = true) {
    setMode(next);
    setStep("email");
    setCode("");
    clearFeedback();
    if (!preserveEmail) setEmail("");
  }

  async function handleSignInSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signInLoaded || !signIn || submitting) return;

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter the email address for your account.");
      setErrorKind("generic");
      return;
    }

    setSubmitting(true);
    clearFeedback();

    try {
      const created = await signIn.create({ identifier: trimmed });
      const emailFactor = findEmailCodeFirstFactor(
        created.supportedFirstFactors
      );

      if (!emailFactor) {
        setError(
          "Email verification is not available for this account. Please try again later."
        );
        setErrorKind("strategy_unavailable");
        return;
      }

      await signIn.prepareFirstFactor(emailFactor);
      setCode("");
      setStep("code");
    } catch (err) {
      showMappedError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignInVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signInLoaded || !signIn || !setActive || submitting) return;

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Enter the verification code from your email.");
      setErrorKind("generic");
      return;
    }

    setSubmitting(true);
    clearFeedback();

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "email_code",
        code: trimmedCode,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.replace(APP_POST_AUTH_PATH);
        return;
      }

      if (result.status === "needs_second_factor") {
        setError(
          "Additional verification is required for this account. Please sign in on the website, or contact support."
        );
        setErrorKind("generic");
        return;
      }

      setError("Unable to complete sign-in. Please try again.");
      setErrorKind("generic");
    } catch (err) {
      showMappedError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUpSendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUpLoaded || !signUp || submitting) return;

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter the email address for your new account.");
      setErrorKind("generic");
      return;
    }

    setSubmitting(true);
    clearFeedback();

    try {
      await signUp.create({ emailAddress: trimmed });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setCode("");
      setStep("code");
    } catch (err) {
      showMappedError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUpVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!signUpLoaded || !signUp || !setActive || submitting) return;

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("Enter the verification code from your email.");
      setErrorKind("generic");
      return;
    }

    setSubmitting(true);
    clearFeedback();

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: trimmedCode,
      });

      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.replace(APP_POST_AUTH_PATH);
        return;
      }

      setError("Unable to complete account creation. Please try again.");
      setErrorKind("generic");
    } catch (err) {
      showMappedError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!authLoaded || !clerkReady || isSignedIn) {
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

  const modeLabel =
    mode === "sign-in"
      ? "Sign in"
      : mode === "sign-up"
        ? "Create account"
        : null;

  return (
    <div
      className="mx-auto w-full max-w-md px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
      data-app-sign-in="email-code"
      data-app-auth-mode={mode}
    >
      <header className="space-y-2 text-center">
        <p className="text-sm font-medium tracking-wide text-[var(--muted)]">
          Summitt Mindset
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          {APP_SIGN_IN_HEADING}
        </h1>
        <p className="text-base leading-7 text-[var(--muted)]">
          {mode === "choose"
            ? APP_SIGN_IN_SUPPORTING_COPY
            : mode === "sign-in"
              ? "Sign in with your email to continue."
              : "Create a new account with your email."}
        </p>
        {modeLabel ? (
          <p className="text-sm font-medium text-[var(--text)]">{modeLabel}</p>
        ) : null}
      </header>

      <div className="mt-8 space-y-4">
        {error ? (
          <div
            className="space-y-3 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800"
            role="alert"
          >
            <p>{error}</p>
            {errorKind === "identifier_not_found" && mode === "sign-in" ? (
              <button
                type="button"
                disabled={submitting}
                className={secondaryBtnClass}
                onClick={() => goToMode("sign-up", true)}
              >
                Create account
              </button>
            ) : null}
            {errorKind === "identifier_exists" && mode === "sign-up" ? (
              <button
                type="button"
                disabled={submitting}
                className={secondaryBtnClass}
                onClick={() => goToMode("sign-in", true)}
              >
                Sign in instead
              </button>
            ) : null}
          </div>
        ) : null}

        {mode === "choose" ? (
          <div className="space-y-3">
            <button
              type="button"
              className={primaryBtnClass}
              onClick={() => goToMode("sign-in", true)}
            >
              Sign in
            </button>
            <button
              type="button"
              className={secondaryBtnClass}
              onClick={() => goToMode("sign-up", true)}
            >
              Create account
            </button>
          </div>
        ) : null}

        {mode === "sign-in" && step === "email" ? (
          <form className="space-y-4" onSubmit={handleSignInSendCode} noValidate>
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
                className={fieldClass}
                placeholder="you@example.com"
              />
            </label>
            <button type="submit" disabled={submitting} className={primaryBtnClass}>
              {submitting ? "Sending code…" : "Send verification code"}
            </button>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => goToMode("choose", true)}
            >
              Back
            </button>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => goToMode("sign-up", true)}
            >
              Create account
            </button>
          </form>
        ) : null}

        {mode === "sign-in" && step === "code" ? (
          <form
            className="space-y-4"
            onSubmit={handleSignInVerifyCode}
            noValidate
          >
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
                className={`${fieldClass} tracking-widest`}
                placeholder="123456"
              />
            </label>
            <button type="submit" disabled={submitting} className={primaryBtnClass}>
              {submitting ? "Verifying…" : "Sign in"}
            </button>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => {
                setStep("email");
                setCode("");
                clearFeedback();
              }}
            >
              Use a different email
            </button>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => goToMode("choose", true)}
            >
              Back
            </button>
          </form>
        ) : null}

        {mode === "sign-up" && step === "email" ? (
          <form className="space-y-4" onSubmit={handleSignUpSendCode} noValidate>
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
                className={fieldClass}
                placeholder="you@example.com"
              />
            </label>
            <button type="submit" disabled={submitting} className={primaryBtnClass}>
              {submitting ? "Sending code…" : "Send verification code"}
            </button>
            <p className="text-center text-xs leading-5 text-[var(--muted)]">
              {APP_SIGN_IN_LEGAL_PREFIX}{" "}
              <Link href="/terms" className="underline underline-offset-4">
                Terms
              </Link>{" "}
              {APP_SIGN_IN_LEGAL_MID}{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </p>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => goToMode("choose", true)}
            >
              Back
            </button>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => goToMode("sign-in", true)}
            >
              Sign in instead
            </button>
          </form>
        ) : null}

        {mode === "sign-up" && step === "code" ? (
          <form
            className="space-y-4"
            onSubmit={handleSignUpVerifyCode}
            noValidate
          >
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
                className={`${fieldClass} tracking-widest`}
                placeholder="123456"
              />
            </label>
            <button type="submit" disabled={submitting} className={primaryBtnClass}>
              {submitting ? "Verifying…" : "Create account"}
            </button>
            <p className="text-center text-xs leading-5 text-[var(--muted)]">
              {APP_SIGN_IN_LEGAL_PREFIX}{" "}
              <Link href="/terms" className="underline underline-offset-4">
                Terms
              </Link>{" "}
              {APP_SIGN_IN_LEGAL_MID}{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </p>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => {
                setStep("email");
                setCode("");
                clearFeedback();
              }}
            >
              Use a different email
            </button>
            <button
              type="button"
              disabled={submitting}
              className={linkBtnClass}
              onClick={() => goToMode("sign-in", true)}
            >
              Sign in instead
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
