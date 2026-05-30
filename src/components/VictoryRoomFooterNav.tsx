import Link from "next/link";
import { vrAccentLink, vrSectionCard, vrBody } from "@/components/victory-room-visual";

export function VictoryRoomFooterNav() {
  return (
    <footer className={`${vrSectionCard} mt-14 border-white/12`}>
      <p className={vrBody}>
        Daily accountability happens by <strong className="font-semibold text-stone-50">text</strong> — your
        check-ins are where the real work shows up. Use the app when you want depth and proof.
      </p>
      <nav className="mt-6 flex flex-wrap gap-5">
        <Link href="/user" className={vrAccentLink}>
          Account
        </Link>
      </nav>
    </footer>
  );
}
