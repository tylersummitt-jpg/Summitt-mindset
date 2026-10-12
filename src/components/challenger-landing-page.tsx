import Image from "next/image";
import Link from "next/link";

import { MEMBER_TESTIMONIALS } from "@/components/homepage-member-testimonials";
import { VrIconGoal, VrIconStar } from "@/components/VictoryRoomIcons";
import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";

const HERO_LEAD = "Build a Life You're Proud Of.";
const HERO_SECOND = "Remember How You Got There.";
const HERO_SUPPORT =
  "Get personal daily texts from Coach Pat to help you reach your goals, recognize how far you've come, and remember the moments that matter.";
const PRIMARY_CTA = "Put Coach Pat in My Corner";
const BONUS_CTA = "Get Everything — Start Free";
const BONUS_HEADING = "And There's Even More Included.";

const LINDA_MESSAGES = [
  {
    speaker: "Coach Pat",
    text: "Linda, you told me you wanted to make more time for your family. How's that going?",
  },
  {
    speaker: "Linda",
    text: "Better! I've started putting my phone away when we're together.",
  },
  {
    speaker: "Coach Pat",
    text: "That's a win! Have you noticed a difference?",
  },
  {
    speaker: "Linda",
    text: "Yes! Yesterday my grandson and I spent the whole afternoon playing cards. He told me it was his favorite day.",
  },
  {
    speaker: "Coach Pat",
    text: "I'll make sure we remember that afternoon, Linda. Let's keep making time for what matters most.",
  },
] as const;

const GOAL_WIN = {
  type: "Goal Win",
  date: "September 18",
  title: "Walked Four Days This Week!",
  body: "I promised myself I'd get moving again. This week, I followed through. Four walks, and I'm feeling stronger already.",
} as const;

const PROUD_MOMENT = {
  type: "Proud Moment",
  date: "September 28",
  title: "An Afternoon at the Park",
  body: "My grandson and I spent the afternoon playing and laughing at the park. A few months ago, I would not have had the energy. Today, I did. I want to remember that.",
} as const;

/** Still frames from real Film Room lessons. */
const FILM_LESSONS = [
  {
    speaker: "Peyton Manning",
    title: "No Shortcuts to Success",
    image: "/brand/film-room-peyton-manning.jpg",
    alt: "Peyton Manning in the Film Room lesson No Shortcuts to Success",
  },
  {
    speaker: "Morgan Vance",
    title: "Personal Brand: What's Yours?",
    image: "/brand/film-room-morgan-vance.jpg",
    alt: "Morgan Vance in the Film Room lesson Personal Brand: What's Yours?",
  },
  {
    speaker: "Phillip Fulmer",
    title: "Set High Goals",
    image: "/brand/film-room-phillip-fulmer.jpg",
    alt: "Phillip Fulmer in the Film Room lesson Set High Goals",
  },
  {
    speaker: "Pat Summitt",
    title: "Invest in Yourself",
    image: "/brand/film-room-pat-summitt-invest.jpg",
    alt: "Pat Summitt in the Film Room lesson Invest in Yourself",
  },
] as const;

const TESTIMONIAL_IDS = ["kathy", "jackie", "jordan"] as const;

type ChallengerLandingPageProps = {
  href: string;
  surface: string;
  primaryLabel: string;
  bonusLabel: string;
  showPrice: boolean;
  offer: typeof MEMBERSHIP_PUBLIC_OFFER;
};

function TrialLink({
  href,
  label,
  surface,
  onDark,
}: {
  href: string;
  label: string;
  surface: string;
  onDark: boolean;
}) {
  return (
    <Link
      href={href}
      data-growth-cta="trial"
      data-growth-surface={surface}
      className={`inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#f97316] px-4 py-3 text-center text-base font-bold leading-snug !text-[#111827] shadow-md shadow-black/20 hover:bg-[#fb923c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fdba74] focus-visible:ring-offset-2 min-[390px]:px-6 min-[390px]:text-lg sm:w-auto sm:min-w-[20rem] sm:px-8 sm:text-xl ${
        onDark ? "focus-visible:ring-offset-[#071422]" : "focus-visible:ring-offset-[#f6f1e7]"
      }`}
    >
      {label}
    </Link>
  );
}

function OfferLines({
  offer,
  showPrice,
  tone,
}: {
  offer: typeof MEMBERSHIP_PUBLIC_OFFER;
  showPrice: boolean;
  tone: "light" | "dark";
}) {
  const text = tone === "light" ? "text-white" : "text-[#14110d]";
  if (!showPrice) {
    return (
      <p className={`text-lg font-semibold leading-relaxed sm:text-xl ${text}`}>
        Membership is managed on the Summitt Mindset website.
      </p>
    );
  }
  return (
    <div className={`space-y-1 text-lg font-semibold leading-relaxed sm:text-xl ${text}`}>
      <p>
        7 days free · $0 today · Then {offer.monthly}
      </p>
      <p>{offer.cancel}.</p>
    </div>
  );
}

export function ChallengerLandingPage({
  href,
  surface,
  primaryLabel,
  bonusLabel,
  showPrice,
  offer,
}: ChallengerLandingPageProps) {
  const testimonials = TESTIMONIAL_IDS.map((id) => {
    const quote = MEMBER_TESTIMONIALS.find((item) => item.id === id);
    if (!quote) throw new Error(`Missing testimonial ${id}`);
    return quote;
  });

  return (
    <article data-audience={surface} className="min-w-0 overflow-x-clip bg-[#f6f1e7] text-[#14110d]">
      <header data-exp-section="proud_hero" className="bg-[#071422] text-white">
        <div className="mx-auto grid max-w-6xl min-w-0 gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-12 lg:py-16 [@media(max-height:500px)]:py-4">
          <div className="min-w-0">
            <h1 className="font-serif text-[1.85rem] font-semibold leading-[1.12] tracking-tight text-white min-[390px]:text-4xl sm:text-5xl sm:leading-[1.1] [@media(max-height:500px)]:text-[1.85rem] [@media(max-height:500px)]:leading-tight sm:[@media(max-height:500px)]:text-[1.85rem]">
              <span className="block">{HERO_LEAD}</span>
              <span className="mt-1 block text-[#f3d48a] min-[390px]:mt-2 [@media(max-height:500px)]:mt-1">{HERO_SECOND}</span>
            </h1>
            <p className="mt-3 max-w-xl text-lg leading-snug text-white min-[390px]:mt-5 min-[390px]:leading-relaxed sm:text-xl [@media(max-height:500px)]:mt-3">
              {HERO_SUPPORT}
            </p>
            <div className="mt-5 min-[390px]:mt-7 [@media(max-height:500px)]:mt-4">
              <TrialLink href={href} label={primaryLabel} surface="proud_hero_cta" onDark />
            </div>
            <div className="mt-3 min-[390px]:mt-4">
              <OfferLines offer={offer} showPrice={showPrice} tone="light" />
            </div>
          </div>
          <figure className="min-w-0">
            <div className="relative aspect-[3/2] w-full overflow-hidden rounded-3xl border border-[#e8c872]/40 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.85)]">
              <Image
                src="/brand/pat-summitt-challenger-hero.jpg"
                alt="Pat Summitt standing behind eight national championship trophies"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 54vw"
                className="object-cover object-[center_42%]"
              />
            </div>
          </figure>
        </div>
      </header>

      <section data-exp-section="proud_coaching" className="px-4 py-10 sm:px-6 sm:py-14" aria-labelledby="corner-heading">
        <div className="mx-auto min-w-0 max-w-3xl">
          <h2
            id="corner-heading"
            className="font-serif text-3xl font-semibold leading-tight tracking-tight text-[#14110d] sm:text-5xl"
          >
            Imagine Having Someone in Your Corner Every Day.
          </h2>
          <div className="mt-5 space-y-4 text-lg leading-relaxed text-[#241c14] sm:text-xl">
            <p>
              Someone who checks in. Someone who remembers what you&apos;ve shared. Someone who
              encourages you when things get hard and celebrates when you make progress.
            </p>
            <p className="font-semibold text-[#14110d]">That&apos;s what Coach Pat is here for.</p>
          </div>
        </div>
      </section>

      <section
        data-exp-section="proud_demo"
        className="border-y border-[#e6dcc8] bg-white px-4 py-12 sm:px-6 sm:py-16"
        aria-labelledby="linda-heading"
      >
        <div className="mx-auto min-w-0 max-w-3xl">
          <h2
            id="linda-heading"
            className="font-serif text-3xl font-semibold leading-tight tracking-tight text-[#14110d] sm:text-5xl"
          >
            The More You Share, the More Personal It Gets.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-[#241c14] sm:text-xl">
            Coach Pat helps you work toward your goals and appreciate the moments that make life
            special.
          </p>
          <div className="mt-8 min-w-0 md:rounded-[2rem] md:border md:border-[#d9d3c7] md:bg-[#F3F4F6] md:px-6 md:py-6">
            <ol
              className="space-y-3"
              aria-label="Example text messages between Coach Pat and Linda"
            >
              {LINDA_MESSAGES.map((message) => {
                const fromCoach = message.speaker === "Coach Pat";
                return (
                  <li
                    key={`${message.speaker}-${message.text}`}
                    className={fromCoach ? "flex justify-start" : "flex justify-end"}
                  >
                    <div
                      className={`min-w-0 max-w-[96%] break-words rounded-2xl px-4 py-3 ${
                        fromCoach ? "bg-[#E9E9EB] text-[#111827]" : "bg-[#0E6B32] text-white"
                      }`}
                    >
                      <p className="text-lg font-bold leading-relaxed">{message.speaker}</p>
                      <p className="mt-1 text-lg leading-relaxed sm:text-xl">{message.text}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="mt-8 sm:mt-10">
            <TrialLink href={href} label={primaryLabel} surface={surface} onDark={false} />
          </div>
        </div>
      </section>

      <section data-exp-section="proud_benefits" className="px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="outcomes-heading">
        <div className="mx-auto min-w-0 max-w-6xl">
          <h2
            id="outcomes-heading"
            className="max-w-3xl font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            Chase What Matters. Hold On to What Matters.
          </h2>
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <article className="min-w-0 rounded-3xl border border-[#e6dcc8] bg-white p-6 sm:p-8">
              <VrIconGoal className="h-10 w-10 text-[#9a6b12]" />
              <h3 className="mt-4 font-serif text-3xl font-semibold leading-tight">
                Reach Your Goals
              </h3>
              <p className="mt-3 text-lg leading-relaxed text-[#241c14] sm:text-xl">
                Coach Pat helps you follow through on the things you want to accomplish.
              </p>
            </article>
            <article className="min-w-0 rounded-3xl border border-[#e6dcc8] bg-white p-6 sm:p-8">
              <VrIconStar className="h-10 w-10 text-[#9a6b12]" />
              <h3 className="mt-4 font-serif text-3xl font-semibold leading-tight">
                Remember Your Life
              </h3>
              <p className="mt-3 text-lg leading-relaxed text-[#241c14] sm:text-xl">
                Save your victories and the special moments you want to remember.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section data-exp-section="proud_victory" className="bg-[#071422] px-4 py-12 text-white sm:px-6 sm:py-16" aria-labelledby="victory-heading">
        <div className="mx-auto min-w-0 max-w-6xl">
          <h2
            id="victory-heading"
            className="max-w-3xl font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            Imagine Looking Back a Year From Now.
          </h2>
          <div className="mt-5 max-w-3xl space-y-4 text-lg leading-relaxed text-stone-100 sm:text-xl">
            <p>The goals you reached. The challenges you overcame. The moments you never want to forget.</p>
            <p>Your Victory Room gives you a place to save those memories and see how far you&apos;ve come.</p>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <article className="min-w-0 rounded-2xl border border-[#e8c872]/40 bg-[#0c1a2e] p-6 sm:p-7">
              <p className="flex items-center gap-2 text-lg font-semibold text-[#f3d48a]">
                <VrIconGoal className="h-7 w-7 shrink-0 text-[#f3d48a]" />
                {GOAL_WIN.type}
              </p>
              <p className="mt-3 text-lg text-stone-300">{GOAL_WIN.date}</p>
              <h3 className="mt-2 font-serif text-3xl font-semibold leading-tight text-stone-50">
                {GOAL_WIN.title}
              </h3>
              <p className="mt-3 text-lg leading-relaxed text-stone-100 sm:text-xl">{GOAL_WIN.body}</p>
            </article>
            <article className="min-w-0 rounded-2xl border border-[#e8c872]/40 bg-[#0c1a2e] p-6 sm:p-7">
              <p className="flex items-center gap-2 text-lg font-semibold text-[#f3d48a]">
                <VrIconStar className="h-7 w-7 shrink-0 text-[#f3d48a]" />
                {PROUD_MOMENT.type}
              </p>
              <p className="mt-3 text-lg text-stone-300">{PROUD_MOMENT.date}</p>
              <h3 className="mt-2 font-serif text-3xl font-semibold leading-tight text-stone-50">
                {PROUD_MOMENT.title}
              </h3>
              <p className="mt-3 text-lg leading-relaxed text-stone-100 sm:text-xl">{PROUD_MOMENT.body}</p>
            </article>
          </div>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-stone-100 sm:text-xl">
            A year of saved moments becomes a history of the life you are building.
          </p>
        </div>
      </section>

      <section data-exp-section="proud_film" className="px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="bonus-heading">
        <div className="mx-auto min-w-0 max-w-6xl">
          <h2
            id="bonus-heading"
            className="max-w-3xl font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            {BONUS_HEADING}
          </h2>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[#241c14] sm:text-xl">
            Your Summitt Mindset membership also includes access to these additional benefits.
          </p>

          <div className="mt-10 grid items-center gap-6 lg:grid-cols-2 lg:gap-10">
            <div className="min-w-0">
              <h3 className="font-serif text-3xl font-semibold leading-tight sm:text-4xl">Ask Pat</h3>
              <p className="mt-4 text-lg leading-relaxed text-[#241c14] sm:text-xl">
                Ask Coach Pat questions whenever you want encouragement, advice, or help thinking
                something through.
              </p>
            </div>
            <div className="relative aspect-video min-w-0 overflow-hidden rounded-3xl border border-[#e6dcc8]">
              <Image
                src="/brand/ask-pat-preview-desktop.jpeg"
                alt="Coach Pat Summitt with her arm around a player"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover object-[72%_center]"
              />
            </div>
          </div>

          <div className="mt-14 min-w-0">
            <h3 className="font-serif text-3xl font-semibold leading-tight sm:text-4xl">Film Room</h3>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[#241c14] sm:text-xl">
              Watch lessons on leadership, teamwork, and life from Pat Summitt and other inspiring
              voices.
            </p>
            <p className="mt-4 text-lg font-semibold leading-relaxed text-[#14110d] sm:text-xl">
              Film Room Videos
            </p>
            <ul className="mt-6 grid gap-5 sm:grid-cols-2">
              {FILM_LESSONS.map((lesson) => (
                <li
                  key={lesson.title}
                  className="min-w-0 overflow-hidden rounded-3xl border border-[#e8c872]/70 bg-white shadow-[0_16px_40px_-28px_rgba(7,20,34,0.7)]"
                >
                  <div className="relative aspect-video bg-[#071422]">
                    <Image
                      src={lesson.image}
                      alt={lesson.alt}
                      fill
                      sizes="(max-width: 640px) 100vw, 50vw"
                      className="object-cover object-center"
                    />
                  </div>
                  <div className="border-t border-[#e8c872]/50 p-5 sm:p-6">
                    <p className="text-lg font-semibold text-[#6b5424]">{lesson.speaker}</p>
                    <h4 className="mt-2 font-serif text-2xl font-semibold leading-tight text-[#14110d]">
                      {lesson.title}
                    </h4>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-14 rounded-3xl bg-[#071422] px-6 py-10 text-white sm:px-10 sm:py-14">
            <p className="text-base font-bold tracking-[0.16em] text-[#f3d48a] sm:text-lg">
              ALSO INCLUDED WITH MEMBERSHIP
            </p>
            <h3 className="mt-4 max-w-4xl font-serif text-3xl font-semibold leading-tight text-[#f3d48a] sm:text-5xl">
              Over $1,000 in Previously Sold Online Programs.
            </h3>
            <p className="mt-5 max-w-3xl text-xl leading-relaxed text-white sm:text-2xl">
              Online leadership programs previously sold for $299+ each.
            </p>
            <p className="mt-4 text-lg font-semibold leading-relaxed text-stone-100 sm:text-xl">
              Included with your active Summitt Mindset membership.
            </p>
          </div>

          <div className="mt-10 rounded-3xl bg-[#071422] px-6 py-8 text-white sm:px-8 sm:py-10">
            <p className="text-lg font-semibold leading-relaxed text-[#f3d48a] sm:text-xl">
              Included with your Summitt Mindset membership.
            </p>
            <div className="mt-5">
              <TrialLink href={href} label={bonusLabel} surface="proud_middle_cta" onDark />
            </div>
          </div>
        </div>
      </section>

      <section
        data-exp-section="proud_proof"
        className="border-y border-[#e6dcc8] bg-white px-4 py-12 sm:px-6 sm:py-16"
        aria-labelledby="feedback-heading"
      >
        <div className="mx-auto min-w-0 max-w-6xl">
          <h2
            id="feedback-heading"
            className="max-w-3xl font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
          >
            Sometimes All You Need Is Someone in Your Corner.
          </h2>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {testimonials.map((testimonial) => (
              <figure
                key={testimonial.id}
                className="min-w-0 rounded-3xl border border-[#e6dcc8] bg-[#f6f1e7] p-6 sm:p-7"
              >
                <blockquote>
                  <p className="text-lg font-semibold leading-relaxed text-[#14110d] sm:text-xl">
                    {testimonial.quote}
                  </p>
                </blockquote>
                <figcaption className="mt-5 text-lg text-[#14110d]">
                  <span className="font-bold">{testimonial.name}</span>
                  <span className="font-medium text-[#3f3428]"> · {testimonial.detail}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section data-exp-section="proud_legacy" className="bg-[#071422] px-4 py-12 text-white sm:px-6 sm:py-16" aria-labelledby="legacy-heading">
        <div className="mx-auto grid max-w-6xl min-w-0 items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <figure className="min-w-0">
            <div className="relative aspect-[3/2] w-full overflow-hidden rounded-3xl border border-white/10">
              <Image
                src="/brand/pat-bench.jpeg"
                alt="Coach Pat Summitt standing with her team on the sideline"
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover object-center"
              />
            </div>
          </figure>
          <div className="min-w-0">
            <h2
              id="legacy-heading"
              className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-5xl"
            >
              She Believed in People. Her Legacy Lives On.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-stone-100 sm:text-xl">
              Pat Summitt believed in helping people become their best. Her family created Summitt
              Mindset to bring those coaching values into everyday life.
            </p>
          </div>
        </div>
      </section>

      <section data-exp-section="proud_offer" className="px-4 py-14 sm:px-6 sm:py-20" aria-labelledby="invitation-heading">
        <div className="mx-auto min-w-0 max-w-3xl text-left">
          <h2
            id="invitation-heading"
            className="font-serif text-4xl font-semibold leading-tight tracking-tight text-[#14110d] sm:text-6xl"
          >
            Your Story Is Still Being Written.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-[#241c14] sm:text-xl">
            There are goals worth reaching, people worth showing up for, and moments worth
            remembering.
          </p>
          {showPrice ? (
            <div className="mt-8 space-y-2 text-2xl font-semibold leading-snug text-[#14110d] sm:text-3xl">
              <p>Start with 7 days free.</p>
              <p>$0 today.</p>
              <p>
                Then {offer.monthly}, or choose {offer.annual}.
              </p>
              <p>{offer.cancel}.</p>
            </div>
          ) : (
            <p className="mt-8 text-xl font-semibold leading-relaxed text-[#14110d] sm:text-2xl">
              Membership is managed on the Summitt Mindset website.
            </p>
          )}
          <div className="mt-8">
            <TrialLink href={href} label={primaryLabel} surface="proud_final_cta" onDark={false} />
          </div>
        </div>
      </section>
    </article>
  );
}

export const CHALLENGER_PRIMARY_CTA = PRIMARY_CTA;
export const CHALLENGER_BONUS_CTA = BONUS_CTA;
