const downloadClass =
  "inline-flex min-h-14 w-full max-w-md items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-orange-500/20 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

export function FreeResourcePage({
  title,
  download,
}: {
  title: string;
  download: { href: string; filename: string; actionLabel: string };
}) {
  return (
    <>
      <section className="bg-white px-4 py-7 text-center text-[var(--text)] sm:px-6 sm:py-9">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3.5">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand)]">
            A gift from Summitt Mindset
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <a href={download.href} download={download.filename} className={downloadClass} aria-label={download.actionLabel}>
            Download Free PDF
          </a>
          <p className="text-sm text-[var(--muted)]">Yours to keep. No signup required.</p>
        </div>
      </section>
      <section className="bg-neutral-100 px-4 py-8 text-center text-[var(--text)] sm:px-6 sm:py-10">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Want to take it a step further?</h2>
          <p className="mt-4 text-base leading-7 text-[var(--muted)] sm:text-lg">
            Pat Summitt&apos;s principles weren&apos;t just meant to be read. They were meant to be lived. That&apos;s why we created Summitt Mindset.
          </p>
          <p aria-hidden="true" className="mt-6 text-2xl leading-none text-neutral-400">
            ↓
          </p>
        </div>
      </section>
    </>
  );
}
