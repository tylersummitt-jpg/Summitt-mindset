"use client";

import { useEffect, useState, type FormEvent } from "react";

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return String(v);
}

/** Normalized snapshot for change detection (trim; null/undefined → ""). */
function snapshotFromProfile(p: Record<string, unknown>): Record<string, string> {
  return {
    relationship_status: str(p.relationship_status).trim(),
    partner_name: str(p.partner_name).trim(),
    children_summary: str(p.children_summary).trim(),
    people_summary: str(p.people_summary).trim(),
    responsibility: str(p.responsibility).trim(),
    work_challenge: str(p.work_challenge).trim(),
    physical_state: str(p.physical_state).trim(),
    health_goal: str(p.health_goal).trim(),
    energy_obstacles: str(p.energy_obstacles).trim(),
    pressure_summary: str(p.pressure_summary).trim(),
    proud_of: str(p.proud_of).trim(),
    best_self_trigger: str(p.best_self_trigger).trim(),
    preferred_name: str(p.preferred_name).trim(),
  };
}

const EMPTY_SNAPSHOT = snapshotFromProfile({});

export default function LifeContextPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [originalProfile, setOriginalProfile] = useState<Record<
    string,
    string
  > | null>(null);

  const [relationshipStatus, setRelationshipStatus] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [childrenSummary, setChildrenSummary] = useState("");
  const [peopleSummary, setPeopleSummary] = useState("");

  const [responsibility, setResponsibility] = useState("");
  const [workChallenge, setWorkChallenge] = useState("");

  const [physicalState, setPhysicalState] = useState("");
  const [healthGoal, setHealthGoal] = useState("");
  const [energyObstacles, setEnergyObstacles] = useState("");

  const [pressureSummary, setPressureSummary] = useState("");
  const [proudOf, setProudOf] = useState("");
  const [bestSelfTrigger, setBestSelfTrigger] = useState("");

  const [preferredName, setPreferredName] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const res = await fetch("/api/profile/get", {
          credentials: "include",
        });
        const json = (await res.json().catch(() => ({}))) as {
          profile?: Record<string, unknown>;
        };

        if (cancelled) return;

        const p = json.profile;
        if (!p || typeof p !== "object") {
          setOriginalProfile({ ...EMPTY_SNAPSHOT });
          return;
        }

        const profileRecord = p as Record<string, unknown>;
        setOriginalProfile(snapshotFromProfile(profileRecord));

        setRelationshipStatus(str(p.relationship_status));
        setPartnerName(str(p.partner_name));
        setChildrenSummary(str(p.children_summary));
        setPeopleSummary(str(p.people_summary));
        setResponsibility(str(p.responsibility));
        setWorkChallenge(str(p.work_challenge));
        setPhysicalState(str(p.physical_state));
        setHealthGoal(str(p.health_goal));
        setEnergyObstacles(str(p.energy_obstacles));
        setPressureSummary(str(p.pressure_summary));
        setProudOf(str(p.proud_of));
        setBestSelfTrigger(str(p.best_self_trigger));
        setPreferredName(str(p.preferred_name));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaveMessage(null);
    setSaveError(null);
    setSaving(true);

    try {
      const orig = originalProfile ?? EMPTY_SNAPSHOT;

      const current: Record<string, string> = {
        relationship_status: relationshipStatus.trim(),
        partner_name: partnerName.trim(),
        children_summary: childrenSummary.trim(),
        people_summary: peopleSummary.trim(),
        responsibility: responsibility.trim(),
        work_challenge: workChallenge.trim(),
        physical_state: physicalState.trim(),
        health_goal: healthGoal.trim(),
        energy_obstacles: energyObstacles.trim(),
        pressure_summary: pressureSummary.trim(),
        proud_of: proudOf.trim(),
        best_self_trigger: bestSelfTrigger.trim(),
        preferred_name: preferredName.trim(),
      };

      const updates: Record<string, string> = {};
      for (const key of Object.keys(current) as Array<keyof typeof current>) {
        if (current[key] !== orig[key]) {
          updates[key] = current[key];
        }
      }

      if (Object.keys(updates).length === 0) {
        setSaveMessage("No changes to save.");
        return;
      }

      const res = await fetch("/api/profile/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });

      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };

      if (!res.ok || json.ok !== true) {
        setSaveError("Something went wrong. Please try again.");
        return;
      }

      setOriginalProfile({ ...orig, ...updates });
      setSaveMessage(
        "Got it. I'll adjust how I coach you going forward."
      );
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    "w-full border border-gray-200 rounded-lg p-4 text-sm text-gray-900 bg-white";
  const labelClass = "block text-sm font-semibold text-gray-900 mb-2";

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 px-6 py-14 sm:py-16">
        <div className="max-w-2xl mx-auto space-y-10">
          <header className="text-center space-y-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Update Your Life Context
            </h1>
            <p className="text-sm text-gray-600">Loading…</p>
          </header>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-6 py-14 sm:py-16">
      <div className="max-w-2xl mx-auto space-y-10">
        <header className="text-center space-y-3">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            Update Your Life Context
          </h1>
          <p className="text-sm sm:text-base text-gray-600 leading-relaxed max-w-xl mx-auto">
            If anything in your life has changed, update it here so your
            coaching stays relevant.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 sm:p-8 space-y-10"
        >
          <p className="text-sm text-gray-500 text-center max-w-xl mx-auto">
            You don&apos;t need to fill everything out. Just update what&apos;s
            changed.
          </p>

          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-2">
              Relationships
            </h2>

            <div>
              <label htmlFor="relationship_status" className={labelClass}>
                Relationship status
              </label>
              <input
                id="relationship_status"
                type="text"
                value={relationshipStatus}
                onChange={(e) => setRelationshipStatus(e.target.value)}
                className={fieldClass}
                placeholder="Married, dating, single, etc."
              />
            </div>

            <div>
              <label htmlFor="partner_name" className={labelClass}>
                Partner name
              </label>
              <input
                id="partner_name"
                type="text"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                className={fieldClass}
                placeholder="First name is plenty."
              />
            </div>

            <div>
              <label htmlFor="children_summary" className={labelClass}>
                Children
              </label>
              <textarea
                id="children_summary"
                value={childrenSummary}
                onChange={(e) => setChildrenSummary(e.target.value)}
                rows={3}
                className={fieldClass}
                placeholder="Names, ages, or anything Coach Pat should know."
              />
            </div>

            <div>
              <label htmlFor="people_summary" className={labelClass}>
                People you show up for most
              </label>
              <textarea
                id="people_summary"
                value={peopleSummary}
                onChange={(e) => setPeopleSummary(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-2">
              Work
            </h2>

            <div>
              <label htmlFor="responsibility" className={labelClass}>
                Responsibility on your shoulders
              </label>
              <textarea
                id="responsibility"
                value={responsibility}
                onChange={(e) => setResponsibility(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>

            <div>
              <label htmlFor="work_challenge" className={labelClass}>
                What feels hardest about work right now
              </label>
              <textarea
                id="work_challenge"
                value={workChallenge}
                onChange={(e) => setWorkChallenge(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-2">
              Health
            </h2>

            <div>
              <label htmlFor="physical_state" className={labelClass}>
                How you feel physically these days
              </label>
              <textarea
                id="physical_state"
                value={physicalState}
                onChange={(e) => setPhysicalState(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>

            <div>
              <label htmlFor="health_goal" className={labelClass}>
                Health or energy you want to improve
              </label>
              <textarea
                id="health_goal"
                value={healthGoal}
                onChange={(e) => setHealthGoal(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>

            <div>
              <label htmlFor="energy_obstacles" className={labelClass}>
                What tends to throw you off physically or mentally
              </label>
              <textarea
                id="energy_obstacles"
                value={energyObstacles}
                onChange={(e) => setEnergyObstacles(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-2">
              Pressure &amp; Identity
            </h2>

            <div>
              <label htmlFor="pressure_summary" className={labelClass}>
                Pressure you are carrying
              </label>
              <textarea
                id="pressure_summary"
                value={pressureSummary}
                onChange={(e) => setPressureSummary(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>

            <div>
              <label htmlFor="proud_of" className={labelClass}>
                What you are most proud of so far
              </label>
              <textarea
                id="proud_of"
                value={proudOf}
                onChange={(e) => setProudOf(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>

            <div>
              <label htmlFor="best_self_trigger" className={labelClass}>
                When the best version of you shows up
              </label>
              <textarea
                id="best_self_trigger"
                value={bestSelfTrigger}
                onChange={(e) => setBestSelfTrigger(e.target.value)}
                rows={4}
                className={fieldClass}
                placeholder="Short answers are perfect."
              />
            </div>
          </section>

          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-100 pb-2">
              Optional
            </h2>

            <div>
              <label htmlFor="preferred_name" className={labelClass}>
                What you prefer to be called
              </label>
              <input
                id="preferred_name"
                type="text"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                className={fieldClass}
                placeholder="First name or nickname"
              />
            </div>
          </section>

          <div className="pt-4 space-y-3">
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 rounded-md text-white font-semibold bg-black hover:bg-gray-900 transition disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Updates"}
              </button>
            </div>
            {saveMessage ? (
              <p className="text-sm text-gray-700 text-center">{saveMessage}</p>
            ) : null}
            {saveError ? (
              <p className="text-sm text-red-600 text-center">{saveError}</p>
            ) : null}
          </div>
        </form>
      </div>
    </main>
  );
}
