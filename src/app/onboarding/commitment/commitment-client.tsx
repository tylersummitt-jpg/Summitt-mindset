"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeIntakeWhitespace,
  validateBehaviorStatementIntake,
  validateCommitmentTitleIntake,
} from "@/lib/v2-commitment-intake-validation";

export default function CommitmentClient(): ReactElement {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [behaviorStatement, setBehaviorStatement] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (saving) return;

    setError(null);

    const titleErr = validateCommitmentTitleIntake(title);
    if (titleErr) {
      setError(titleErr);
      return;
    }

    const behaviorErr = validateBehaviorStatementIntake(behaviorStatement);
    if (behaviorErr) {
      setError(behaviorErr);
      return;
    }

    const payload = {
      commitment_title: normalizeIntakeWhitespace(title),
      behavior_statement: normalizeIntakeWhitespace(behaviorStatement),
    };

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof data?.error === "string" ? data.error : "Something went wrong."
        );
        setSaving(false);
        return;
      }

      router.push("/onboarding/sms");
      router.refresh();
    } catch {
      setError("Something went wrong.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Name this commitment
          </label>
          <p className="text-xs text-gray-500 mb-2">
            A short name for what you&apos;re working on.
          </p>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Example: Be present after work"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            What will you actually do?
          </label>
          <p className="text-xs text-gray-500 mb-2">
            Write it so Coach Pat can ask, &ldquo;Did you do this today?&rdquo;
          </p>
          <textarea
            value={behaviorStatement}
            onChange={(e) => setBehaviorStatement(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Example: I will put my phone away for the first 30 minutes after I get home."
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/onboarding/identity")}
          className="text-sm underline text-gray-500"
        >
          ← Back
        </button>

        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className={[
            "px-6 py-3 rounded-md text-white font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-white",
            saving
              ? "cursor-wait bg-gray-400"
              : "bg-[var(--brand)] hover:opacity-90",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
