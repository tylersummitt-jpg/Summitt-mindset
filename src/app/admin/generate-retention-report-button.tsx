"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateRetentionReportButton({ busy }: { busy: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending || busy}
        className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
        onClick={() => {
          setPending(true);
          setMessage(null);
          void fetch("/api/admin/retention-report", { method: "POST" })
            .then(async (response) => {
              const body = (await response.json().catch(() => null)) as { error?: string } | null;
              if (!response.ok) {
                setMessage(body?.error ?? "Generation failed. The last saved report was not replaced.");
              }
              router.refresh();
            })
            .catch(() => {
              setMessage("Generation failed. The last saved report was not replaced.");
            })
            .finally(() => {
              setPending(false);
            });
        }}
      >
        {pending || busy ? "Generating" : "Generate Report"}
      </button>
      {message ? <p className="text-sm text-gray-700">{message}</p> : null}
    </>
  );
}
