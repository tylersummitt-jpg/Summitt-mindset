import Link from "next/link";

import { MEMBERSHIP_PUBLIC_OFFER } from "@/lib/membership-public-offer";
import type { FreePdfPageContent } from "@/lib/free-pdf";

const downloadClass =
  "inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3.5 text-base font-semibold text-white shadow-sm shadow-orange-500/20 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] sm:w-auto";

const trialClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white px-5 py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:bg-[var(--brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] sm:w-auto";

export function FreeResourcePage({
  page,
  trialHref,
}: {
  page: FreePdfPageContent;
  trialHref: string;
}) {
  const single = page.downloads.length === 1 ? page.downloads[0] : null;

  return (
    <div className="bg-[var(--bg)] text-[var(--text)]">
      <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="space-y-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
            {page.eyebrow}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
          <div className="space-y-3 text-base leading-7 text-[var(--muted)] sm:text-lg">
            {page.intro.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </header>

        {single ? (
          <div className="mt-8">
            <a href={single.href} download={single.filename} className={downloadClass} aria-label={single.actionLabel}>
              Download Free PDF
            </a>
            <p className="mt-3 break-all text-sm text-[var(--muted)]">{single.filename}</p>
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {page.downloads.map((item) => (
              <section
                key={item.href}
                aria-labelledby={item.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6"
              >
                <h2 id={item.id} className="text-lg font-semibold">
                  {item.title}
                </h2>
                <p className="mt-2 text-base leading-7 text-[var(--muted)]">{item.detail}</p>
                <a
                  href={item.href}
                  download={item.filename}
                  className={`${downloadClass} mt-5`}
                  aria-label={item.actionLabel}
                >
                  Download Free PDF
                </a>
                <p className="mt-3 break-all text-sm text-[var(--muted)]">{item.filename}</p>
              </section>
            ))}
          </div>
        )}

        <section aria-labelledby="coach-pat-heading" className="mt-12 border-t border-[var(--border)] pt-10">
          <h2 id="coach-pat-heading" className="text-xl font-semibold">
            Coach Pat
          </h2>
          <div className="mt-3 space-y-3 text-base leading-7 text-[var(--muted)]">
            <p>
              Coach Pat is an AI coach created by Summitt Mindset around Pat Summitt&apos;s leadership
              principles. Coach Pat helps people apply those principles to personal goals through
              ongoing conversations and accountability.
            </p>
            <p>
              {`The trial is optional. It is a ${MEMBERSHIP_PUBLIC_OFFER.trial}, and checkout requires a payment card. Then it is ${MEMBERSHIP_PUBLIC_OFFER.monthly} unless you cancel.`}
            </p>
          </div>
          <Link href={trialHref} className={`${trialClass} mt-5`}>
            Start a 7-day free trial
          </Link>
        </section>
      </article>
    </div>
  );
}
