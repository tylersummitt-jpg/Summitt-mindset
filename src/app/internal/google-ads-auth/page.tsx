import { GoogleAdsAuthProbeForm } from "./probe-form";

/**
 * TEMPORARY operator diagnostic. Remove this route after the production
 * authentication check. Rendering this page does not contact Google.
 */
export default function GoogleAdsAuthProbePage() {
  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Google Ads authentication</h1>
        <p className="mt-1 text-sm text-gray-600">
          Checks the production workload-identity exchange only. This page does not send a
          conversion and does not enable ingestion.
        </p>
      </div>
      <GoogleAdsAuthProbeForm />
    </main>
  );
}
