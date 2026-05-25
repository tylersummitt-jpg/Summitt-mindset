import Link from "next/link";

export function VictoryRoomFooterNav() {
  return (
    <footer className="mt-12 rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-sm leading-relaxed text-gray-700">
        Daily accountability happens by <strong>text</strong> — your check-ins are where the real work
        shows up. Use the app when you want depth and proof.
      </p>
      <nav className="mt-4 flex flex-wrap gap-4 text-sm font-medium">
        <Link href="/user" className="text-gray-900 underline underline-offset-2 hover:text-gray-700">
          Account
        </Link>
      </nav>
    </footer>
  );
}
