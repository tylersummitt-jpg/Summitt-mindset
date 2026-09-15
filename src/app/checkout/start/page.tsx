export const dynamic = "force-dynamic";

import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  checkoutPlanFromSearchValue,
  signUpHrefForCheckoutStart,
} from "@/lib/checkout-plan";
import { linkMarketingVisitorToClerkUser } from "@/lib/marketing-account-link";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { APP_MEMBERSHIP_PATH } from "@/lib/native-app/membership-paths";
import CheckoutStartClient from "./checkout-start-client";

async function resolveCheckoutStartSearchParams(
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>
) {
  if (!searchParams) return {};
  return searchParams instanceof Promise ? await searchParams : searchParams;
}

/**
 * Authenticated consumer checkout hop.
 * Not a sales page. Links marketing (fail-open), then starts Stripe Checkout
 * for the selected plan (monthly default; annual only when ?plan=annual).
 */
export default async function CheckoutStartPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  if (isNativeApp) {
    redirect(APP_MEMBERSHIP_PATH);
  }

  const sp = await resolveCheckoutStartSearchParams(searchParams);
  const plan = checkoutPlanFromSearchValue(sp.plan);

  const user = await currentUser();
  if (!user?.id) {
    redirect(signUpHrefForCheckoutStart(plan));
  }

  try {
    await linkMarketingVisitorToClerkUser(user.id);
  } catch {
    // fail-open: analytics must never change checkout
  }

  return <CheckoutStartClient plan={plan} />;
}
