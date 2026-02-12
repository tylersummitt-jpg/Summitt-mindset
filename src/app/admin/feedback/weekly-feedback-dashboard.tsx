"use client";

import { useEffect, useState } from "react";

export default function WeeklyFeedbackDashboard() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/weekly-feedback-digest");
      const json = await res.json();
      setData(json);
    }

    load();
  }, []);

  if (!data) {
    return <p className="text-sm text-gray-500">Loading digest…</p>;
  }

  return (
    <section className="border rounded-xl bg-white shadow-sm p-6 space-y-6">
      {/* ✅ Top Friction */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-2">
          Top Friction This Week
        </h2>

        <ul className="text-sm text-gray-700 space-y-1">
          {data.friction.map((f: any) => (
            <li key={f[0]}>
              • {f[0]} — {f[1]} reports
            </li>
          ))}
        </ul>
      </div>

      {/* ✅ Top Churn */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-2">
          Top Churn Reasons
        </h2>

        <ul className="text-sm text-gray-700 space-y-1">
          {data.churn.map((c: any) => (
            <li key={c[0]}>
              • {c[0]} — {c[1]} cancels
            </li>
          ))}
        </ul>
      </div>

      {/* ✅ Testimonial Language */}
      <div>
        <h2 className="font-semibold text-gray-900 mb-2">
          Strongest Member Language
        </h2>

        <ul className="text-sm text-gray-700 space-y-2">
          {data.testimonialLanguage.map((t: string, i: number) => (
            <li key={i} className="italic border-l-2 pl-3">
              “{t}”
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
