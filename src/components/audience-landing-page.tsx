import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { ChallengerLandingPage } from "@/components/challenger-landing-page";
import {
  AUDIENCE_LANDING_SITE,
  audienceLandingPage,
  type AudienceLandingId,
} from "@/lib/audience-landing-pages";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import {
  marketingAcquisitionHref,
  marketingSubscribeCtaLabel,
  marketingTrialCtaLabel,
  shouldShowMarketingPricingCopy,
} from "@/lib/native-app/native-safe-marketing-cta";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

export function audienceLandingMetadata(id: AudienceLandingId): Metadata {
  const page = audienceLandingPage(id);
  const url = `${AUDIENCE_LANDING_SITE}${page.path}`;
  return {
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: "Summitt Mindset",
      title: page.title,
      description: page.description,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
    },
  };
}

export async function AudienceLandingRoute({ id }: { id: AudienceLandingId }) {
  const user = await currentUser();
  if (user && isSubscribedFromPublicMetadata(user.publicMetadata)) {
    redirect("/post-sign-in");
  }
  const isNativeApp = await isNativeSummittMindsetAppRequest();
  const isSignedIn = Boolean(user);
  const href = marketingAcquisitionHref({ isNativeApp, isSignedIn });
  const primaryLabel = isNativeApp
    ? isSignedIn
      ? marketingSubscribeCtaLabel(true)
      : marketingTrialCtaLabel(true)
    : "Put Coach Pat in My Corner";
  const bonusLabel = isNativeApp ? primaryLabel : "Get Everything — Start Free";

  return (
    <ChallengerLandingPage
      href={href}
      surface={audienceLandingPage(id).ctaSurface}
      primaryLabel={primaryLabel}
      bonusLabel={bonusLabel}
      showPrice={shouldShowMarketingPricingCopy(isNativeApp)}
      offer={MEMBERSHIP_PUBLIC_OFFER}
    />
  );
}
