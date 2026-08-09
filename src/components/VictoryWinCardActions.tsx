"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { vrAccentLink, vrBodyMuted } from "@/components/victory-room-visual";

type VictoryWinCardActionsProps = {
  winId: string;
  editHref: string;
  expectedUpdatedAt: string;
};

/**
 * Subtle More menu: Edit + Delete with inline confirmation.
 * Soft-hide via DELETE /api/v2/wins/[winId]; no optimistic card removal.
 */
export function VictoryWinCardActions({
  winId,
  editHref,
  expectedUpdatedAt,
}: VictoryWinCardActionsProps) {
  const router = useRouter();
  const menuId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
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
          data.error || "This Win changed since you opened it. Refresh and try again."
        );
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "We couldn’t delete this Win. Please try again.");
      }
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t delete this Win. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="relative mt-5">
        <p className="font-medium text-stone-100">Delete this Win?</p>
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
            {busy ? "Deleting…" : "Delete Win"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-5">
      <details ref={detailsRef} className="group relative">
        <summary
          className={`${vrAccentLink} inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center px-2 [&::-webkit-details-marker]:hidden`}
          aria-label="Win actions"
          aria-controls={menuId}
        >
          <span aria-hidden className="text-lg leading-none tracking-widest">
            ···
          </span>
        </summary>
        <div
          id={menuId}
          role="menu"
          aria-label="Win actions"
          className="absolute left-0 z-20 mt-2 min-w-[10.5rem] rounded-xl border border-white/15 bg-[#0c1018] py-1 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.9)]"
        >
          <Link
            href={editHref}
            role="menuitem"
            className="block min-h-11 px-4 py-3 text-base font-medium text-amber-200 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
          >
            Edit
          </Link>
          <button
            type="button"
            role="menuitem"
            className="block w-full min-h-11 px-4 py-3 text-left text-base font-medium text-stone-200 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
            onClick={() => {
              setError(null);
              if (detailsRef.current) detailsRef.current.open = false;
              setConfirming(true);
            }}
          >
            Delete
          </button>
        </div>
      </details>
      {error ? (
        <p className="mt-3 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
