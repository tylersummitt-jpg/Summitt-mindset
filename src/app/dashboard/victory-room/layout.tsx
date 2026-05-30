import type { ReactNode } from "react";
import { vrRouteShell } from "@/components/victory-room-visual";

export default function VictoryRoomLayout({ children }: { children: ReactNode }) {
  return <div className={`victory-room-route-canvas ${vrRouteShell}`}>{children}</div>;
}
