import Image from "next/image";

export function ProgramsQuoteImage({
  src,
  alt,
  quote,
  attribution,
}: {
  src: string;
  alt: string;
  quote?: string;
  attribution?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
      <div
        className={
          quote
            ? "relative aspect-[16/9] w-full sm:aspect-[2/1]"
            : "relative h-48 w-full sm:h-56"
        }
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 768px) 100vw, 48rem"
          className={quote ? "object-cover" : "object-contain"}
        />
      </div>
      {quote ? (
        <blockquote className="px-5 py-5 sm:px-6 sm:py-6">
          <p className="text-lg font-medium leading-snug text-stone-50 sm:text-xl">{quote}</p>
          {attribution ? (
            <footer className="mt-3 text-sm text-stone-400">— {attribution}</footer>
          ) : null}
        </blockquote>
      ) : null}
    </figure>
  );
}
