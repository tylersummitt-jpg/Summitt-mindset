"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SmsTimePreference = "morning" | "afternoon" | "evening";

function normalizeTimeOfDayToSmsPref(raw: string | null): SmsTimePreference {
  // onboarding uses: morning | midday | evening
  // sms uses: morning | afternoon | evening
  if (raw === "morning") return "morning";
  if (raw === "midday") return "afternoon";
  return "evening";
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

  const [smsEnabled, setSmsEnabled] = useState<boolean>(true);
  const [smsTimePreference, setSmsTimePreference] =
    useState<SmsTimePreference>(defaultPref);

  // Twilio wants an affirmative consent moment.
  const [consentChecked, setConsentChecked] = useState<boolean>(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

    // If they want SMS, we require explicit consent checkbox.
    if (smsEnabled && !consentChecked) {
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
          smsEnabled,
          smsTimePreference,
          smsDisclosureAccepted: smsEnabled ? true : false,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Something went wrong.");
        return;
      }

      router.push("/onboarding/complete");
    } catch (e) {
      setError("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Toggle */}
      <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <p className="font-semibold text-gray-900">Daily Training Text</p>
            <p className="text-sm text-gray-600">
              One message per day with your practice and a calm Coach Pat nudge.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSmsEnabled((v) => !v)}
            className={[
              "px-4 py-2 rounded-md text-sm font-semibold transition",
              smsEnabled
                ? "bg-black text-white hover:bg-gray-900"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300",
            ].join(" ")}
            aria-pressed={smsEnabled}
          >
            {smsEnabled ? "On" : "Off"}
          </button>
        </div>

        {/* Time choice */}
        <div className="pt-4 border-t space-y-3">
          <p className="text-sm font-medium text-gray-900">
            When should we send it?
          </p>

          <div className="grid sm:grid-cols-3 gap-3">
            {(["morning", "afternoon", "evening"] as SmsTimePreference[]).map(
              (opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setSmsTimePreference(opt)}
                  disabled={!smsEnabled}
                  className={[
                    "border rounded-lg p-3 text-sm font-semibold transition",
                    !smsEnabled ? "opacity-50 cursor-not-allowed" : "",
                    smsTimePreference === opt
                      ? "border-black bg-white"
                      : "border-gray-200 bg-white hover:bg-gray-50",
                  ].join(" ")}
                >
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              )
            )}
          </div>

          <p className="text-xs text-gray-500">
            We’ll use your local timezone.
          </p>
        </div>
      </div>

      {/* ✅ Twilio Compliance Disclosure Block */}
      <div className="border rounded-xl bg-gray-50 p-6 space-y-3">
        <p className="text-sm font-semibold text-gray-900">
          Text message details
        </p>

        <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
          <li>
            By enabling SMS, you agree to receive <strong>1 text per day</strong>{" "}
            from Summitt Mindset (training reminders + your daily practice).
          </li>
          <li>
            Message frequency may vary slightly during onboarding and weekly
            reflection moments.
          </li>
          <li>
            <strong>Msg &amp; data rates may apply.</strong>
          </li>
          <li>
            Reply <strong>STOP</strong> to cancel. Reply <strong>HELP</strong>{" "}
            for help.
          </li>
          <li>
            Consent is not a condition of purchase.
          </li>
        </ul>

        <div className="pt-3 border-t">
          <label className="flex items-start gap-3 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              disabled={!smsEnabled}
              className="mt-1"
            />
            <span>
              I agree to receive training texts from Summitt Mindset at the phone
              number on my account.
            </span>
          </label>

          <p className="text-xs text-gray-500 mt-3">
            View our{" "}
            <a className="underline" href="/privacy" target="_blank" rel="noreferrer">
              Privacy Policy
            </a>{" "}
            and{" "}
            <a className="underline" href="/terms" target="_blank" rel="noreferrer">
              Terms
            </a>
            .
          </p>
        </div>
      </div>

      {/* Nav + continue */}
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
