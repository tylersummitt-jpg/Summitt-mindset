import type { ReactNode } from "react";
import {
  vrSectionCard,
  vrSectionSubtitle,
  vrSectionTitle,
} from "@/components/victory-room-visual";

type VictoryRoomSectionShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
};

export function VictoryRoomSectionShell({
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
      <div>
        <h2 className={vrSectionTitle}>{title}</h2>
        {subtitle ? <p className={vrSectionSubtitle}>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
