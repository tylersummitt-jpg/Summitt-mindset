import { ProgramsNaturalImage } from "@/components/programs/programs-natural-image";
import { imageFrame } from "@/components/programs/programs-image-frame";

export function ProgramsQuoteImage({
  src,
  alt,
  width,
  height,
  quote,
  attribution,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  quote?: string;
  attribution?: string;
}) {
  const frame = imageFrame(width, height);
  return (
    <figure className="max-w-full" data-image-frame={frame.kind}>
      <div className={frame.frameClassName}>
        <ProgramsNaturalImage
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={frame.sizes}
          className={`${frame.imageClassName} rounded-2xl border border-white/10`}
          style={frame.imageStyle}
        />
      </div>
      {quote ? (
        <blockquote className="mt-4 max-w-full">
          <p className="text-lg font-medium leading-snug text-stone-50 sm:text-xl">{quote}</p>
          {attribution ? (
            <footer className="mt-3 text-sm text-stone-400">— {attribution}</footer>
          ) : null}
        </blockquote>
      ) : null}
    </figure>
  );
}
