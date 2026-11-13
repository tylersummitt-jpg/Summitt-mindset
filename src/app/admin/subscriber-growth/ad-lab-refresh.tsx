"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AdLabMetaRefresh({
  lastImportedAt,
  timezone,
  stale = false,
}: {
  lastImportedAt: string | null;
  timezone: string;
  stale?: boolean;
}) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const busy = importing || refreshing;

  useEffect(() => {
    if (!importing && !refreshing) lock.current = false;
  }, [importing, refreshing]);

  async function onRefresh() {
    if (lock.current) return;
    lock.current = true;
    setImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/ad-lab/refresh", { method: "POST" });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !body?.ok) {
        setError(body?.error || "Meta could not be refreshed. The stored results are unchanged.");
        return;
      }
      startRefresh(() => {
        router.refresh();
      });
    } catch {
      setError("Meta could not be refreshed. The stored results are unchanged.");
    } finally {
      setImporting(false);
    }
  }

  const when = formatImportTime(lastImportedAt, timezone);
  const label = importing
    ? "Refreshing Meta data…"
    : refreshing
      ? "Updating the dashboard…"
      : "Refresh Meta Data";

  return (
    <div>
      <p className="text-xs text-stone-500">
        {when ? `Last successful import: ${when}` : "No successful import yet"}
        {stale && when ? " This import is stale." : ""}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        aria-busy={busy}
        className="mt-2 rounded-md bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {label}
      </button>
      {error ? (
        <p role="alert" className="mt-1 max-w-xs text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function formatImportTime(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
}
