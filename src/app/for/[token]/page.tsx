import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { acquisitionCheckoutPath, acquisitionJourneyTokenShape } from "@/lib/acquisition/email-acquired-member-notice";
import { PersonalVideoPlayer, PersonalVideoTrialLink } from "@/components/personal-video-engagement";
import { recordAcquisitionVideoEvent, resolveAcquisitionRecipient } from "@/lib/acquisition/store";
import { isTylerAdminSession } from "@/lib/auth/require-tyler-admin";
import { buildVimeoPlayerEmbedUrl } from "@/lib/vimeo-player-embed";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";
import { isNativeSummittMindsetAppRequest } from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { marketingAcquisitionHref } from "@/lib/native-app/native-safe-marketing-cta";
import { getPersonalVideoByToken } from "@/lib/personal-videos/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "A Personal Message From Tyler Summitt",
  robots: { index: false, follow: false },
};

export default async function PersonalVideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = searchParams ? await searchParams : {};
  const journeyToken = acquisitionJourneyTokenShape(Array.isArray(sp.aj) ? sp.aj[0] : sp.aj);
  const found = await getPersonalVideoByToken(token).catch(() => undefined);
  if (found === undefined) {
    return (
      <main className="mx-auto min-h-screen max-w-xl bg-stone-950 px-6 py-16 text-stone-100">
        <p>This page is unavailable right now.</p>
      </main>
    );
  }
  let video = found;
  let recipientToken: string | null = null;
  if (!video) {
    const recipient = await resolveAcquisitionRecipient(token).catch(() => undefined);
    if (recipient === undefined) {
      return (
        <main className="mx-auto min-h-screen max-w-xl bg-stone-950 px-6 py-16 text-stone-100">
          <p>This page is unavailable right now.</p>
        </main>
      );
    }
    if (!recipient) notFound();
    if (
      recipient.status !== "uploading" &&
      recipient.status !== "processing" &&
      recipient.status !== "ready" &&
      recipient.status !== "failed"
    ) {
      notFound();
    }
    recipientToken = token;
    video = {
      id: recipient.personalVideoId,
      publicToken: token,
      vimeoVideoId: recipient.vimeoVideoId,
      status: recipient.status,
      createdAt: "",
      linkSentAt: null,
      watchPath: recipient.status === "ready" ? `/for/${token}` : null,
    };
  }
  if (!video) notFound();
  const native = await isNativeSummittMindsetAppRequest();
  const track = !native && !(await isTylerAdminSession());
  const trialHref = native
    ? marketingAcquisitionHref({ isNativeApp: true, isSignedIn: false })
    : journeyToken
      ? acquisitionCheckoutPath(journeyToken)
      : "/checkout/start";
  const playerSrc = video.status === "ready" ? buildVimeoPlayerEmbedUrl(video.vimeoVideoId) : null;
  if (recipientToken && track && playerSrc) {
    await recordAcquisitionVideoEvent({
      token: recipientToken,
      eventType: "personal_video_visited",
    }).catch(() => undefined);
  }

  return (
    <main className="min-h-screen bg-stone-950 text-stone-50">
      <div className="mx-auto max-w-xl px-5 py-10 sm:py-16">
        <p className="text-xs uppercase tracking-[0.2em] text-stone-400">Summitt Mindset</p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight">A Personal Message From Tyler Summitt</h1>
        {playerSrc ? (
          <PersonalVideoPlayer
            playerSrc={playerSrc}
            personalVideoId={video.id}
            recipientToken={recipientToken}
            track={track}
          />
        ) : (
          <p className="mt-8 text-stone-300">This video is not ready yet.</p>
        )}
        {playerSrc ? (
          <div className="mt-6">
            <PersonalVideoTrialLink
              href={trialHref}
              personalVideoId={video.id}
              recipientToken={recipientToken}
              track={track && !native}
              className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-center text-base font-semibold !text-[#111827] shadow-md shadow-orange-500/20 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 md:px-8"
            >
              {native ? "Sign in" : "Start My 7-Day Free Trial"}
            </PersonalVideoTrialLink>
            {native ? null : (
              <p className="mt-4 text-sm leading-6 text-stone-300">
                {MEMBERSHIP_PUBLIC_OFFER.dueToday}. {MEMBERSHIP_PUBLIC_OFFER.trial}, then{" "}
                {MEMBERSHIP_PUBLIC_OFFER.monthly} or {MEMBERSHIP_PUBLIC_OFFER.annual}.{" "}
                {MEMBERSHIP_PUBLIC_OFFER.cancel}.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </main>
  );
}
