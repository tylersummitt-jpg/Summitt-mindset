"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function normalizeToE164(input: string): string | null {
  const digits = input.replace(/\D/g, "");

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 11) return `+${digits}`;

  return null;
}

export default function SmsClient() {
  const router = useRouter();

  const [phoneInput, setPhoneInput] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    setError(null);

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
          smsTimePreference: "morning",
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
  }

  const legalLinkClass =
    "text-blue-600 underline underline-offset-4 hover:text-blue-700 break-all";

  return (
    <div className="space-y-8">
      <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
        <div className="space-y-1.5">
          <p className="font-semibold text-gray-900">Daily accountability texts</p>
          <p className="text-sm text-gray-600 leading-relaxed">
            Coach Pat will text you about the commitment you just chose.
          </p>
          <p className="text-xs text-gray-500">
            Send time is set automatically for your time zone.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-900">Mobile Number</label>
            <input
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="(614) 555-1234"
              className="mt-2 w-full border rounded-lg p-3 text-sm"
            />
          </div>

          <label className="flex items-start gap-3 text-sm text-gray-700 leading-relaxed">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-1 shrink-0"
            />
            <span>
              By checking this box, I agree to receive recurring membership SMS
              messages from <strong>Summitt Mindset, LLC</strong> related to my
              training (daily practice reminders and coaching prompts).{" "}
              <strong>Message frequency varies.</strong>{" "}Msg &amp; data rates
              may apply. Reply <strong>STOP</strong> to opt out at any time.
              Reply <strong>HELP</strong> for help. Consent is not a condition
              of purchase.
              <br />
              <span className="text-xs text-gray-600 leading-relaxed">
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

          <p className="text-xs text-gray-500 leading-relaxed">
            Summitt Mindset does not send marketing or promotional SMS
            messages and does not share mobile opt-in data with third parties
            for marketing purposes.
          </p>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={() => router.push("/onboarding/commitment")}
          className="text-sm underline text-gray-500"
        >
          ← Back
        </button>

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

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
