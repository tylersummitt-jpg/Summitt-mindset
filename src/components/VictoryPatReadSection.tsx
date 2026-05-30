import type { ReactNode } from "react";
import { VictoryRoomSectionShell } from "@/components/VictoryRoomSectionShell";
import { VrIconArrow, VrIconEye, VrIconStar } from "@/components/VictoryRoomIcons";
import { vrBodyLarge, vrDivider, vrIconCircle, vrLabel } from "@/components/victory-room-visual";
import type { VictoryPatReadForDisplay } from "@/lib/v2-victory-pat-read-persist";

type VictoryPatReadSectionProps = {
  read: VictoryPatReadForDisplay;
};

function ReadRow({
  icon,
  label,
  text,
  accent,
}: {
  icon: ReactNode;
  label: string;
  text: string;
  accent?: boolean;
}) {
  return (
    <div className={`flex gap-4 sm:gap-5 ${accent ? "pt-2" : ""}`}>
      <div className={vrIconCircle} aria-hidden>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className={vrLabel}>{label}</h3>
        <p className={`${vrBodyLarge} mt-3 text-stone-100`}>{text}</p>
      </div>
    </div>
  );
}

export function VictoryPatReadSection({ read }: VictoryPatReadSectionProps) {
  return (
    <VictoryRoomSectionShell
      title="Coach Pat's Feedback"
      subtitle="Grounded in your commitment and real check-ins — not a scoreboard."
    >
      <div className="mt-8 space-y-8">
        <ReadRow icon={<VrIconStar />} label="What I'm proud of" text={read.strength} />
        {read.pattern ? (
          <>
            <div className={vrDivider} />
            <ReadRow icon={<VrIconEye />} label="Pattern I'm noticing" text={read.pattern} />
          </>
        ) : null}
        <div className={vrDivider} />
        <ReadRow icon={<VrIconArrow />} label="Next move" text={read.nextMove} accent />
      </div>
    </VictoryRoomSectionShell>
  );
}
