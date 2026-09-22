import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import {
  inactiveMembershipRedirectPath,
  signInPathForClient,
} from "@/lib/native-app/membership-paths";

/**
 * Same membership rule as Film Room: an active subscriber may enter.
 * Programs does not have its own plan, enrollment, or Stripe product.
 */
export function programsAccessRedirect(args: {
  userId: string | null | undefined;
  metadata: unknown;
  isNativeApp: boolean;
}): "/app/sign-in" | "/sign-in" | "/app/membership" | "/subscribe" | null {
  if (!args.userId) {
    return signInPathForClient(args.isNativeApp);
  }
  if (!isSubscribedFromPublicMetadata(args.metadata)) {
    return inactiveMembershipRedirectPath(args.isNativeApp);
  }
  return null;
}
