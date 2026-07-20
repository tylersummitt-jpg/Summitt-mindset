"use client";

/**
 * APP-041F3 — Account deletion Danger Zone (UI gate only).
 *
 * Mounted by the server Account page only when the initiation flag is
 * exactly enabled. Backend remains dual-gated. No Clerk IDs, request IDs,
 * or env values in props.
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
import {
  utBody,
  utBodyMuted,
  utErrorPanel,
  utFormField,
  utSecondaryBtn,
  utSectionTitle,
} from "@/components/utility-page-visual";

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

export default function AccountDeletionDangerZone() {
  const titleId = useId();
  const panelId = useId();
  const inputId = useId();
  const liveId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inFlightRef = useRef(false);

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
        window.location.assign("/sign-in");
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
  }, [confirmationInput, enhancedPost, uiState]);

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
    <div className="space-y-3">
      <div className="rounded-lg border border-red-500/35 bg-red-950/20 px-3 py-3 sm:px-4">
        <h2 id={titleId} className={`${utSectionTitle} text-red-100`}>
          {ACCOUNT_DELETION_DANGER_ZONE_HEADING}
        </h2>
        <p className={`${utBodyMuted} mt-1`}>{ACCOUNT_DELETION_DANGER_ZONE_SUPPORT}</p>

        {uiState === "idle" ? (
          <div className="mt-3">
            <button
              ref={triggerRef}
              type="button"
              className="inline-flex w-full justify-center rounded-md border border-red-400/50 bg-transparent px-5 py-2 text-sm font-semibold text-red-100 transition hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:ring-offset-2 focus:ring-offset-[#111827] sm:w-auto"
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
            className="mt-4 space-y-4 border-t border-red-500/25 pt-4"
          >
            {uiState === "consequences" ||
            uiState === "confirmation" ||
            uiState === "submitting" ||
            uiState === "error" ? (
              <>
                <h3 className="font-semibold text-stone-100">
                  {ACCOUNT_DELETION_CONSEQUENCES_TITLE}
                </h3>
                <p className={utBody}>{ACCOUNT_DELETION_CONSEQUENCES_INTRO}</p>
                <p className={utBody}>
                  {ACCOUNT_DELETION_CONSEQUENCES_MEMBERSHIP_NOTE}
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-stone-300">
                  {ACCOUNT_DELETION_CONSEQUENCE_BULLETS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className={utBodyMuted}>{ACCOUNT_DELETION_RETENTION_CAVEAT}</p>
              </>
            ) : null}

            {uiState === "consequences" ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  className={utSecondaryBtn}
                  onClick={onCancel}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="inline-flex w-full justify-center rounded-md border border-red-400/50 bg-red-900/40 px-5 py-2 text-sm font-semibold text-red-50 transition hover:bg-red-800/50 focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:ring-offset-2 focus:ring-offset-[#111827] sm:w-auto"
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
                <label htmlFor={inputId} className={utBody}>
                  {ACCOUNT_DELETION_CONFIRM_INSTRUCTION}
                </label>
                <input
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
                  className={utFormField}
                  aria-invalid={
                    message != null && uiState === "confirmation"
                      ? true
                      : undefined
                  }
                />
                {message && (uiState === "confirmation" || uiState === "error") ? (
                  <p className={utErrorPanel} role="alert">
                    {message}
                  </p>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    className={utSecondaryBtn}
                    onClick={onCancel}
                    disabled={uiState === "submitting"}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="inline-flex w-full justify-center rounded-md border border-red-400/60 bg-red-700/70 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-600/80 focus:outline-none focus:ring-2 focus:ring-red-400/60 focus:ring-offset-2 focus:ring-offset-[#111827] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
            className="mt-4 space-y-3 border-t border-red-500/25 pt-4"
            role="status"
            aria-live="polite"
            id={liveId}
          >
            <p className={utBody}>{message}</p>
            {uiState === "accepted" || uiState === "existing" ? (
              <Link href="/sign-out" className={utSecondaryBtn}>
                Sign out
              </Link>
            ) : (
              <button type="button" className={utSecondaryBtn} onClick={resetFlow}>
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
