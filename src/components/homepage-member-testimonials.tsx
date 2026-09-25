"use client";

import { useRef, useState } from "react";

type QuoteSegment = {
  text: string;
  emphasis?: boolean;
};

type MemberTestimonial = {
  id: "kathy" | "jordan" | "rb" | "jackie";
  name: string;
  detail: string;
  paragraphs: QuoteSegment[][];
};

export const TESTIMONIAL_SWIPE_THRESHOLD_PX = 48;

export const MEMBER_TESTIMONIALS: readonly MemberTestimonial[] = [
  {
    id: "kathy",
    name: "Kathy P.",
    detail: "Oregon",
    paragraphs: [
      [
        {
          text: "Talking with \u201CCoach Pat\u201D through Summitt Mindset feels like having Pat Summitt sitting on my shoulder\u2014challenging me, encouraging me, and reminding me of what I am capable of.",
        },
      ],
      [
        { text: "My whole approach to my life is changing, and " },
        { text: "life feels easier", emphasis: true },
        { text: "." },
      ],
    ],
  },
  {
    id: "jordan",
    name: "Jordan P.",
    detail: "Father of 2",
    paragraphs: [
      [
        { text: "Summitt Mindset is as close as somebody can get to having " },
        { text: "Pat Summitt as a life coach", emphasis: true },
        { text: "." },
      ],
    ],
  },
  {
    id: "rb",
    name: "R.B. Summitt",
    detail: "Pat\u2019s former husband",
    paragraphs: [
      [
        {
          text: "Summitt Mindset carries forward the kind of accountability Pat believed in. It is simple, direct, and built to help people ",
        },
        { text: "follow through", emphasis: true },
        { text: "." },
      ],
    ],
  },
  {
    id: "jackie",
    name: "Jackie D.",
    detail: "Ohio",
    paragraphs: [
      [
        {
          text: "I\u2019ve really enjoyed the daily text messages. Some days they remind me, and some days they challenge me. Either way, they help me work on becoming a ",
        },
        { text: "better version of myself", emphasis: true },
        { text: "." },
      ],
    ],
  },
];

export function resolveTestimonialSwipe(
  start: { x: number; y: number },
  end: { x: number; y: number }
): "next" | "previous" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < TESTIMONIAL_SWIPE_THRESHOLD_PX) return null;
  if (absX <= absY) return null;
  return dx < 0 ? "next" : "previous";
}

const controlButtonClass =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

function QuoteSegments({ segments }: { segments: QuoteSegment[] }) {
  return segments.map((segment, index) =>
    segment.emphasis ? (
      <span
        key={index}
        className="text-[1.12em] font-bold leading-snug text-orange-700"
      >
        {segment.text}
      </span>
    ) : (
      <span key={index}>{segment.text}</span>
    )
  );
}

export function HomepageMemberTestimonials() {
  const [index, setIndex] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const testimonial = MEMBER_TESTIMONIALS[index];

  function step(delta: number) {
    setIndex((current) => {
      const count = MEMBER_TESTIMONIALS.length;
      return (current + delta + count) % count;
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  }

  function onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const direction = resolveTestimonialSwipe(start, {
      x: touch.clientX,
      y: touch.clientY,
    });
    if (direction === "next") step(1);
    else if (direction === "previous") step(-1);
  }

  return (
    <section
      aria-labelledby="member-feedback-heading"
      className="border-y border-gray-100 bg-white px-4 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-20"
    >
      <div className="mx-auto min-w-0 max-w-5xl text-center">
        <div className="flex items-center justify-center gap-3 sm:gap-4">
          <span className="h-px w-6 shrink-0 bg-orange-500/40 sm:w-20" aria-hidden />
          <p
            id="member-feedback-heading"
            className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--brand)] sm:text-base sm:tracking-[0.25em]"
          >
            MEMBER FEEDBACK
          </p>
          <span className="h-px w-6 shrink-0 bg-orange-500/40 sm:w-20" aria-hidden />
        </div>

        <div
          role="region"
          aria-roledescription="carousel"
          aria-label="Member testimonials"
          className="mx-auto mt-8 min-w-0 max-w-3xl sm:mt-10"
          onKeyDown={onKeyDown}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <blockquote
            aria-live="polite"
            className="min-h-[4.5rem] min-w-0 sm:min-h-[5.5rem]"
          >
            {testimonial.paragraphs.map((paragraph, paragraphIndex) => (
              <p
                key={paragraphIndex}
                className={`text-lg font-semibold leading-relaxed text-gray-950 sm:text-xl lg:text-2xl ${
                  paragraphIndex > 0 ? "mt-3" : ""
                }`}
              >
                <QuoteSegments segments={paragraph} />
              </p>
            ))}
            <div
              className="mx-auto mt-6 h-1 w-12 rounded-full bg-[var(--brand)]"
              aria-hidden
            />
            <footer className="mt-5 text-sm text-gray-950 sm:text-base">
              <span className="font-bold">{testimonial.name}</span>
              <span className="font-medium text-slate-600">
                {" "}
                · {testimonial.detail}
              </span>
            </footer>
          </blockquote>

          <div className="mt-6 flex items-center justify-center gap-1">
            <button
              type="button"
              className={controlButtonClass}
              aria-label="Previous testimonial"
              onClick={() => step(-1)}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M15 6 9 12l6 6" />
              </svg>
            </button>
            <div className="flex items-center" role="group" aria-label="Choose a testimonial">
              {MEMBER_TESTIMONIALS.map((item, itemIndex) => {
                const active = itemIndex === index;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={controlButtonClass}
                    aria-label={`Show testimonial ${itemIndex + 1} of ${MEMBER_TESTIMONIALS.length}, ${item.name}`}
                    aria-current={active ? "true" : undefined}
                    onClick={() => setIndex(itemIndex)}
                  >
                    <span
                      className={`block rounded-full ${
                        active ? "h-2.5 w-2.5 bg-orange-700" : "h-2 w-2 bg-gray-300"
                      }`}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={controlButtonClass}
              aria-label="Next testimonial"
              onClick={() => step(1)}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
