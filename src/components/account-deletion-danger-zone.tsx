"use client";

/**
 * APP-041F3 — Account deletion Danger Zone (UI gate only).
 * APP-041F4a — focus/keyboard hardening + unauthorized submit polish.
 *
 * Mounted by the server Account page only when the initiation flag is
 * exactly enabled. Backend remains dual-gated. No Clerk IDs, request IDs,
 * or env values in props.
 *
 * Visual `surface` is presentation-only: "dark" for /user, "light" for
 * /app/membership. Behavior and API contract are identical.
 */

import {
  useReverification,
} from "@clerk/nextjs";
import { isReverificationCancelledError } from "@clerk/nextjs/errors";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  ACCOUNT_DELETION_CONFIRM_INSTRUCTION,
  ACCOUNT_DELETION_CONSEQUENCE_BULLETS,
  ACCOUNT_DELETION_CONSEQUENCES_INTRO,
  ACCOUNT_DELETION_CONSEQUENCES_MEMBERSHIP_NOTE,
  ACCOUNT_DELETION_CONSEQUENCES_TITLE,
  ACCOUNT_DELETION_DANGER_ZONE_HEADING,
  ACCOUNT_DELETION_DANGER_ZONE_SUPPORT,
  ACCOUNT_DELETION_DANGER_ZONE_TRIGGER,
  ACCOUNT_DELETION_FINAL_ACTION,
  ACCOUNT_DELETION_POST_PATH,
  ACCOUNT_DELETION_RETENTION_CAVEAT,
  ACCOUNT_DELETION_UI_COPY,
  buildAccountDeletionInitiationRequestBody,
  canSubmitAccountDeletionConfirmation,
  mapAccountDeletionInitiationResponse,
  type AccountDeletionDangerZoneUiState,
} from "@/lib/account-deletion/account-deletion-danger-zone";
import { useIsNativeSummittMindsetIos } from "@/components/native-app/NativeAppProvider";
import { signInPathForClient } from "@/lib/native-app/membership-paths";
import {
  utBody,
  utBodyMuted,
  utErrorPanel,
  utFormField,
  utSecondaryBtn,
  utSectionTitle,
} from "@/components/utility-page-visual";

export type AccountDeletionDangerZoneSurface = "dark" | "light";

type SurfaceStyles = {
  card: string;
  heading: string;
  support: string;
  body: string;
  bodyMuted: string;
  list: string;
  consequencesTitle: string;
  panelDivider: string;
  triggerBtn: string;
  continueBtn: string;
  finalBtn: string;
  secondaryBtn: string;
  formField: string;
  errorPanel: string;
};

const SURFACE_STYLES: Record<AccountDeletionDangerZoneSurface, SurfaceStyles> =
  {
    dark: {
      card: "rounded-lg border border-red-500/35 bg-red-950/20 px-3 py-3 sm:px-4",
      heading: `${utSectionTitle} text-red-100`,
      support: `${utBodyMuted} mt-1`,
      body: utBody,
      bodyMuted: utBodyMuted,
      list: "list-disc space-y-1 pl-5 text-sm text-stone-300",
      consequencesTitle: "font-semibold text-stone-100 outline-none",
      panelDivider: "mt-4 space-y-4 border-t border-red-500/25 pt-4",
      triggerBtn:
        "inline-flex w-full justify-center rounded-md border border-red-400/50 bg-transparent px-5 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:ring-offset-2 focus:ring-offset-[#111827] sm:w-auto",
      continueBtn:
        "inline-flex w-full justify-center rounded-md border border-red-400/50 bg-red-900/40 px-5 py-2 text-sm font-semibold text-red-50 transition hover:bg-red-800/50 focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:ring-offset-2 focus:ring-offset-[#111827] sm:w-auto",
      finalBtn:
        "inline-flex w-full justify-center rounded-md border border-red-400/60 bg-red-700/70 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600/80 focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:ring-offset-2 focus:ring-offset-[#111827] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto",
      secondaryBtn: utSecondaryBtn,
      formField: utFormField,
      errorPanel: utErrorPanel,
    },
    light: {
      card: "rounded-lg border border-red-300 bg-red-50 px-3 py-3 sm:px-4",
      heading: "font-semibold text-red-950",
      support: "mt-1 text-sm leading-relaxed text-stone-700 sm:text-base",
      body: "text-sm leading-relaxed text-stone-800 sm:text-base",
      bodyMuted: "text-sm leading-relaxed text-stone-600 sm:text-base",
      list: "list-disc space-y-1 pl-5 text-sm text-stone-700 sm:text-base",
      consequencesTitle: "font-semibold text-red-950 outline-none",
      panelDivider: "mt-4 space-y-4 border-t border-red-200 pt-4",
      triggerBtn:
        "inline-flex w-full justify-center rounded-md border border-red-800 bg-red-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2 focus:ring-offset-red-50 disabled:cursor-not-allowed disabled:bg-red-800/50 disabled:text-white/80 sm:w-auto",
      continueBtn:
        "inline-flex w-full justify-center rounded-md border border-red-800 bg-red-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2 focus:ring-offset-red-50 sm:w-auto",
      finalBtn:
        "inline-flex w-full justify-center rounded-md border border-red-900 bg-red-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-900 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2 focus:ring-offset-red-50 disabled:cursor-not-allowed disabled:border-red-300 disabled:bg-red-300 disabled:text-white sm:w-auto",
      secondaryBtn:
        "inline-flex w-full justify-center rounded-md border border-stone-400 bg-white px-5 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 focus:ring-offset-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto",
      formField:
        "w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-base text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-red-700 focus:ring-offset-2 focus:ring-offset-red-50 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500",
      errorPanel:
        "rounded-lg border border-red-300 bg-red-100 px-4 py-3 text-sm text-red-900",
    },
  };

async function postAccountDeletionInitiation(): Promise<unknown> {
  const res = await fetch(ACCOUNT_DELETION_POST_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAccountDeletionInitiationRequestBody()),
  });
  try {
    return await res.json();
  } catch {
    return { ok: false, code: "internal_error" };
  }
}

export default function AccountDeletionDangerZone({
  surface = "dark",
}: {
  surface?: AccountDeletionDangerZoneSurface;
}) {
  const styles = SURFACE_STYLES[surface];
  const titleId = useId();
  const panelId = useId();
  const inputId = useId();
  const liveId = useId();
  const consequencesHeadingId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const consequencesHeadingRef = useRef<HTMLHeadingElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);
  const prevUiStateRef = useRef<AccountDeletionDangerZoneUiState>("idle");
  const isNativeIos = useIsNativeSummittMindsetIos();

  const [uiState, setUiState] =
    useState<AccountDeletionDangerZoneUiState>("idle");
  const [confirmationInput, setConfirmationInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const enhancedPost = useReverification(postAccountDeletionInitiation);

  const resetFlow = useCallback(() => {
    if (inFlightRef.current) return;
    setUiState("idle");
    setConfirmationInput("");
    setMessage(null);
    queueMicrotask(() => triggerRef.current?.focus());
  }, []);

  const openConsequences = useCallback(() => {
    setConfirmationInput("");
    setMessage(null);
    setUiState("consequences");
  }, []);

  const openConfirmation = useCallback(() => {
    setConfirmationInput("");
    setMessage(null);
    setUiState("confirmation");
  }, []);

  const onCancel = useCallback(() => {
    if (inFlightRef.current || uiState === "submitting") return;
    resetFlow();
  }, [resetFlow, uiState]);

  useEffect(() => {
    if (
      uiState !== "consequences" &&
      uiState !== "confirmation" &&
      uiState !== "error"
    ) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (inFlightRef.current) return;
      event.preventDefault();
      resetFlow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetFlow, uiState]);

  // Focus management on step transitions (inline panel — not a dialog).
  useEffect(() => {
    const prev = prevUiStateRef.current;
    prevUiStateRef.current = uiState;
    if (prev === uiState) return;

    queueMicrotask(() => {
      if (uiState === "consequences" && prev === "idle") {
        (consequencesHeadingRef.current ?? continueRef.current)?.focus();
        return;
      }
      if (uiState === "confirmation" && prev === "consequences") {
        confirmationInputRef.current?.focus();
        return;
      }
      if (
        uiState === "accepted" ||
        uiState === "existing" ||
        uiState === "already_completed" ||
        uiState === "disabled"
      ) {
        resultRef.current?.focus();
      }
    });
  }, [uiState]);

  const onSubmit = useCallback(async () => {
    if (!canSubmitAccountDeletionConfirmation(uiState, confirmationInput)) {
      return;
    }
    if (inFlightRef.current || uiState === "submitting") return;

    inFlightRef.current = true;
    setUiState("submitting");
    setMessage(null);

    try {
      const body = await enhancedPost();
      const mapped = mapAccountDeletionInitiationResponse(body);
      if (mapped.redirectToSignIn) {
        // Leave submitting before navigation so delayed/blocked redirects
        // do not leave a stuck "Submitting…" control.
        setMessage(mapped.message);
        setUiState("error");
        inFlightRef.current = false;
        window.location.assign(signInPathForClient(isNativeIos));
        return;
      }
      setMessage(mapped.message);
      setUiState(mapped.uiState);
      if (mapped.uiState === "confirmation") {
        setConfirmationInput("");
      }
    } catch (err) {
      if (isReverificationCancelledError(err)) {
        setMessage(ACCOUNT_DELETION_UI_COPY.reauth);
        setUiState("error");
        return;
      }
      setMessage(ACCOUNT_DELETION_UI_COPY.generic);
      setUiState("error");
    } finally {
      inFlightRef.current = false;
    }
  }, [confirmationInput, enhancedPost, isNativeIos, uiState]);

  const panelOpen =
    uiState === "consequences" ||
    uiState === "confirmation" ||
    uiState === "submitting" ||
    uiState === "error";

  const resultOpen =
    uiState === "accepted" ||
    uiState === "existing" ||
    uiState === "already_completed" ||
    uiState === "disabled";

  return (
    <div className="space-y-3" data-account-deletion-surface={surface}>
      <div className={styles.card}>
        <h2 id={titleId} className={styles.heading}>
          {ACCOUNT_DELETION_DANGER_ZONE_HEADING}
        </h2>
        <p className={styles.support}>{ACCOUNT_DELETION_DANGER_ZONE_SUPPORT}</p>

        {uiState === "idle" ? (
          <div className="mt-3">
            <button
              ref={triggerRef}
              type="button"
              className={styles.triggerBtn}
              onClick={openConsequences}
            >
              {ACCOUNT_DELETION_DANGER_ZONE_TRIGGER}
            </button>
          </div>
        ) : null}

        {panelOpen ? (
          <div
            id={panelId}
            role="region"
            aria-labelledby={titleId}
            className={styles.panelDivider}
          >
            {uiState === "consequences" ||
            uiState === "confirmation" ||
            uiState === "submitting" ||
            uiState === "error" ? (
              <>
                <h3
                  id={consequencesHeadingId}
                  ref={consequencesHeadingRef}
                  tabIndex={-1}
                  className={styles.consequencesTitle}
                >
                  {ACCOUNT_DELETION_CONSEQUENCES_TITLE}
                </h3>
                <p className={styles.body}>{ACCOUNT_DELETION_CONSEQUENCES_INTRO}</p>
                <p className={styles.body}>
                  {ACCOUNT_DELETION_CONSEQUENCES_MEMBERSHIP_NOTE}
                </p>
                <ul className={styles.list}>
                  {ACCOUNT_DELETION_CONSEQUENCE_BULLETS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className={styles.bodyMuted}>{ACCOUNT_DELETION_RETENTION_CAVEAT}</p>
              </>
            ) : null}

            {uiState === "consequences" ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={onCancel}
                >
                  Cancel
                </button>
                <button
                  ref={continueRef}
                  type="button"
                  className={styles.continueBtn}
                  onClick={openConfirmation}
                >
                  Continue
                </button>
              </div>
            ) : null}

            {uiState === "confirmation" ||
            uiState === "submitting" ||
            uiState === "error" ? (
              <div className="space-y-3">
                <label htmlFor={inputId} className={styles.body}>
                  {ACCOUNT_DELETION_CONFIRM_INSTRUCTION}
                </label>
                <input
                  ref={confirmationInputRef}
                  id={inputId}
                  type="text"
                  name="account-deletion-confirmation"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={confirmationInput}
                  disabled={uiState === "submitting"}
                  onChange={(e) => setConfirmationInput(e.target.value)}
                  className={styles.formField}
                  aria-invalid={
                    message != null && uiState === "confirmation"
                      ? true
                      : undefined
                  }
                />
                {message && (uiState === "confirmation" || uiState === "error") ? (
                  <p className={styles.errorPanel} role="alert">
                    {message}
                  </p>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={onCancel}
                    disabled={uiState === "submitting"}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.finalBtn}
                    disabled={
                      !canSubmitAccountDeletionConfirmation(
                        uiState,
                        confirmationInput
                      ) || uiState === "submitting"
                    }
                    aria-busy={uiState === "submitting"}
                    onClick={() => {
                      void onSubmit();
                    }}
                  >
                    {uiState === "submitting"
                      ? "Submitting…"
                      : ACCOUNT_DELETION_FINAL_ACTION}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {resultOpen ? (
          <div
            ref={resultRef}
            tabIndex={-1}
            className={`${styles.panelDivider} outline-none`}
            role="status"
            aria-live="polite"
            id={liveId}
          >
            <p className={styles.body}>{message}</p>
            {uiState === "accepted" || uiState === "existing" ? (
              <Link href="/sign-out" className={styles.secondaryBtn}>
                Sign out
              </Link>
            ) : (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={resetFlow}
              >
                Close
              </button>
            )}
          </div>
        ) : null}

        <div className="sr-only" aria-live="polite" id={`${liveId}-busy`}>
          {uiState === "submitting" ? "Submitting account deletion request." : ""}
        </div>
      </div>
    </div>
  );
}
