"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  vrAccentLink,
  vrBodyMuted,
  vrLabel,
  vrSectionCard,
  vrSectionTitle,
} from "@/components/victory-room-visual";
import {
  MANUAL_WIN_DETAILS_MAX,
  MANUAL_WIN_TITLE_MAX,
  type ManualWinSeasonOption,
} from "@/lib/v2-win-manual-fields";

type Props = {
  winId: string;
  /** YYYY-MM-DD max selectable (today in user TZ). */
  maxOccurredOn: string;
  initialOccurredOn: string;
  initialTitle: string;
  initialDetails: string;
  initialSeasonId: string;
  expectedUpdatedAt: string;
  seasonOptions: ManualWinSeasonOption[];
  cancelHref: string;
  orphanCommitmentNotice: boolean;
};

const inputClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#0a0e16] px-4 py-3 text-base text-stone-100 placeholder:text-stone-500 outline-none focus:border-amber-500/40";

export default function EditWinClient(props: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(props.initialTitle);
  const [details, setDetails] = useState(props.initialDetails);
  const [occurredOn, setOccurredOn] = useState(props.initialOccurredOn);
  const [seasonChoice, setSeasonChoice] = useState(props.initialSeasonId);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(props.expectedUpdatedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seasonSelectOptions = useMemo(() => props.seasonOptions, [props.seasonOptions]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        title,
        details: details.trim() ? details : null,
        occurred_on: occurredOn,
        season_id: seasonChoice.trim() ? seasonChoice.trim() : null,
        expected_updated_at: expectedUpdatedAt,
      };

      const res = await fetch(`/api/v2/wins/${encodeURIComponent(props.winId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        updated_at?: string;
        code?: string;
      };
      if (res.status === 409 || data.code === "conflict") {
        throw new Error(
          data.error || "This Win changed since you opened it. Refresh and try again."
        );
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (typeof data.updated_at === "string" && data.updated_at.trim()) {
        setExpectedUpdatedAt(data.updated_at.trim());
      }
      router.replace(props.cancelHref);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={vrSectionCard}>
      <p className="mb-6">
        <Link href={props.cancelHref} className={vrAccentLink}>
          ← Cancel
        </Link>
      </p>

      <h1 className={vrSectionTitle}>Edit Win</h1>

      {props.orphanCommitmentNotice ? (
        <p className={`${vrBodyMuted} mt-4 text-sm`}>
          This Win’s Season link isn’t on your list. Choosing Overall only will detach it; pick a
          Season to reattach.
        </p>
      ) : null}

      <form onSubmit={onSave} className="mt-8 space-y-6">
        <div>
          <label htmlFor="edit-win-title" className={vrLabel}>
            What happened?
          </label>
          <input
            id="edit-win-title"
            name="title"
            type="text"
            required
            maxLength={MANUAL_WIN_TITLE_MAX}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={inputClass}
            placeholder="A real moment worth remembering"
            autoComplete="off"
          />
          <p className={`${vrBodyMuted} mt-2 text-xs`}>
            {title.trim().length}/{MANUAL_WIN_TITLE_MAX}
          </p>
        </div>

        <div>
          <label htmlFor="edit-win-details" className={vrLabel}>
            Details <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <textarea
            id="edit-win-details"
            name="details"
            rows={4}
            maxLength={MANUAL_WIN_DETAILS_MAX}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className={`${inputClass} resize-y min-h-[6rem]`}
            placeholder="Anything else you want to remember"
          />
          <p className={`${vrBodyMuted} mt-2 text-xs`}>
            {details.trim().length}/{MANUAL_WIN_DETAILS_MAX}
          </p>
        </div>

        <div>
          <label htmlFor="edit-win-date" className={vrLabel}>
            Date
          </label>
          <input
            id="edit-win-date"
            name="occurred_on"
            type="date"
            required
            max={props.maxOccurredOn}
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="edit-win-season" className={vrLabel}>
            Season <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <select
            id="edit-win-season"
            name="season_id"
            value={seasonChoice}
            onChange={(e) => setSeasonChoice(e.target.value)}
            className={inputClass}
          >
            <option value="">Overall only</option>
            {seasonSelectOptions.map((opt) => (
              <option key={opt.seasonId} value={opt.seasonId}>
                {opt.pickerLabel.replace(/\n/g, " · ")}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p className="text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 px-5 py-3 text-base font-semibold text-amber-50 transition hover:bg-amber-500/25 disabled:opacity-60 sm:w-auto"
        >
          {busy ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
