import type { Metadata } from "next";

import { HomepageMarketing } from "@/app/page";
import { FreeResourcePage } from "@/components/free-resource-page";
import { DEFINITE_DOZEN_PAGE, campaignTokenFromSearch, FREE_PDF_SITE, freePdfCheckoutHref } from "@/lib/free-pdf";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import {
  marketingAcquisitionHref,
  marketingTrialCtaLabel,
  shouldShowMarketingPricingCopy,
} from "@/lib/native-app/native-safe-marketing-cta";

export const metadata: Metadata = {
  title: "Free Definite Dozen Discussion Guide",
  description: DEFINITE_DOZEN_PAGE.description,
  alternates: { canonical: `${FREE_PDF_SITE}${DEFINITE_DOZEN_PAGE.path}` },
  robots: { index: false, follow: false },
};

export default async function DefiniteDozenPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const campaignToken = campaignTokenFromSearch(sp.ac);
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  const trialHref = freePdfCheckoutHref(
    marketingAcquisitionHref({ isNativeApp, isSignedIn: false }),
    campaignToken
  );
  const download = DEFINITE_DOZEN_PAGE.downloads[0];
  if (!download) throw new Error("Missing Definite Dozen download");

  return (
    <div>
      <FreeResourcePage
        title="Free Definite Dozen Discussion Guide"
        download={{
          href: download.href,
          filename: download.filename,
          actionLabel: download.actionLabel,
        }}
      />
      <HomepageMarketing
        user={null}
        showContinue={false}
        showResumeOnboarding={false}
        showSubscribe={false}
        signInSubscribeHref={trialHref}
        subscribeCtaHref={trialHref}
        subscribeCtaLabel="Start Membership →"
        trialCtaLabel={marketingTrialCtaLabel(isNativeApp)}
        showPricingCopy={shouldShowMarketingPricingCopy(isNativeApp)}
        isNativeApp={isNativeApp}
        finalHref={trialHref}
        finalLabel={isNativeApp ? marketingTrialCtaLabel(isNativeApp) : "Start My Free Trial"}
        annualHref={freePdfCheckoutHref("/checkout/start?plan=annual", campaignToken)}
      />
    </div>
  );
}
