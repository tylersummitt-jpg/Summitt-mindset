import type { Metadata } from "next";

import { FreeResourcePage } from "@/components/free-resource-page";
import {
  campaignTokenFromSearch,
  DEFINITE_DOZEN_PAGE,
  FREE_PDF_SITE,
  freePdfTrialHref,
} from "@/lib/free-pdf";

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
  const trialHref = freePdfTrialHref(campaignTokenFromSearch(sp.ac));

  return <FreeResourcePage page={DEFINITE_DOZEN_PAGE} trialHref={trialHref} />;
}
