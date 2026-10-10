import Link from "next/link";
import { loadChallengeUnsubscribeView } from "@/lib/challenge-runtime";

type PageProps = {
  searchParams: Promise<{
    token?: string;
    done?: string;
    invalid?: string;
    reenrolled?: string;
    complete?: string;
    reenroll_error?: string;
  }>;
};

export default async function ChallengeUnsubscribePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const view = token
    ? await loadChallengeUnsubscribeView(token)
    : { kind: "invalid" as const };

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-16">
      <div className="mx-auto max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-8">
        <h1 className="text-2xl font-bold text-[var(--text)]">7-day challenge emails</h1>
        {view.kind === "invalid" || params.invalid === "1" ? (
          <p className="mt-4 text-[var(--muted)] leading-relaxed">
            This unsubscribe link is invalid.
          </p>
        ) : null}
        {view.kind === "confirm" ? (
          <>
            {params.reenrolled === "1" ? (
              <p className="mt-4 text-[var(--text)] leading-relaxed">
                You&apos;re back on the challenge. Remaining lessons will resume. Finished
                lessons are not sent again.
              </p>
            ) : (
              <p className="mt-4 text-[var(--muted)] leading-relaxed">
                Unsubscribing stops the remaining lessons in this seven-email challenge.
                It does not affect a Summitt Mindset membership.
              </p>
            )}
            <form method="POST" action="/api/challenge/unsubscribe" className="mt-6">
              <input type="hidden" name="token" value={view.token} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-md bg-[var(--brand)] px-6 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                Unsubscribe
              </button>
            </form>
          </>
        ) : null}
        {view.kind === "suppressed" ? (
          <>
            {params.reenrolled === "1" ? null : (
              <p className="mt-4 text-[var(--text)] leading-relaxed">
                {view.completed || params.complete === "1"
                  ? "This challenge is already complete. It will not start over."
                  : "You won't receive further challenge emails."}
              </p>
            )}
            {params.reenrolled === "1" ? (
              <p className="mt-4 text-[var(--text)] leading-relaxed">
                You&apos;re back on the challenge. Remaining lessons will resume. Finished
                lessons are not sent again.
              </p>
            ) : null}
            {params.reenroll_error === "1" ? (
              <p className="mt-4 text-[var(--muted)] leading-relaxed">
                We couldn&apos;t turn the remaining lessons back on.
              </p>
            ) : null}
            {!view.completed ? (
              <form method="POST" action="/api/challenge/reenroll" className="mt-6">
                <input type="hidden" name="token" value={view.token} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-md border border-[var(--border)] px-6 py-3 text-sm font-semibold text-[var(--text)] hover:bg-[var(--bg)]"
                >
                  Re-enroll in the remaining lessons
                </button>
              </form>
            ) : null}
          </>
        ) : null}
        <p className="mt-8 text-sm text-[var(--muted)]">
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
        </p>
      </div>
    </main>
  );
}
