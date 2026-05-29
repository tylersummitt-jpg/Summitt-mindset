import type { VictoryPrincipleCardDisplay } from "@/lib/v2-victory-principles-map";
import { VrIconStar } from "@/components/VictoryRoomIcons";
import {
  vrBodyLarge,
  vrIconCircle,
  vrIconCircleGreen,
  vrLabel,
  vrPrincipleDefault,
  vrPrincipleHighlight,
} from "@/components/victory-room-visual";

type VictoryPrincipleCardProps = {
  label: string;
  card: VictoryPrincipleCardDisplay;
  variant?: "default" | "highlight";
  fullWidth?: boolean;
};

export function VictoryPrincipleCard({
  label,
  card,
  variant = "default",
  fullWidth = false,
}: VictoryPrincipleCardProps) {
  const panelClass = variant === "highlight" ? vrPrincipleHighlight : vrPrincipleDefault;
  const iconCircle = variant === "highlight" ? vrIconCircleGreen : vrIconCircle;

  return (
    <article className={`${panelClass} ${fullWidth ? "sm:col-span-2" : ""}`.trim()}>
      <div className="flex items-start gap-4">
        <div className={iconCircle} aria-hidden>
          <VrIconStar className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={vrLabel}>{label}</h3>
          <p className="mt-3 font-serif text-xl font-semibold leading-snug text-stone-50 sm:text-2xl">
            {card.title}
          </p>
          <p className={`${vrBodyLarge} mt-3 text-stone-300`}>{card.text}</p>
        </div>
      </div>
    </article>
  );
}
