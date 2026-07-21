/**
 * Public store-facing account-deletion availability (copy only).
 *
 * ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE controls public disclosure copy on
 * /data-deletion (and related legal pages). It does not read server environment
 * values and does not enable the destructive API or Danger Zone mount — those
 * remain gated by the exact production initiation and scheduler server flags.
 */

export const ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE = true as const;

export const ACCOUNT_DELETION_PUBLIC_EFFECTIVE_DATE = "July 21, 2026" as const;

export const ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY =
  "Support@SummittMindset.com" as const;

export const ACCOUNT_DELETION_SUPPORT_EMAIL_HREF =
  "mailto:support@summittmindset.com" as const;

export const ACCOUNT_DELETION_ACCOUNT_PATH = "/user" as const;

export const ACCOUNT_DELETION_MEMBERSHIP_PATH = "/app/membership" as const;

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
        "Signed-in members can open Account, select Delete account in the Danger zone, confirm by typing DELETE, and re-verify their identity. Inactive or new app users without an active membership can start the same deletion flow directly from the Membership required screen. Deletion is permanent and is processed after you submit the request — it may take time to finish. Support remains available if you need help.",
      howToDeleteHeading: "In-app deletion",
      howToDeleteBody:
        "While signed in: use Account → Danger zone → Delete account, or Delete account on the Membership required screen if you do not have an active membership. Canceling membership alone is different from deleting your account. Limited legally required records may remain after deletion. Email Support@SummittMindset.com if you need assistance.",
    };
  }

  return {
    inAppAvailable: false,
    statusHeading: "Current availability",
    statusBody:
      "In-app account deletion is being finalized for public availability. The Delete account control is not shown to every member yet. If you need your account deleted before in-app activation is complete, email Support@SummittMindset.com and we will help you.",
    howToDeleteHeading: "How to request deletion today",
    howToDeleteBody:
      "Email Support@SummittMindset.com from the address on your account. When public in-app deletion is activated, signed-in members will also be able to start deletion from Account → Danger zone → Delete account, and inactive app users from the Membership required screen.",
  };
}
