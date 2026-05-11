import type { ReactElement, ReactNode } from "react";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";

export const dynamic = "force-dynamic";

/**
 * Coach-only completion screen — gated server-side.
 */
export default async function CoachCompleteLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactElement> {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in?redirect_url=/coach/complete");
  }

  const md = user.publicMetadata as Record<string, unknown> | undefined;

  if (md?.acquisitionSource !== "coach") {
    redirect("/post-sign-in");
  }

  if (!isSubscribedFromPublicMetadata(md)) {
    redirect("/subscribe?src=coach");
  }

  if (md?.onboardingCompleted !== true) {
    redirect("/onboarding");
  }

  return <>{children}</>;
}
