"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SmsTimePreference = "morning" | "afternoon" | "evening";

function normalizeTimeOfDayToSmsPref(raw: string | null): SmsTimePreference {
  if (raw === "morning") return "morning";
  if (raw === "midday") return "afternoon";
  return "evening";
}

function normalizeToE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 11) return `+${digits}`;

  return null;
}

export default function SmsClient({
  defaultTimeOfDay,
}: {
  defaultTimeOfDay: string | null;
}) {
  const router = useRouter();

  const defaultPref = useMemo<SmsTimePreference>(() => {
    return normalizeTimeOfDayToSmsPref(defaultTimeOfDay);
  }, [defaultTimeOfDay]);

  const [smsEnabled, setSmsEnabled] = useState(true);
  const [smsTimePreference, setSmsTimePreference] =
    useState<SmsTimePreference>(defaultPref);

  const [phoneInput, setPhoneInput] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    if (smsEnabled) {
      const normalized = normalizeToE164(phoneInput);

      if (!normalized) {
        setError("Please enter a valid mobile number.");
        return;
      }

      if (!consentChecked) {
        setError("Please confirm consent to receive training texts.");
        return;
      }

      setSaving(true);

      try {
        const res = await fetch("/api/onboarding/sms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            smsEnabled: true,
            smsTimePreference,
            phoneNumber: normalized,
            smsDisclosureAccepted: true,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(data?.error || "Something went wrong.");
          return;
        }

        router.push("/onboarding/complete");
      } catch {
        setError("Something went wrong.");
      } finally {
        setSaving(false);
      }

      return;
    }

    // SMS disabled
    await fetch("/api/onboarding/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        smsEnabled: false,
      }),
    });

    router.push("/onboarding/complete");
  }

  return (
    <div className="space-y-8">
      <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-semibold text-gray-900">
              Daily Training Text
            </p>
            <p className="text-sm text-gray-600">
              One message per day with your practice and a calm Coach Pat nudge.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setSmsEnabled((v) => {
                const next = !v;
                if (!next) setConsentChecked(false);
                return next;
              });
            }}
            className={[
              "px-4 py-2 rounded-md text-sm font-semibold transition",
              smsEnabled
                ? "bg-black text-white"
                : "bg-gray-200 text-gray-800",
            ].join(" ")}
          >
            {smsEnabled ? "On" : "Off"}
          </button>
        </div>

        {smsEnabled && (
          <div className="space-y-4 pt-4 border-t">
            <div>
              <label className="text-sm font-medium text-gray-900">
                Mobile Number
              </label>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="(614) 555-1234"
                className="mt-2 w-full border rounded-lg p-3 text-sm"
              />
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              {(["morning", "afternoon", "evening"] as SmsTimePreference[]).map(
                (opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setSmsTimePreference(opt)}
                    className={[
                      "border rounded-lg p-3 text-sm font-semibold",
                      smsTimePreference === opt
                        ? "border-black"
                        : "border-gray-200",
                    ].join(" ")}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </button>
                )
              )}
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-1"
              />
              <span>
                I agree to receive 1 training text per day from Summitt Mindset.
                Msg & data rates may apply. Reply STOP to cancel.
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={() => router.push("/onboarding/training-focus")}
          className="text-sm underline text-gray-500"
        >
          ← Back
        </button>

        <button
          type="button"
          onClick={handleContinue}
          disabled={saving}
          className={[
            "px-6 py-3 rounded-md text-white font-semibold",
            saving ? "bg-gray-400" : "bg-black",
          ].join(" ")}
        >
          {saving ? "Saving…" : "Continue →"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
