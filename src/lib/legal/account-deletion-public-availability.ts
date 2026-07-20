/**
 * Public store-facing account-deletion availability (copy only).
 *
 * Flip ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE to true at final public
 * activation so /data-deletion and related copy point members to Account →
 * Danger zone → Delete account. Does not read server environment values.
 */

export const ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE = false as const;

export const ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE = "July 20, 2026" as const;

export const ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY =
  "Support@SummittMindset.com" as const;

export const ACCOUNT_DELETION_SUPPORT_EMAIL_HREF =
  "mailto:support@summittmindset.com" as const;

export const ACCOUNT_DELETION_ACCOUNT_PATH = "/user" as const;

export const ACCOUNT_DELETION_PUBLIC_PATH = "/data-deletion" as const;

export const ACCOUNT_DELETION_PRIVACY_PATH = "/privacy" as const;

export type AccountDeletionPublicAvailability = {
  inAppAvailable: boolean;
  statusHeading: string;
  statusBody: string;
  howToDeleteHeading: string;
  howToDeleteBody: string;
};

export function getAccountDeletionPublicAvailability(
  inAppAvailable: boolean = ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE
): AccountDeletionPublicAvailability {
  if (inAppAvailable) {
    return {
      inAppAvailable: true,
      statusHeading: "How to delete your account in the app",
      statusBody:
        "Signed-in members can request permanent account deletion from Account. Open Account, go to Danger zone, and choose Delete account. You will be asked to confirm and re-verify your identity before the request is submitted.",
      howToDeleteHeading: "In-app deletion",
      howToDeleteBody:
        "Use Account → Danger zone → Delete account while signed in. Deletion is permanent and is not the same as canceling membership.",
    };
  }

  return {
    inAppAvailable: false,
    statusHeading: "Current availability",
    statusBody:
      "In-app account deletion is being finalized for public availability. The Delete account control is not shown to every member yet. If you need your account deleted before in-app activation is complete, email Support@SummittMindset.com and we will help you.",
    howToDeleteHeading: "How to request deletion today",
    howToDeleteBody:
      "Email Support@SummittMindset.com from the address on your account. When public in-app deletion is activated, signed-in members will also be able to start deletion from Account → Danger zone → Delete account.",
  };
}
