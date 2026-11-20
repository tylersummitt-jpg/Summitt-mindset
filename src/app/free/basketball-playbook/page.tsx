import type { Metadata } from "next";
import { currentUser } from "@clerk/nextjs/server";

import { CoachLeadershipKitMarketing } from "@/app/coach-leadership-kit/page";
import { FreeResourcePage } from "@/components/free-resource-page";
import {
  BASKETBALL_PLAYBOOK_PAGE,
  campaignTokenFromSearch,
  FREE_PDF_SITE,
  freePdfCoachKitHref,
} from "@/lib/free-pdf";

export const metadata: Metadata = {
  title: "Free Pat Summitt Playbook",
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
  const user = await currentUser();
  const download = BASKETBALL_PLAYBOOK_PAGE.downloads[0];
  if (!download) throw new Error("Missing basketball playbook download");

  return (
    <div>
      <FreeResourcePage
        title="Free Pat Summitt Playbook"
        download={{
          href: download.href,
          filename: download.filename,
          actionLabel: download.actionLabel,
        }}
      />
      <CoachLeadershipKitMarketing
        leadershipKitHref={freePdfCoachKitHref(Boolean(user), campaignTokenFromSearch(sp.ac))}
      />
    </div>
  );
}
