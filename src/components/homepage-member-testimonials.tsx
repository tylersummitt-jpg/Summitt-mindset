"use client";

import { useRef, useState } from "react";

type MemberTestimonial = {
  id: "kathy" | "jordan" | "rb" | "jackie";
  name: string;
  detail: string;
  quote: string;
};

export const TESTIMONIAL_SWIPE_THRESHOLD_PX = 48;

export const MEMBER_TESTIMONIALS: readonly MemberTestimonial[] = [
  {
    id: "kathy",
    name: "Kathy P.",
    detail: "Oregon",
    quote:
      "\u201CCoach Pat\u201D encourages me, challenges me, and reminds me of what I\u2019m capable of. My whole approach to life is changing and life feels easier.",
  },
  {
    id: "jordan",
    name: "Jordan P.",
    detail: "Father of 2",
    quote:
      "Summitt Mindset is as close as somebody can get to having Pat Summitt as a life coach.",
  },
  {
    id: "rb",
    name: "R.B. Summitt",
    detail: "Pat\u2019s former husband",
    quote:
      "Summitt Mindset carries forward the kind of accountability Pat believed in. It is simple, direct, and built to help people follow through.",
  },
  {
    id: "jackie",
    name: "Jackie D.",
    detail: "Ohio",
    quote:
      "I\u2019ve really enjoyed the daily text messages. Some days they remind me, and some days they challenge me. Either way, they help me work on becoming a better version of myself.",
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

const quoteClass =
  "text-lg font-semibold leading-relaxed text-gray-950 sm:text-xl lg:text-2xl";

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
      className="border-y border-gray-100 bg-white px-4 pb-6 pt-8 sm:px-6 sm:pb-7 sm:pt-9 lg:px-8 lg:pb-8 lg:pt-10"
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
          className="mx-auto mt-5 min-w-0 max-w-3xl sm:mt-6"
          onKeyDown={onKeyDown}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <blockquote aria-live="polite" className="min-w-0">
            <div className="flex min-h-[11.5rem] items-center justify-center min-[360px]:min-h-[9.5rem] min-[430px]:min-h-[7.75rem] sm:min-h-[6.5rem] lg:min-h-[7.75rem]">
              <p className={quoteClass}>{testimonial.quote}</p>
            </div>
            <div
              className="mx-auto mt-4 h-1 w-12 rounded-full bg-[var(--brand)]"
              aria-hidden
            />
            <footer className="mt-3 text-sm text-gray-950 sm:text-base">
              <span className="font-bold">{testimonial.name}</span>
              <span className="font-medium text-slate-600">
                {" "}
                · {testimonial.detail}
              </span>
            </footer>
          </blockquote>

          <div className="mt-3 flex items-center justify-center gap-1">
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
