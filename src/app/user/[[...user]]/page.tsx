import AccountDeletionDangerZone from "@/components/account-deletion-danger-zone";
import { ACCOUNT_DELETION_INITIATION_ENABLED_ENV } from "@/lib/account-deletion/run-account-deletion-initiation";

import UserAccountClient from "./user-account-client";

/**
 * Account page (server). AccountDeletionDangerZone mounts only when
 * initiation flag is exactly "true". Backend remains dual-gated
 * (initiation AND scheduler). Flag value is never serialized to the
 * client — absence means hidden.
 */
export default function UserProfilePage() {
  const showDangerZone =
    process.env[ACCOUNT_DELETION_INITIATION_ENABLED_ENV] === "true";

  return (
    <UserAccountClient
      dangerZone={showDangerZone ? <AccountDeletionDangerZone /> : null}
    />
  );
}
