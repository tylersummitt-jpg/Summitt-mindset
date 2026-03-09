"use client";

export function CopyLinkButton() {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(window.location.href)}
      className="text-sm font-semibold text-[var(--brand)] hover:underline"
    >
      Copy quote link
    </button>
  );
}
