import type { Metadata } from "next";

import { PartnerLandingPage } from "@/components/partner-landing-page";
import { partnerAnnualCheckoutReady } from "@/lib/partner-annual-price.server";
import { parsePartnerChannel, partnerLandingByPath } from "@/lib/partner-landing";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Orange Mountain Designs | Summitt Mindset",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function readSearch(searchParams?: SearchParams) {
  if (!searchParams) return {};
  return await searchParams;
}

export default async function OrangeMountainDesignsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const sp = await readSearch(searchParams);
  const rawChannel = Array.isArray(sp.channel) ? sp.channel[0] : sp.channel;
  const checkoutReady = await partnerAnnualCheckoutReady();
  return (
    <PartnerLandingPage
      partner={partnerLandingByPath("/orange-mountain-designs")}
      channel={parsePartnerChannel(rawChannel)}
      checkoutReady={checkoutReady}
    />
  );
}
