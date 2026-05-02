"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  normalizeIntakeWhitespace,
  validateBehaviorStatementIntake,
  validateCommitmentTitleIntake,
} from "@/lib/v2-commitment-intake-validation";

function normalizeText(input: string): string {
  return normalizeIntakeWhitespace(input);
}

export default function CommitmentSetupClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [behaviorStatement, setBehaviorStatement] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError(null);

    const payload = {
      commitment_title: normalizeText(title),
      behavior_statement: normalizeText(behaviorStatement),
      success_criteria: normalizeText(successCriteria) || null,
    };

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

    setSaving(true);
    try {
      const res = await fetch("/api/v2/cutover/commitment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };

      if (!res.ok) {
        setError(
          typeof data?.error === "string" ? data.error : "Something went wrong. Please try again."
        );
        setSaving(false);
        return;
      }

      if (data?.ok !== true) {
        setError("Something went wrong. Please try again.");
        setSaving(false);
        return;
      }

      router.refresh();
      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">Name this commitment</label>
        <p className="text-xs text-gray-500 mb-2">
          A short name for what you&apos;re working on.
        </p>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={saving}
          className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-900"
          placeholder="Example: Be present after work"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">What will you actually do?</label>
        <p className="text-xs text-gray-500 mb-2">
          Write it so Coach Pat can ask, &ldquo;Did you do this today?&rdquo;
        </p>
        <textarea
          value={behaviorStatement}
          onChange={(e) => setBehaviorStatement(e.target.value)}
          disabled={saving}
          rows={5}
          className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-900"
          placeholder="Example: I will put my phone away for the first 30 minutes after I get home."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">
          Success criteria <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          value={successCriteria}
          onChange={(e) => setSuccessCriteria(e.target.value)}
          disabled={saving}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-900"
          placeholder="Optional — how you’ll know you held the line."
        />
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <button
          type="submit"
          disabled={saving}
          className="member-primary-cta-lg disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-100 disabled:hover:opacity-100"
        >
          {saving ? "Saving…" : "Save commitment"}
        </button>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-gray-600 hover:text-gray-900 underline underline-offset-2"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
