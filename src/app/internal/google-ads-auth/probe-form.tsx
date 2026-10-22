"use client";

import { useActionState } from "react";
import { runGoogleAdsAuthProbeAction } from "./actions";
import type { GoogleAdsAuthProbeResult } from "@/lib/google-ads/federation-probe";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(8rem,11rem)_1fr]">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm text-gray-900">{value}</div>
    </div>
  );
}

function ResultView({ result }: { result: GoogleAdsAuthProbeResult }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">Result</h2>
      <div className="mt-3 space-y-2">
        <Field label="Outcome" value={result.ok ? "Authenticated" : "Stopped"} />
        <Field label="Step" value={result.stage} />
        <Field label="Ingestion" value={result.ingestEnabled ? "enabled" : "disabled"} />
        <Field label="Issuer" value={result.issuerOk ? "matched" : "not matched"} />
        <Field label="Subject" value={result.subjectOk ? "matched" : "not matched"} />
        <Field label="Audience" value={result.audienceOk ? "matched" : "not matched"} />
        <Field label="STS" value={result.stsStatus === null ? "not called" : String(result.stsStatus)} />
        <Field
          label="Impersonation"
          value={result.impersonationStatus === null ? "not called" : String(result.impersonationStatus)}
        />
        <Field label="Token accepted" value={result.tokenAccepted ? "yes" : "no"} />
        <Field
          label="Expires in"
          value={result.expiresInSeconds === null ? "not available" : `${result.expiresInSeconds} seconds`}
        />
      </div>
    </section>
  );
}

export function GoogleAdsAuthProbeForm() {
  const [result, action, pending] = useActionState(runGoogleAdsAuthProbeAction, null);
  return (
    <form action={action} className="space-y-4">
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Checking" : "Run production check"}
      </button>
      {result ? <ResultView result={result} /> : null}
    </form>
  );
}
