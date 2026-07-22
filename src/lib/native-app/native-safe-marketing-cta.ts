/**
 * Native-safe marketing CTA destinations/labels.
 * Browser keeps Free Trial / Subscribe acquisition; native apps do not solicit purchase.
 */

import { APP_SIGN_IN_PATH } from "@/lib/app-sign-in/app-sign-in-constants";
import { APP_MEMBERSHIP_PATH } from "@/lib/native-app/membership-paths";

const BROWSER_SIGN_IN_SUBSCRIBE = `/sign-in?redirect_url=${encodeURIComponent("/subscribe")}`;

export function marketingAcquisitionHref(options: {
  isNativeApp: boolean;
  isSignedIn: boolean;
}): string {
  if (options.isNativeApp) {
    return options.isSignedIn ? APP_MEMBERSHIP_PATH : APP_SIGN_IN_PATH;
  }
  return options.isSignedIn ? "/subscribe" : BROWSER_SIGN_IN_SUBSCRIBE;
}

export function marketingTrialCtaLabel(isNativeApp: boolean): string {
  return isNativeApp ? "Sign in" : "Start 7-Day Free Trial";
}

export function marketingTrialCtaLabelLong(isNativeApp: boolean): string {
  return isNativeApp ? "Sign in" : "Start Your 7-Day Free Trial";
}

export function marketingSubscribeCtaLabel(isNativeApp: boolean): string {
  return isNativeApp ? "Continue" : "Start Membership →";
}

export function shouldShowMarketingPricingCopy(isNativeApp: boolean): boolean {
  return !isNativeApp;
}
