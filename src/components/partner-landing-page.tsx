import Image from "next/image";

import { HomepageHowItWorksSteps } from "@/components/homepage-how-it-works-steps";
import { HomepageMemberTestimonials } from "@/components/homepage-member-testimonials";
import { HomepageSmsExample } from "@/components/homepage-sms-example";
import { HomepageVictoryRoom } from "@/components/homepage-victory-room";
import { PartnerOfferCta } from "@/components/partner-offer-cta";
import { buildVimeoPlayerEmbedUrl } from "@/lib/vimeo-player-embed";
import {
  partnerCheckoutHref,
  type PartnerChannel,
  type PartnerLanding,
} from "@/lib/partner-landing";

export function PartnerLandingPage({
  partner,
  channel,
  checkoutReady,
}: {
  partner: PartnerLanding;
  channel: PartnerChannel;
  checkoutReady: boolean;
}) {
  const slug = partner.path.slice(1);
  const checkoutHref = checkoutReady ? partnerCheckoutHref(partner.key, channel) : null;
  const playerSrc = buildVimeoPlayerEmbedUrl(partner.vimeoVideoId);
  const offer =
    "Get a FREE signed book plus daily coaching texts from Coach Pat for just $179/year.";

  return (
    <div>
      <section className="overflow-hidden border-b border-[var(--border)] bg-neutral-950">
        <div className="grid w-full min-w-0 md:grid-cols-2 md:items-stretch">
          <div className="relative z-10 flex min-w-0 items-center px-4 pb-6 pt-8 sm:px-6 sm:pt-10 md:py-12 md:pl-[max(1.5rem,calc((100vw-72rem)/2+2.5rem))] md:pr-10 lg:py-14 lg:pr-14">
            <div className="flex w-full max-w-xl min-w-0 flex-col gap-5 break-words">
              <Image
                src={partner.logoSrc}
                alt={partner.name}
                width={640}
                height={480}
                priority
                className="h-20 w-auto max-w-[11rem] rounded-2xl bg-white object-contain shadow-md shadow-black/30 sm:h-24 sm:max-w-[13rem]"
              />
              <div>
                <h1 className="max-w-xl text-[1.65rem] font-black leading-[1.15] tracking-tight text-white drop-shadow-sm min-[390px]:text-[1.85rem] sm:text-4xl md:text-5xl md:leading-[1.05]">
                  <span className="block">50% Off for the</span>
                  <span className="mt-1 block text-[var(--brand)] md:mt-1.5">
                    {partner.headlineAccent}
                  </span>
                </h1>
                <p className="mt-3 max-w-xl text-lg font-medium leading-relaxed text-white/90 drop-shadow-sm md:mt-4 md:text-xl">
                  {offer}
                </p>
              </div>
              <PartnerOfferCta noteId={`${slug}-hero-checkout-note`} href={checkoutHref} />
              <p className="max-w-md text-lg font-bold leading-relaxed tracking-tight text-white drop-shadow-sm">
                7 days free · Then $179/year · Cancel anytime
              </p>
            </div>
          </div>
          <div className="relative aspect-[4/3] w-full sm:aspect-[5/4] md:aspect-auto md:min-h-[520px] lg:min-h-[600px]">
            <Image
              src="/brand/pat-summitt-homepage-hero.jpg"
              alt="Coach Pat Summitt coaching from the sideline in an orange suit"
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover object-[center_16%] sm:object-[center_20%] md:object-[center_28%]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-neutral-950 to-transparent md:inset-y-0 md:left-0 md:h-full md:w-24 md:bg-gradient-to-r"
            />
          </div>
        </div>
      </section>

      <section
        aria-labelledby={`${slug}-video-heading`}
        className="border-b border-[var(--border)] bg-white px-4 py-12 sm:px-6 sm:py-16"
      >
        <div className="mx-auto min-w-0 max-w-3xl break-words">
          <h2
            id={`${slug}-video-heading`}
            className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl"
          >
            {partner.videoHeading}
          </h2>
          <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-3xl border border-slate-200 bg-neutral-950">
            {playerSrc ? (
              <iframe
                title={partner.videoHeading}
                src={playerSrc}
                className="absolute inset-0 h-full w-full"
                allow="fullscreen; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <p className="flex h-full items-center justify-center px-6 text-center text-lg font-medium leading-relaxed text-stone-300">
                Tyler&apos;s video will be added here.
              </p>
            )}
          </div>
        </div>
      </section>

      <HomepageSmsExample />
      <HomepageHowItWorksSteps />
      <HomepageVictoryRoom />
      <HomepageMemberTestimonials />

      <section className="border-b border-gray-100 bg-white px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-5xl min-w-0 break-words grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="min-w-0">
            <Image
              src="/brand/pat_statue_grandkids_candidate_sharp.jpg"
              alt="Pat Summitt statue with her grandkids"
              width={2200}
              height={1650}
              sizes="(max-width: 1024px) 100vw, 50vw"
              unoptimized
              className="h-auto w-full max-w-full rounded-3xl border border-gray-200/80 bg-slate-50 shadow-lg shadow-gray-900/10"
            />
            <p className="mt-3 text-lg font-medium text-slate-800">
              Pat Summitt&apos;s grandkids
            </p>
          </div>
          <div className="min-w-0 text-left">
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
              Inspired by Pat Summitt. Made for Your Life.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-800 sm:text-xl">
              Created by Pat Summitt&apos;s family, Summitt Mindset brings her coaching principles into everyday life — helping people set goals, keep moving forward, and remember the moments that matter.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-neutral-950 px-4 py-12 text-white sm:px-6 sm:py-16">
        <div className="mx-auto flex w-full min-w-0 max-w-3xl break-words flex-col">
          <h2 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Your Next Chapter Starts Today.
          </h2>
          <div className="mt-6 space-y-3">
            <p className="text-5xl font-black leading-none tracking-tight">$179/year</p>
            <p className="text-lg leading-relaxed text-white sm:text-xl">
              Your exclusive partner rate renews at $179/year.
            </p>
            <p className="text-lg leading-relaxed text-white sm:text-xl">
              Includes a FREE signed book.
            </p>
            <p className="text-lg font-semibold leading-relaxed text-white sm:text-xl">
              Cancel anytime.
            </p>
          </div>
          <div className="mt-8">
            <PartnerOfferCta noteId={`${slug}-final-checkout-note`} href={checkoutHref} />
          </div>
        </div>
      </section>
    </div>
  );
}
