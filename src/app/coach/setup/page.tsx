"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trackCoachShippingSubmitted } from "@/lib/meta-pixel";

const inputClass =
  "w-full px-4 py-3 rounded-md border border-[var(--border)] bg-white text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2";

const HERO_IMAGE_ALT =
  "Pat Summitt Leadership Kit — premium coaching materials for your team";

export default function CoachSetupPage() {
  const router = useRouter();
  const coachShippingSubmittedTrackedRef = useRef(false);
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

      if (!coachShippingSubmittedTrackedRef.current) {
        coachShippingSubmittedTrackedRef.current = true;
        trackCoachShippingSubmitted();
      }
      router.replace("/onboarding");
    } catch {
      setError("Network error. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-neutral-950">
      <div className="md:grid md:min-h-[80vh] md:grid-cols-2 lg:grid-cols-[1fr_min(28rem,44%)]">
        {/* Image-led column */}
        <div className="relative isolate h-[min(42vh,340px)] w-full md:h-auto md:min-h-[80vh]">
          <div className="absolute inset-0 md:hidden">
            <Image
              src="/brand/coach-setup-mobile.png"
              alt={HERO_IMAGE_ALT}
              fill
              sizes="100vw"
              priority
              className="object-cover object-center"
            />
          </div>
          <div className="absolute inset-0 hidden md:block">
            <Image
              src="/brand/coach-setup-desktop.jpeg"
              alt={HERO_IMAGE_ALT}
              fill
              sizes="100vw"
              priority
              className="object-cover object-[42%_center] lg:object-center"
            />
          </div>
          {/* Readability: mobile — darker toward bottom; desktop — darker on left so kit stays visible right */}
          <div
            className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(to_top,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.28)_45%,transparent_72%)] md:bg-[linear-gradient(90deg,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.35)_38%,rgba(0,0,0,0.1)_62%,transparent_85%)]"
            aria-hidden
          />
        </div>

        {/* Form column */}
        <div className="relative z-10 bg-[var(--bg)] px-4 py-8 pb-12 md:flex md:min-h-[80vh] md:items-center md:justify-center md:bg-neutral-950 md:px-8 md:py-12 lg:px-10">
          <div className="mx-auto w-full max-w-xl rounded-2xl border border-[var(--border)] bg-white/95 p-6 shadow-xl sm:p-8">
            <h1 className="text-2xl font-bold text-[var(--text)] sm:text-3xl mb-2">
              Tell us where to send your Leadership Kit.
            </h1>
            <p className="text-sm text-[var(--muted)] mb-8 leading-relaxed">
              You&apos;re in. We&apos;ll ship your Pat Summitt Leadership Kit to
              this address — so you and your team can start strong.
            </p>

            <section
              className="mb-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm text-[var(--text)] leading-relaxed"
              aria-label="Coach Leadership Kit offer"
            >
              <p>
                Coach-only membership offer. Start your Summitt Mindset
                membership and receive the Pat Summitt Leadership Kit at no
                additional charge. The kit was originally offered for $400, and
                we cover standard shipping. After you finish this step, our team
                may reach out to confirm details and personalize your Leadership
                Kit for your program.
              </p>
            </section>

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
                className="w-full inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-semibold text-white bg-[var(--brand)] hover:opacity-90 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                {saving ? "Saving…" : "Save and continue"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
