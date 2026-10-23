"use client";

import { useActionState } from "react";
import {
  confirmOperatorGoogleAdsTrialAction,
  previewOperatorGoogleAdsTrialAction,
} from "./actions";
import type { OperatorTrialView } from "@/lib/google-ads/operator-trial-view";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(8rem,11rem)_1fr]">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="break-all text-sm text-gray-900">{value}</div>
    </div>
  );
}

function ResultView({ result }: { result: OperatorTrialView }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Result</h2>
      <div className="mt-3 space-y-2">
        <Field label="Eligibility" value={result.eligibility} />
        <Field label="Subscription" value={result.subscriptionId || "—"} />
        <Field label="Click type" value={result.clickType ?? "—"} />
        <Field label="Country" value={result.requestCountry ?? "—"} />
        <Field label="Transaction" value={result.transactionId ?? "—"} />
        <Field label="Delivery" value={result.deliveryStatus} />
        <Field label="Request ID" value={result.requestId ?? "—"} />
      </div>
    </section>
  );
}

export function GoogleAdsConversionForm() {
  const [preview, previewAction, previewPending] = useActionState(
    previewOperatorGoogleAdsTrialAction,
    null
  );
  const [confirm, confirmAction, confirmPending] = useActionState(
    confirmOperatorGoogleAdsTrialAction,
    null
  );
  const shown = confirm ?? preview;
  const canConfirm =
    confirm == null &&
    preview?.eligibility === "eligible" &&
    preview.deliveryStatus === "not_sent" &&
    preview.subscriptionId.startsWith("sub_");

  return (
    <div className="space-y-4">
      <form action={previewAction} className="space-y-3">
        <label className="block text-sm font-medium text-gray-900" htmlFor="subscriptionId">
          Stripe subscription ID
        </label>
        <input
          id="subscriptionId"
          name="subscriptionId"
          required
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />
        <button
          type="submit"
          disabled={previewPending || confirmPending}
          className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {previewPending ? "Checking" : "Preview eligibility"}
        </button>
      </form>
      {canConfirm ? (
        <form action={confirmAction}>
          <input type="hidden" name="subscriptionId" value={preview.subscriptionId} />
          <button
            type="submit"
            disabled={confirmPending}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {confirmPending ? "Sending" : "Send this trial conversion"}
          </button>
        </form>
      ) : null}
      {shown ? <ResultView result={shown} /> : null}
    </div>
  );
}
