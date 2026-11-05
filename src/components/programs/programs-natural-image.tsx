import Image from "next/image";
import type { CSSProperties } from "react";

export function ProgramsNaturalImage({
  src,
  alt,
  width,
  height,
  className,
  style,
  sizes,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  className: string;
  style: CSSProperties;
  sizes: string;
}) {
  if (src.endsWith(".svg")) {
    return (
      // The one lesson diagram is an SVG. next/image refuses SVG unless
      // optimizer security is relaxed for every image, so this path uses a
      // plain image with the measured width and height.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className}
        style={style}
      />
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      className={className}
      style={style}
    />
  );
}
