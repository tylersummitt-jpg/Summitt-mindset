export const dynamic = "force-dynamic";

import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { linkMarketingVisitorToClerkUser } from "@/lib/marketing-account-link";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { APP_MEMBERSHIP_PATH } from "@/lib/native-app/membership-paths";
import CheckoutStartClient from "./checkout-start-client";

const SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent("/checkout/start")}`;

/**
 * Authenticated consumer checkout hop.
 * Not a sales page. Links marketing (fail-open), then starts monthly Stripe Checkout.
 */
export default async function CheckoutStartPage() {
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  if (isNativeApp) {
    redirect(APP_MEMBERSHIP_PATH);
  }

  const user = await currentUser();
  if (!user?.id) {
    redirect(SIGN_UP_HREF);
  }

  try {
    await linkMarketingVisitorToClerkUser(user.id);
  } catch {
    // fail-open: analytics must never change checkout
  }

  return <CheckoutStartClient />;
}
