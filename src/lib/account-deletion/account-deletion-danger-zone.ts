/**
 * APP-041F3 — pure Danger Zone helpers (no React, no env reads, no I/O).
 *
 * UI gating uses initiation flag only (exact "true") on the server page.
 * Backend remains dual-gated (initiation AND scheduler).
 *
 * Imports only the browser-safe initiation contract — never server-only modules.
 */

import { ACCOUNT_DELETION_CONFIRMATION_VALUE } from "./account-deletion-initiation-contract";

export {
  ACCOUNT_DELETION_POST_PATH,
  buildAccountDeletionInitiationRequestBody,
} from "./account-deletion-initiation-contract";

export const ACCOUNT_DELETION_DANGER_ZONE_HEADING = "Danger zone" as const;
export const ACCOUNT_DELETION_DANGER_ZONE_SUPPORT =
  "Permanently delete your Summitt Mindset account and associated app data." as const;
export const ACCOUNT_DELETION_DANGER_ZONE_TRIGGER = "Delete account" as const;

export const ACCOUNT_DELETION_CONSEQUENCES_TITLE =
  "Delete your account permanently?" as const;

export const ACCOUNT_DELETION_CONSEQUENCES_INTRO =
  "This permanently deletes your Summitt Mindset account. It is not the same as canceling membership." as const;

export const ACCOUNT_DELETION_CONSEQUENCES_MEMBERSHIP_NOTE =
  "Deleting your account removes Summitt Mindset access. A membership billed directly by Summitt is canceled as part of deletion. If you purchased through Apple, deleting your Summitt account does not cancel the App Store subscription — manage or cancel that subscription through Apple. Deleting your account will:" as const;

export const ACCOUNT_DELETION_CONSEQUENCE_BULLETS = [
  "Stop Summitt Mindset text messages",
  "Remove Summitt Mindset membership access",
  "Permanently delete your app data, including journals, progress, and related records",
  "Delete your sign-in identity",
] as const;

export const ACCOUNT_DELETION_RETENTION_CAVEAT =
  "Some billing and required opt-out records may be retained as required by law or messaging rules." as const;

export const ACCOUNT_DELETION_CONFIRM_INSTRUCTION =
  "Type DELETE to confirm." as const;

export const ACCOUNT_DELETION_FINAL_ACTION =
  "Permanently delete my account" as const;

export const ACCOUNT_DELETION_UI_COPY = {
  accepted:
    "Your deletion request has been received. We'll stop messages and begin permanently deleting your account. You may be signed out as the process completes.",
  existing: "A deletion request is already in progress for your account.",
  already_completed: "Your account deletion has already been completed.",
  unavailable: "Account deletion isn't available right now.",
  reauth: "We couldn't verify your identity. Please try again.",
  generic:
    "We couldn't start account deletion. Please try again or email Support@SummittMindset.com.",
  invalid_confirmation: "Type DELETE exactly to confirm.",
  support:
    "We couldn't start account deletion. Please email Support@SummittMindset.com.",
} as const;

export type AccountDeletionDangerZoneUiState =
  | "idle"
  | "consequences"
  | "confirmation"
  | "submitting"
  | "accepted"
  | "existing"
  | "already_completed"
  | "disabled"
  | "error";

export type AccountDeletionDangerZoneMappedResult = {
  uiState: AccountDeletionDangerZoneUiState;
  message: string;
  redirectToSignIn?: boolean;
};

/** Exact typed confirmation — no trim, no case folding. */
export function isExactAccountDeletionConfirmationInput(
  value: string
): boolean {
  return value === ACCOUNT_DELETION_CONFIRMATION_VALUE;
}

/**
 * Map a parsed initiation JSON body to UI state + safe copy.
 * Never surfaces raw codes or arbitrary payloads to the user.
 */
export function mapAccountDeletionInitiationResponse(
  body: unknown
): AccountDeletionDangerZoneMappedResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { uiState: "error", message: ACCOUNT_DELETION_UI_COPY.generic };
  }
  const code = (body as { code?: unknown }).code;
  if (typeof code !== "string") {
    // Clerk reverification hint shape — treated as identity failure if it
    // reaches the UI (useReverification normally intercepts before this).
    if ("clerk_error" in (body as object)) {
      return { uiState: "error", message: ACCOUNT_DELETION_UI_COPY.reauth };
    }
    return { uiState: "error", message: ACCOUNT_DELETION_UI_COPY.generic };
  }

  switch (code) {
    case "accepted_new":
      return { uiState: "accepted", message: ACCOUNT_DELETION_UI_COPY.accepted };
    case "accepted_existing":
      return { uiState: "existing", message: ACCOUNT_DELETION_UI_COPY.existing };
    case "already_completed":
      return {
        uiState: "already_completed",
        message: ACCOUNT_DELETION_UI_COPY.already_completed,
      };
    case "account_deletion_initiation_disabled":
      return {
        uiState: "disabled",
        message: ACCOUNT_DELETION_UI_COPY.unavailable,
      };
    case "reauth_required":
      return { uiState: "error", message: ACCOUNT_DELETION_UI_COPY.reauth };
    case "invalid_confirmation":
      return {
        uiState: "confirmation",
        message: ACCOUNT_DELETION_UI_COPY.invalid_confirmation,
      };
    case "failed_terminal":
    case "conflict":
      return { uiState: "error", message: ACCOUNT_DELETION_UI_COPY.support };
    case "unauthorized":
      return {
        uiState: "error",
        message: ACCOUNT_DELETION_UI_COPY.generic,
        redirectToSignIn: true,
      };
    case "internal_error":
    default:
      return { uiState: "error", message: ACCOUNT_DELETION_UI_COPY.generic };
  }
}

export function canSubmitAccountDeletionConfirmation(
  uiState: AccountDeletionDangerZoneUiState,
  confirmationInput: string
): boolean {
  return (
    (uiState === "confirmation" || uiState === "error") &&
    isExactAccountDeletionConfirmationInput(confirmationInput)
  );
}
