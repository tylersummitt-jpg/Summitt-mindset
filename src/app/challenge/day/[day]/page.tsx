import Link from "next/link";
import { challengeLessons } from "@/lib/challenge-lessons";

type PageProps = {
  params: Promise<{ day: string }>;
};

export default async function ChallengeDayPage({ params }: PageProps) {
  const { day } = await params;
  const dayNumber = Number(day);

  if (!Number.isFinite(dayNumber) || dayNumber < 1 || dayNumber > 7) {
    return (
      <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
        <p className="text-[var(--text)] text-center">Challenge day not found.</p>
      </main>
    );
  }

  type ExtendedLesson = (typeof challengeLessons)[number] & {
    videoId?: string;
    speaker?: string;
    description?: string;
  };

  const lesson = challengeLessons.find((l) => l.day === dayNumber) as
    | ExtendedLesson
    | undefined;

  if (!lesson) {
    return (
      <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
        <p className="text-[var(--text)] text-center">Challenge day not found.</p>
      </main>
    );
  }

  const videoId = lesson.videoId;
  const speaker = lesson.speaker ?? "Pat Summitt";
  const description = lesson.challenge ?? lesson.lesson;

  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text)] mb-4">
          Day {lesson.day}: {lesson.title}
        </h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          Day {lesson.day} of 7
        </p>
        <p className="text-[var(--muted)] mb-8">
          7-Day Pat Summitt Leadership Challenge
        </p>

        {videoId ? (
          <div className="mb-8">
            <div className="w-full max-w-3xl mx-auto aspect-video mb-4">
              <iframe
                src={`https://player.vimeo.com/video/${videoId}`}
                width="800"
                height="450"
                className="w-full h-full"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        ) : null}

        <div className="space-y-2 mb-10">
          <p className="text-sm text-[var(--muted)]">Speaker</p>
          <p className="text-[var(--text)] font-semibold">{speaker}</p>
          <h2 className="text-lg font-semibold text-[var(--text)] mb-2">
            Today’s Challenge
          </h2>
          <p className="text-[var(--text)] mt-4 leading-relaxed">
            {description}
          </p>
        </div>

        <section className="mt-12 border-t border-[var(--border)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text)] mb-2">
            Enjoying the challenge?
          </h2>
          <p className="text-[var(--muted)] mb-4">
            Summitt Mindset helps leaders build daily leadership habits inspired
            by Pat Summitt.
          </p>
          <Link
            href="/subscribe"
            className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90"
          >
            Start Free Trial
          </Link>
        </section>
      </section>
    </main>
  );
}

