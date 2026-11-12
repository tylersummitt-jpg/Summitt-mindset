import type { ResumeActivationStatus } from "@/lib/stripe-first-checkout/activate";

export function ActivationRecoveryNotice({
  status,
}: {
  status: Exclude<ResumeActivationStatus, "none" | "linked">;
}) {
  const title =
    status === "retry" ? "Finishing your membership" : "We couldn't finish your membership";
  const body =
    status === "retry"
      ? "Your original membership is saved. Try again to finish connecting it. You do not need to enter a card or start another trial."
      : status === "preserved"
        ? "A cancellation is already on this membership, so it was left in place. You do not need to start another trial."
        : "This membership needs a person to review it before it can be connected. You do not need to start another trial.";

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg items-center px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text)]">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {status === "retry" ? (
            <a
              href="/post-sign-in"
              className="rounded-lg bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-white"
            >
              Try again
            </a>
          ) : null}
          <a
            href="/support"
            className="rounded-lg px-4 py-3 text-sm font-semibold text-[var(--brand)]"
          >
            Contact support
          </a>
        </div>
      </div>
    </main>
  );
}
