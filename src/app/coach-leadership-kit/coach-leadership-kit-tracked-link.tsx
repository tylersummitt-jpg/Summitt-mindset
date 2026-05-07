"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackCoachCtaClicked, type CoachCtaPlacement } from "@/lib/meta-pixel";

type Props = {
  href: string;
  className?: string;
  cta: CoachCtaPlacement;
  children: React.ReactNode;
};

function isCoachLeadershipKitFunnelPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/coach-leadership-kit" ||
    pathname.startsWith("/coach-leadership-kit/")
  );
}

/**
 * Same as next/link; fires coach_cta_clicked on click only on coach LP / nested coach paths.
 */
export function CoachLeadershipKitTrackedLink({
  href,
  className,
  cta,
  children,
}: Props) {
  const pathname = usePathname();

  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (!isCoachLeadershipKitFunnelPath(pathname)) return;
        trackCoachCtaClicked(cta);
      }}
    >
      {children}
    </Link>
  );
}
