"use client";

import { useState } from "react";

type VictoryWinMediaImageProps = {
  cardUrl: string;
  width: number;
  height: number;
};

/**
 * Optional Win card photo. Signed URL is provided by the server; this only renders.
 * onError hides the image only — never the surrounding Win card.
 */
export function VictoryWinMediaImage({
  cardUrl,
  width,
  height,
}: VictoryWinMediaImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <div className="my-4 overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- private signed URLs; no next/image / remotePatterns */}
      <img
        src={cardUrl}
        width={width}
        height={height}
        alt="Photo attached to this win"
        className="h-auto w-full"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
