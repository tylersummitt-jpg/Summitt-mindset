import Link from "next/link";

type VictoryRoomSmsNoticeProps = {
  smsEnabled: boolean;
};

export function VictoryRoomSmsNotice({ smsEnabled }: VictoryRoomSmsNoticeProps) {
  if (smsEnabled) return null;

  return (
    <section className="mb-8 rounded-xl border border-stone-200 border-l-4 border-l-amber-500 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">Text check-ins are not fully connected yet</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-600">
        Coach Pat works best when texts are on. You can still use Victory Room, but daily accountability
        happens by text.
      </p>
      <Link href="/user" className="mt-3 inline-block text-sm font-medium text-gray-900 underline underline-offset-2">
        Open Account
      </Link>
    </section>
  );
}
