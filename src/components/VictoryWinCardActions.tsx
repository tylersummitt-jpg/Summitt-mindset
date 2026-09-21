"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { vrAccentLink, vrBodyMuted } from "@/components/victory-room-visual";

type VictoryWinCardActionsProps = {
  winId: string;
  editHref: string;
  expectedUpdatedAt: string;
};

/**
 * Edit-mode card actions: visible Edit + Delete with inline confirmation.
 * Soft-hide Win via DELETE /api/v2/wins/[winId]. No optimistic card removal.
 */
export function VictoryWinCardActions({
  winId,
  editHref,
  expectedUpdatedAt,
}: VictoryWinCardActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirming) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConfirming(false);
        setError(null);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  async function onConfirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/wins/${encodeURIComponent(winId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expected_updated_at: expectedUpdatedAt }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        code?: string;
      };
      if (res.status === 409 || data.code === "conflict") {
        throw new Error(
          data.error || "This Victory changed since you opened it. Refresh and try again."
        );
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "We couldn’t delete this Victory. Please try again.");
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t delete this Victory. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    // In-flow confirmation: expands the card; never absolute (card uses overflow-hidden).
    return (
      <div className="mt-5">
        <p className="font-medium text-stone-100">Delete this Victory?</p>
        <p className={`${vrBodyMuted} mt-2 text-sm`}>
          This removes it from your Victory Room. Your accountability history and messages are not
          changed.
        </p>
        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            className={`${vrAccentLink} min-h-11 px-1`}
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${vrAccentLink} min-h-11 px-1 text-red-300 decoration-red-400/40 hover:text-red-200`}
            disabled={busy}
            onClick={() => void onConfirmDelete()}
          >
            {busy ? "Deleting…" : "Delete Victory"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-wrap gap-x-6">
      <Link href={editHref} className={`${vrAccentLink} inline-flex min-h-11 items-center`}>
        Edit
      </Link>
      <button
        type="button"
        className="inline-flex min-h-11 items-center px-1 text-base font-medium text-stone-400 underline decoration-stone-500/40 underline-offset-[4px] transition hover:text-stone-300 hover:decoration-stone-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060a11]"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        Delete
      </button>
      {error ? (
        <p className="mt-3 w-full text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
