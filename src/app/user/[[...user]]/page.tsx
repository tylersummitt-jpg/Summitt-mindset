import { auth, currentUser } from "@clerk/nextjs/server";

import AccountDeletionDangerZone from "@/components/account-deletion-danger-zone";
import { shouldShowAccountDeletionDangerZone } from "@/lib/account-deletion/account-deletion-initiation-access.server";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { resolveShowSubscribeAgain } from "@/lib/subscribe-again-eligibility.server";

import UserAccountClient from "./user-account-client";

/**
 * Account page (server). AccountDeletionDangerZone mounts only when the
 * shared initiation access helper grants access for auth().userId
 * (public dual-gate or controlled single-user test path).
 *
 * Backend remains gated by the same decision. Access mode, test flags, and
 * allowlisted IDs are never serialized to the client — absence means hidden.
 *
 * force-dynamic: evaluate access per request/runtime and avoid statically
 * baking user Account UI visibility.
 */
export const dynamic = "force-dynamic";

export default async function UserProfilePage() {
  const { userId } = await auth();
  const showDangerZone = shouldShowAccountDeletionDangerZone(userId);

  let showSubscribeAgain = false;
  if (userId) {
    const [user, isNativeApp] = await Promise.all([
      currentUser(),
      isNativeSummittMindsetAppRequest(),
    ]);
    showSubscribeAgain = await resolveShowSubscribeAgain({
      userId,
      isNativeApp,
      publicMetadata: (user?.publicMetadata || {}) as Record<string, unknown>,
    });
  }

  return (
    <UserAccountClient
      showSubscribeAgain={showSubscribeAgain}
      dangerZone={
        showDangerZone ? <AccountDeletionDangerZone surface="dark" /> : null
      }
    />
  );
}
