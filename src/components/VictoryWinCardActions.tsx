"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { vrAccentLink, vrBodyMuted } from "@/components/victory-room-visual";

type ConfirmKind = "delete" | "remove" | null;

type VictoryWinCardActionsProps = {
  winId: string;
  editHref: string;
  expectedUpdatedAt: string;
  /** When true, show Remove photo (presentation-only; does not delete the Win). */
  hasMedia?: boolean;
};

/**
 * Subtle More menu: Edit + optional Remove photo + Delete with inline confirmation.
 * Soft-hide Win via DELETE /api/v2/wins/[winId]; remove photo via DELETE victory-media.
 * No optimistic card/media removal.
 */
export function VictoryWinCardActions({
  winId,
  editHref,
  expectedUpdatedAt,
  hasMedia = false,
}: VictoryWinCardActionsProps) {
  const router = useRouter();
  const menuId = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [confirming, setConfirming] = useState<ConfirmKind>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirming) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConfirming(null);
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
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn’t delete this Win. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmRemovePhoto() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/victory-media/win/${encodeURIComponent(winId)}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        error?: string;
        code?: string;
      };
      if (
        res.ok &&
        data.ok &&
        (data.status === "removed" || data.status === "already_absent")
      ) {
        setConfirming(null);
        router.refresh();
        return;
      }
      throw new Error(
        data.error || "We couldn’t remove this photo. Please try again."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn’t remove this photo. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (confirming === "delete") {
    // In-flow confirmation: expands the card; never absolute (card uses overflow-hidden).
    return (
      <div className="mt-5">
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
              setConfirming(null);
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

  if (confirming === "remove") {
    return (
      <div className="mt-5">
        <p className="font-medium text-stone-100">Remove this photo?</p>
        <p className={`${vrBodyMuted} mt-2 text-sm`}>
          This permanently removes the photo. Your Win stays in Victory Room. This
          can’t be undone.
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
              setConfirming(null);
              setError(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${vrAccentLink} min-h-11 px-1 text-red-300 decoration-red-400/40 hover:text-red-200`}
            disabled={busy}
            onClick={() => void onConfirmRemovePhoto()}
          >
            {busy ? "Removing…" : "Remove photo"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <details ref={detailsRef} className="group">
        <summary
          className={`${vrAccentLink} inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center px-2 [&::-webkit-details-marker]:hidden`}
          aria-label="Win actions"
          aria-controls={menuId}
        >
          <span aria-hidden className="text-lg leading-none tracking-widest">
            ···
          </span>
        </summary>
        {/*
          In-flow panel (not absolute): card keeps overflow-hidden for decorative blur;
          open menu must expand card height so Edit/Delete stay visible.
        */}
        <div
          id={menuId}
          role="menu"
          aria-label="Win actions"
          className="mt-2 w-full rounded-xl border border-white/15 bg-[#0c1018] py-1 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.9)]"
        >
          <Link
            href={editHref}
            role="menuitem"
            className="block min-h-11 px-4 py-3 text-base font-medium text-amber-200 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
          >
            Edit
          </Link>
          {hasMedia ? (
            <button
              type="button"
              role="menuitem"
              className="block w-full min-h-11 px-4 py-3 text-left text-base font-medium text-stone-200 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
              onClick={() => {
                setError(null);
                if (detailsRef.current) detailsRef.current.open = false;
                setConfirming("remove");
              }}
            >
              Remove photo
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="block w-full min-h-11 px-4 py-3 text-left text-base font-medium text-stone-200 hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
            onClick={() => {
              setError(null);
              if (detailsRef.current) detailsRef.current.open = false;
              setConfirming("delete");
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
