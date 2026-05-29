import type { ReactNode } from "react";
import {
  vrSectionBadge,
  vrSectionCard,
  vrSectionSubtitle,
  vrSectionTitle,
} from "@/components/victory-room-visual";

type VictoryRoomSectionShellProps = {
  number: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
};

export function VictoryRoomSectionShell({
  number,
  title,
  subtitle,
  children,
  className = "",
}: VictoryRoomSectionShellProps) {
  return (
    <section className={`${vrSectionCard} ${className}`.trim()}>
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/20 to-transparent"
        aria-hidden
      />
      <div className="flex items-start gap-5">
        <span className={vrSectionBadge} aria-hidden>
          {number}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className={vrSectionTitle}>{title}</h2>
          {subtitle ? <p className={vrSectionSubtitle}>{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}
