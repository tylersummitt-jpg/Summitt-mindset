"use client";

import type { ReactElement } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

function normalizeText(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export default function RelationshipsClient(): ReactElement {
  const router = useRouter();

  const [peopleSummary, setPeopleSummary] = useState("");
  const [relationshipStatus, setRelationshipStatus] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [childrenSummary, setChildrenSummary] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    const payload = {
      people_summary: normalizeText(peopleSummary),
      relationship_status: normalizeText(relationshipStatus),
      partner_name: normalizeText(partnerName),
      children_summary: normalizeText(childrenSummary),
    };

    if (!payload.people_summary) {
      setError("Please tell Coach Pat about the people you show up for most.");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/relationships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || "Something went wrong.");
        setSaving(false);
        return;
      }

      router.push("/onboarding/work");
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
            Who are the people you show up for most?
          </label>

          <textarea
            value={peopleSummary}
            onChange={(e) => setPeopleSummary(e.target.value)}
            rows={4}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Tell Coach Pat about the people who matter most."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Relationship status <span className="font-normal text-gray-500">(optional)</span>
          </label>

          <input
            type="text"
            value={relationshipStatus}
            onChange={(e) => setRelationshipStatus(e.target.value)}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Married, dating, single, etc."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Partner name <span className="font-normal text-gray-500">(optional)</span>
          </label>

          <input
            type="text"
            value={partnerName}
            onChange={(e) => setPartnerName(e.target.value)}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="First name is plenty."
          />
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-900 mb-2">
            Children <span className="font-normal text-gray-500">(optional)</span>
          </label>

          <textarea
            value={childrenSummary}
            onChange={(e) => setChildrenSummary(e.target.value)}
            rows={3}
            className="w-full border rounded-lg p-4 text-sm text-gray-900"
            placeholder="Tell Coach Pat about them. Names / ages if you'd like."
          />
        </div>
      </div>

      <div className="border rounded-xl bg-gray-50 p-4">
        <p className="text-sm text-gray-700">
          The people we show up for often shape the leader we become.
        </p>
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
            "px-6 py-3 rounded-md text-white font-semibold transition",
            saving ? "bg-gray-400" : "bg-black hover:bg-gray-900",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}