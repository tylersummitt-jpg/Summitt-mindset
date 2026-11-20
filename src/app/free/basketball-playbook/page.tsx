import type { Metadata } from "next";

import { FreeResourcePage } from "@/components/free-resource-page";
import {
  BASKETBALL_PLAYBOOK_PAGE,
  campaignTokenFromSearch,
  FREE_PDF_SITE,
  freePdfTrialHref,
} from "@/lib/free-pdf";

export const metadata: Metadata = {
  title: "Free Basketball Playbook",
  description: BASKETBALL_PLAYBOOK_PAGE.description,
  alternates: { canonical: `${FREE_PDF_SITE}${BASKETBALL_PLAYBOOK_PAGE.path}` },
  robots: { index: false, follow: false },
};

export default async function BasketballPlaybookPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const trialHref = freePdfTrialHref(campaignTokenFromSearch(sp.ac));

  return <FreeResourcePage page={BASKETBALL_PLAYBOOK_PAGE} trialHref={trialHref} />;
}
