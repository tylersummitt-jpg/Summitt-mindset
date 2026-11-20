const downloadClass =
  "inline-flex min-h-14 w-full max-w-md items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3.5 text-base font-semibold text-white shadow-md shadow-orange-500/20 transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

export function FreeResourcePage({
  title,
  download,
}: {
  title: string;
  download: { href: string; filename: string; actionLabel: string };
}) {
  return (
    <section className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-8 text-[var(--text)] sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <a href={download.href} download={download.filename} className={downloadClass} aria-label={download.actionLabel}>
          Download Free PDF
        </a>
      </div>
    </section>
  );
}
