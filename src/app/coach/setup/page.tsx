"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "w-full px-4 py-3 rounded-md border border-[var(--border)] bg-white text-[var(--text)]";

export default function CoachSetupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const res = await fetch("/api/coach/shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          full_name: fullName,
          address_line_1: addressLine1,
          address_line_2: addressLine2,
          city,
          state,
          postal_code: postalCode,
          country,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setSaving(false);
        return;
      }

      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        setSaving(false);
        return;
      }

      router.replace("/onboarding");
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] px-4 py-16">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-[var(--text)] mb-2">
          Shipping address
        </h1>
        <p className="text-sm text-[var(--muted)] mb-8">
          Where should we send your Leadership Kit?
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Full name
            </label>
            <input
              className={inputClass}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoComplete="name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Address line 1
            </label>
            <input
              className={inputClass}
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              required
              autoComplete="address-line1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--text)] mb-1">
              Address line 2 (optional)
            </label>
            <input
              className={inputClass}
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              autoComplete="address-line2"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">
                City
              </label>
              <input
                className={inputClass}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
                autoComplete="address-level2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">
                State / Province
              </label>
              <input
                className={inputClass}
                value={state}
                onChange={(e) => setState(e.target.value)}
                required
                autoComplete="address-level1"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">
                Postal code
              </label>
              <input
                className={inputClass}
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                required
                autoComplete="postal-code"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">
                Country
              </label>
              <input
                className={inputClass}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                required
                autoComplete="country-name"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
