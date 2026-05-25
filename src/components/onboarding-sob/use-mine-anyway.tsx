"use client";

import type { ReactElement } from "react";

export function UseMineAnywayPanel({
  message,
  checked,
  onChange,
}: {
  message: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): ReactElement {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p>{message}</p>
      <label className="mt-3 flex items-start gap-2 font-medium">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>Use mine anyway</span>
      </label>
    </div>
  );
}
