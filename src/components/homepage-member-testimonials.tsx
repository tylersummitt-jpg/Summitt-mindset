type MemberTestimonial = {
  id: "kathy" | "jordan" | "rb" | "jackie";
  name: string;
  detail: string;
  quote: string;
};

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

export function HomepageMemberTestimonials() {
  return (
    <section
      aria-labelledby="member-feedback-heading"
      className="border-b border-gray-100 bg-white px-4 py-12 sm:px-6 sm:py-16"
    >
      <div className="mx-auto min-w-0 max-w-5xl break-words">
        <h2
          id="member-feedback-heading"
          className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl"
        >
          Real People. Real Progress.
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {MEMBER_TESTIMONIALS.map((testimonial) => (
            <figure
              key={testimonial.id}
              className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6"
            >
              <blockquote>
                <p className="text-lg font-semibold leading-relaxed text-slate-950 sm:text-xl">
                  {testimonial.quote}
                </p>
              </blockquote>
              <figcaption className="mt-4 text-lg text-slate-950">
                <span className="font-bold">{testimonial.name}</span>
                <span className="font-medium text-slate-700"> · {testimonial.detail}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
