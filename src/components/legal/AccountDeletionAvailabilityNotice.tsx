import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
  getAccountDeletionPublicAvailability,
} from "@/lib/legal/account-deletion-public-availability";

/**
 * Single status block for /data-deletion transitional vs activated copy.
 * Change ACCOUNT_DELETION_PUBLIC_IN_APP_AVAILABLE to flip wording at launch.
 */
export default function AccountDeletionAvailabilityNotice() {
  const availability = getAccountDeletionPublicAvailability();

  return (
    <section
      className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5"
      data-account-deletion-availability={
        availability.inAppAvailable ? "in-app" : "support-rollout"
      }
    >
      <h2 className="text-xl font-semibold text-[var(--text)]">
        {availability.statusHeading}
      </h2>
      <p className="text-base leading-7 text-[var(--muted)] sm:text-[0.95rem] sm:leading-7">
        {availability.statusBody}
      </p>
      {!availability.inAppAvailable ? (
        <p className="text-base leading-7 text-[var(--muted)] sm:text-[0.95rem]">
          Contact{" "}
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
          .
        </p>
      ) : null}
    </section>
  );
}
