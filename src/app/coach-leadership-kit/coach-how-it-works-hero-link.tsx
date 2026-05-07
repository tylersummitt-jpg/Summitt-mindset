"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trackCoachHowItWorksNav } from "@/lib/meta-pixel";

const HOW_IT_WORKS_HREF = "/coach-leadership-kit/how-it-works";

function isCoachLeadershipKitRoot(pathname: string | null): boolean {
  return (
    pathname === "/coach-leadership-kit" || pathname === "/coach-leadership-kit/"
  );
}

/**
 * Hero secondary CTA on /coach-leadership-kit only; fires coach_how_it_works_nav on Meta.
 */
export function CoachHowItWorksHeroLink({
  className,
}: {
  className: string;
}) {
  const pathname = usePathname();

  return (
    <Link
      href={HOW_IT_WORKS_HREF}
      className={className}
      onClick={() => {
        if (!isCoachLeadershipKitRoot(pathname)) return;
        trackCoachHowItWorksNav();
      }}
    >
      How It Works
    </Link>
  );
}
