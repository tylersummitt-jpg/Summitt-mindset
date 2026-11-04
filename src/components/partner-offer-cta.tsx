/**
 * The only partner purchase control.
 * A link exists only after the $179 Price validates.
 * Otherwise the control stays disabled and does not start checkout.
 */

const PARTNER_CTA_CLASS =
  "inline-flex min-h-14 w-full cursor-pointer items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-base font-semibold !text-[#111827] no-underline shadow-md shadow-orange-500/20 transition hover:brightness-110 sm:w-auto md:px-8";

const PARTNER_CTA_DISABLED_CLASS =
  "inline-flex min-h-14 w-full cursor-not-allowed items-center justify-center rounded-xl bg-[var(--brand)] px-6 py-3 text-base font-semibold !text-[#111827] opacity-80 shadow-md shadow-orange-500/20 sm:w-auto md:px-8";

export function PartnerOfferCta({
  noteId,
  href,
}: {
  noteId: string;
  href: string | null;
}) {
  if (!href) {
    return (
      <div className="w-full max-w-md">
        <button
          type="button"
          disabled
          aria-describedby={noteId}
          className={PARTNER_CTA_DISABLED_CLASS}
        >
          Claim My Special Offer
        </button>
        <p id={noteId} className="mt-3 text-sm font-medium leading-relaxed text-white/90">
          Exclusive checkout coming soon.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md">
      <a href={href} className={PARTNER_CTA_CLASS}>
        Claim My Special Offer
      </a>
    </div>
  );
}
