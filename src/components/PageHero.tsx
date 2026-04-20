import Image from "next/image";

type PageHeroProps = {
  title: string;
  subtitle?: string;
  imageSrc: string;
  imageAlt: string;
  eyebrow?: string;
  grayscale?: boolean;
  imagePosition?: string;
  children?: React.ReactNode;
};

/**
 * Reusable hero section modeled after home page.
 * Matches: bg-[var(--ink)], grid, rounded image, next/image.
 */
export function PageHero({
  title,
  subtitle,
  imageSrc,
  imageAlt,
  eyebrow,
  grayscale,
  imagePosition: _imagePosition,
  children,
}: PageHeroProps) {
  return (
    <section className="bg-[var(--ink)]">
      <div className="max-w-6xl mx-auto px-4 py-24 grid md:grid-cols-2 gap-12 items-center">
        <div>
          {eyebrow && (
            <p className="text-sm font-semibold text-[var(--muted)] mb-2 uppercase tracking-wide">
              {eyebrow}
            </p>
          )}
          <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-5 text-[var(--text)]">
            {title}
          </h1>
          {subtitle && (
            <p className="text-lg text-[var(--muted)] mb-8 leading-relaxed">
              {subtitle}
            </p>
          )}
          {children}
        </div>

        <div className="w-full flex items-center justify-center">
          <div className="w-full flex justify-center">
            <Image
              src={imageSrc}
              alt={imageAlt}
              width={800}
              height={600}
              priority
              className={`object-contain max-h-[500px] w-auto h-auto max-w-full ${grayscale === true ? "grayscale" : ""}`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
