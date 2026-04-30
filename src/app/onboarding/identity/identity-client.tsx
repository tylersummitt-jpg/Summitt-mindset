"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { validateOnboardingIdentityAnchorInput } from "@/lib/v2-identity-anchor";

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export default function IdentityClient(): ReactElement {
  const router = useRouter();

  const [preferredName, setPreferredName] = useState("");
  const [peopleSummary, setPeopleSummary] = useState("");
  const [identityAnchor, setIdentityAnchor] = useState("");
  const [responsibility, setResponsibility] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    const name = normalizeText(preferredName);
    if (!name) {
      setError("Add what Coach Pat should call you.");
      return;
    }

    const people = normalizeText(peopleSummary);
    if (!people) {
      setError("Add who you’re trying to show up for right now.");
      return;
    }

    const anchorRaw = normalizeText(identityAnchor);
    const anchorValidation = validateOnboardingIdentityAnchorInput(anchorRaw);
    if (!anchorValidation.ok) {
      setError(anchorValidation.error);
      return;
    }

    const resp = normalizeText(responsibility);
    if (!resp) {
      setError(
        "Add anything else Coach Pat should know about your family, team, or responsibilities."
      );
      return;
    }

    const payload = {
      preferred_name: name,
      people_summary: people,
      identity_anchor_text: anchorValidation.normalized,
      responsibility: resp,
    };

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          typeof data?.error === "string"
            ? data.error
            : res.status === 401
              ? "Your session expired. Please sign in again."
              : "Something went wrong."
        );
        setSaving(false);
        return;
      }

      router.push("/onboarding/commitment");
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
            What should Coach Pat call you?
          </label>

          <input
            type="text"
            value={preferredName}
            onChange={(e) => setPreferredName(e.target.value)}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="First name or nickname"
            autoComplete="given-name"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Who are you trying to show up for right now?
          </label>

          <textarea
            value={peopleSummary}
            onChange={(e) => setPeopleSummary(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Example: my kids, my spouse, my team, my students, my family, myself."
          />
          <p className="mt-2 text-xs text-gray-500">
            Relationship context — not your identity line for SMS.
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            When you follow through on this, who are you trying to become?
          </label>
          <p className="text-sm text-gray-600 mb-2">
            Example: a steadier mom, someone who keeps promises to himself, a healthier version of me,
            someone who finishes what I start.
          </p>
          <textarea
            value={identityAnchor}
            onChange={(e) => setIdentityAnchor(e.target.value)}
            rows={3}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="One honest line — who you’re becoming, not only who you care for."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Anything else Coach Pat should know about your family, team, or responsibilities?
          </label>

          <textarea
            value={responsibility}
            onChange={(e) => setResponsibility(e.target.value)}
            rows={3}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Names, ages, roles, or anything that would help Coach Pat coach you with context."
          />
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link href="/onboarding" className="text-sm underline text-gray-500">
          ← Back
        </Link>

        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className={[
            "px-6 py-3 rounded-md text-white font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-white",
            saving ? "cursor-wait bg-gray-400" : "bg-[var(--brand)] hover:opacity-90",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="border-t border-gray-200 pt-8 mt-2">
        <div className="rounded-xl bg-gray-50 px-4 py-4 text-center">
          <p className="text-sm text-gray-600 italic">You win in life with people. — Pat Summitt</p>
        </div>
      </div>
    </div>
  );
}
