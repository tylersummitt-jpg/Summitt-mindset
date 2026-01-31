"use client";

import { useState } from "react";

export default function ManageMembershipButton() {
  const [loading, setLoading] = useState(false);

  async function handlePortal() {
    setLoading(true);

    try {
      const res = await fetch("/api/stripe/customer-portal", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const data = await res.json();

      if (!data.url) {
        throw new Error("No portal URL returned.");
      }

      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      alert("Unable to open billing portal.");
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handlePortal}
      disabled={loading}
      className="rounded-md border px-4 py-2 text-sm font-semibold hover:bg-black hover:text-white transition disabled:opacity-50"
    >
      {loading ? "Opening…" : "Manage Membership"}
    </button>
  );
}
