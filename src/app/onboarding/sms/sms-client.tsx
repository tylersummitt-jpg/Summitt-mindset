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

function strFromSaved(v: string | null | undefined): string {
  return typeof v === "string" ? v : "";
}

export type SmsClientInitial = {
  initialPhone?: string | null;
  initialConsentAccepted?: boolean | null;
};

export default function SmsClient({
  initialPhone,
  initialConsentAccepted,
}: SmsClientInitial = {}) {
  const router = useRouter();

  const [phoneInput, setPhoneInput] = useState(() => strFromSaved(initialPhone));
  const [consentChecked, setConsentChecked] = useState(
    () => initialConsentAccepted === true
  );

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
      <div className="border rounded-xl bg-white shadow-sm p-6 space-y-5">
        <p className="text-sm font-semibold text-gray-900 leading-snug">
          Daily accountability texts about the commitment you just chose.
        </p>

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

          <div className="flex items-start gap-3">
            <input
              id="onboarding-sms-consent"
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-1 shrink-0"
            />
            <label
              htmlFor="onboarding-sms-consent"
              className="min-w-0 flex-1 cursor-pointer text-[13px] leading-relaxed text-gray-600 sm:text-sm"
            >
              By checking this box, I agree to receive recurring membership SMS
              messages from Summitt Mindset, LLC related to my training, including
              daily practice reminders and coaching prompts. Message frequency
              varies. Msg &amp; data rates may apply. Reply STOP to opt out at any
              time. Reply HELP for help. Consent is not a condition of purchase.
              Summitt Mindset does not send marketing or promotional SMS messages
              and does not share mobile opt-in data with third parties for
              marketing purposes. Privacy:{" "}
              <a href="/privacy" className={legalLinkClass}>
                Privacy Policy
              </a>{" "}
              • Terms:{" "}
              <a href="/terms" className={legalLinkClass}>
                Terms
              </a>{" "}
              • SMS:{" "}
              <a href="/sms" className={legalLinkClass}>
                SMS Disclosure
              </a>
              .
            </label>
          </div>
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

      <div className="border-t border-gray-200 pt-8 mt-2">
        <div className="rounded-xl bg-gray-50 px-4 py-4 text-center">
          <p className="text-sm text-gray-600 italic">
            &ldquo;The absolute heart of loyalty is to value those people who tell you
            the truth, not just those people who tell you what you want to
            hear.&rdquo;
            <br />
            <span className="not-italic">— Pat Summitt</span>
          </p>
        </div>
      </div>
    </div>
  );
}
