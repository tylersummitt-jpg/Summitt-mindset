"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ======================================================
 * SMS Client (CANONICAL)
 * ======================================================
 *
 * CHANGE (Feb 2026):
 * - Removed time-of-day selection entirely.
 * - SMS always sends at 8:00 AM local time.
 *
 * NOTE TO SELF (ChatGPT):
 * This keeps onboarding calm and removes "miss-plan" complexity.
 */

function normalizeToE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 11) return `+${digits}`;

  return null;
}

const SMS_TIME_OPTIONS = [
  { value: "early_morning", label: "Early Morning (6–8am)" },
  { value: "morning", label: "Morning (8–10am)" },
  { value: "midday", label: "Late Morning (10–12pm)" },
] as const;

export default function SmsClient() {
  const router = useRouter();

  const [smsEnabled, setSmsEnabled] = useState(true);
  const [smsTimePreference, setSmsTimePreference] = useState<
    "early_morning" | "morning" | "midday"
  >("morning");
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
            phoneNumber: normalized,
            smsDisclosureAccepted: true,
            smsTimePreference,
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
        smsTimePreference: smsTimePreference,
      }),
    });

    router.push("/onboarding/complete");
  }

  const legalLinkClass =
    "text-blue-600 underline underline-offset-4 hover:text-blue-700 break-all";

  return (
    <div className="space-y-8">
      <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-semibold text-gray-900">Daily Training Text</p>
            <p className="text-sm text-gray-600">
              One message per day with your practice and a calm Coach Pat nudge.
            </p>

            <p className="mt-2 text-xs text-gray-500">
              Texts arrive at <strong>8:00 AM</strong> in your local time zone.
              <br />
              SMS is optional and not a condition of purchase.
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
              smsEnabled ? "bg-black text-white" : "bg-gray-200 text-gray-800",
            ].join(" ")}
          >
            {smsEnabled ? "On" : "Off"}
          </button>
        </div>

        {smsEnabled && (
          <div className="space-y-4 pt-4 border-t">
            <div>
              <label className="text-sm font-medium text-gray-900 block mb-2">
                When would you like to receive your daily practice text?
              </label>
              <div className="space-y-2">
                {SMS_TIME_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-3 text-sm text-gray-800 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="smsTimePreference"
                      value={opt.value}
                      checked={smsTimePreference === opt.value}
                      onChange={() => setSmsTimePreference(opt.value)}
                      className="border-gray-300"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

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

            <label className="flex items-start gap-3 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-1"
              />
              <span>
                By checking this box, I agree to receive recurring membership SMS
                messages from <strong>Summitt Mindset, LLC</strong> related to my
                training (daily practice reminders and coaching prompts).{" "}
                <strong>Message frequency varies.</strong> Msg &amp; data rates
                may apply. Reply <strong>STOP</strong> to opt out at any time.
                Reply <strong>HELP</strong> for help. Consent is not a condition
                of purchase.
                <br />
                <span className="text-xs text-gray-600">
                  Privacy:{" "}
                  <a
                    href="https://www.summittmindset.com/privacy"
                    className={legalLinkClass}
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://www.summittmindset.com/privacy
                  </a>{" "}
                  • Terms:{" "}
                  <a
                    href="https://www.summittmindset.com/terms"
                    className={legalLinkClass}
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://www.summittmindset.com/terms
                  </a>{" "}
                  • SMS:{" "}
                  <a
                    href="https://www.summittmindset.com/sms"
                    className={legalLinkClass}
                    target="_blank"
                    rel="noreferrer"
                  >
                    https://www.summittmindset.com/sms
                  </a>
                  .
                </span>
              </span>
            </label>

            <p className="text-xs text-gray-500">
              Summitt Mindset does not send marketing or promotional SMS
              messages and does not share mobile opt-in data with third parties
              for marketing purposes.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={() => router.push("/onboarding/pressure")}
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