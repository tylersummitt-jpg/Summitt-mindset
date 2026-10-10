"use client";

import { useState } from "react";

export function CopyBusinessReportButton({ report }: { report: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
      onClick={() => {
        void navigator.clipboard.writeText(report).then(() => {
          setCopied(true);
        });
      }}
    >
      {copied ? "Copied" : "Copy Business Report"}
    </button>
  );
}
