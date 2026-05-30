"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const DASHBOARD_BG_MOBILE = "/brand/dashboard-bg-mobile.png";
const DASHBOARD_BG_DESKTOP = "/brand/dashboard-bg-desktop.png";

export function isVictoryRoomDashboardPath(pathname: string | null): boolean {
  return pathname != null && pathname.startsWith("/dashboard/victory-room");
}

type DashboardBackgroundFrameProps = {
  children: ReactNode;
};

export function DashboardBackgroundFrame({ children }: DashboardBackgroundFrameProps) {
  const pathname = usePathname();
  const victoryRoom = isVictoryRoomDashboardPath(pathname);

  return (
    <div
      className={`relative isolate w-full min-w-0 overflow-x-hidden ${
        victoryRoom
          ? "victory-room-route-canvas min-h-screen text-stone-100"
          : "min-h-[calc(100dvh-8rem)]"
      }`}
    >
      {!victoryRoom ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
            <div className="absolute inset-0 md:hidden">
              <Image
                src={DASHBOARD_BG_MOBILE}
                alt=""
                fill
                sizes="100vw"
                className="object-cover object-center"
              />
            </div>
            <div className="absolute inset-0 hidden md:block">
              <Image
                src={DASHBOARD_BG_DESKTOP}
                alt=""
                fill
                sizes="100vw"
                className="object-cover object-center"
              />
            </div>
          </div>
          <div
            className="pointer-events-none absolute inset-0 z-[1] bg-black/[0.08] md:bg-black/[0.05]"
            aria-hidden
          />
        </>
      ) : null}

      <div className="relative z-10">{children}</div>
    </div>
  );
}
