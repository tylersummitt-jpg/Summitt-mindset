import Image from "next/image";

type PageHeroProps = {
  title: string;
  subtitle?: string;
  imageSrc: string;
  imageAlt: string;
  eyebrow?: string;
  grayscale?: boolean;
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

        <div className="relative w-full h-[420px] rounded-2xl overflow-hidden">
          <Image
            src={imageSrc}
            alt={imageAlt}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 50vw"
            className={`object-cover ${grayscale === false ? "" : "grayscale"}`}
          />
        </div>
      </div>
    </section>
  );
}
