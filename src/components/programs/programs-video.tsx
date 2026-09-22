import { utBodyMuted } from "@/components/utility-page-visual";
import { programsTeaching } from "@/components/programs/programs-visual";
import { buildVimeoPlayerEmbedUrl } from "@/lib/vimeo-player-embed";

export function ProgramsVideo({
  title,
  speaker,
  vimeoId,
  stepTitle,
}: {
  title: string;
  speaker: string;
  vimeoId: string | null;
  stepTitle: string;
}) {
  const src = buildVimeoPlayerEmbedUrl(vimeoId);
  return (
    <figure className={`${programsTeaching} space-y-4`}>
      <figcaption>
        <p className="text-base font-semibold text-stone-50 sm:text-lg">{title}</p>
        <p className={`mt-1 ${utBodyMuted}`}>{speaker}</p>
      </figcaption>
      {src ? (
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          <iframe
            title={`${stepTitle} video`}
            src={src}
            className="absolute inset-0 h-full w-full"
            allow="fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : null}
    </figure>
  );
}
