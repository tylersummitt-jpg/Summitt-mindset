"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  vrAccentLink,
  vrBody,
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

function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

type Props = {
  timeZone: string;
  defaultOccurredOn: string;
  /** When set, Season is fixed (no picker). */
  lockedSeason: {
    seasonId: string;
    seasonName: string;
    goalLabel: string | null;
  } | null;
  seasonOptions: ManualWinSeasonOption[];
  /** Where user came from for cancel link. */
  cancelHref: string;
};

const inputClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#0a0e16] px-4 py-3 text-base text-stone-100 placeholder:text-stone-500 outline-none focus:border-amber-500/40";

export default function AddWinClient(props: Props) {
  const router = useRouter();
  const [clientRequestId] = useState(() => newClientRequestId());
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [occurredOn, setOccurredOn] = useState(props.defaultOccurredOn);
  const [seasonChoice, setSeasonChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = props.lockedSeason != null;

  const seasonSelectOptions = useMemo(() => props.seasonOptions, [props.seasonOptions]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        client_request_id: clientRequestId,
        title,
        details: details.trim() ? details : null,
        occurred_on: occurredOn,
      };
      if (locked && props.lockedSeason) {
        body.season_id = props.lockedSeason.seasonId;
      } else if (seasonChoice.trim()) {
        body.season_id = seasonChoice.trim();
      }

      const res = await fetch("/api/v2/wins/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        redirect_to?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      // Season → season detail. Overall → preserve entry context (All Wins vs Victory Room).
      const dest =
        locked &&
        typeof data.redirect_to === "string" &&
        data.redirect_to.startsWith("/dashboard/")
          ? data.redirect_to
          : props.cancelHref;
      router.replace(dest);
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
          ← Back
        </Link>
      </p>

      <h1 className={vrSectionTitle}>Add a Win</h1>

      {props && props.lockedSeason ? (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <p className={vrLabel}>Saving to</p>
          <p className={`${vrBody} mt-1 font-medium text-stone-100`}>
            {props.lockedSeason.seasonName}
          </p>
          {props.lockedSeason.goalLabel ? (
            <p className={`${vrBodyMuted} mt-1`}>{props.lockedSeason.goalLabel}</p>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={onSave} className="mt-8 space-y-6">
        <div>
          <label htmlFor="win-title" className={vrLabel}>
            What happened?
          </label>
          <input
            id="win-title"
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
          <label htmlFor="win-details" className={vrLabel}>
            Details <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <textarea
            id="win-details"
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
          <label htmlFor="win-date" className={vrLabel}>
            Date
          </label>
          <input
            id="win-date"
            name="occurred_on"
            type="date"
            required
            max={props.defaultOccurredOn}
            value={occurredOn}
            onChange={(e) => setOccurredOn(e.target.value)}
            className={inputClass}
          />
        </div>

        {!locked ? (
          <div>
            <label htmlFor="win-season" className={vrLabel}>
              Season <span className="font-normal text-stone-500">(optional)</span>
            </label>
            <select
              id="win-season"
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
        ) : null}

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
          {busy ? "Saving…" : "Save Win"}
        </button>
      </form>
    </div>
  );
}
