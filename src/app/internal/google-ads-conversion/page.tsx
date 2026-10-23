import { GoogleAdsConversionForm } from "./form";

/**
 * TEMPORARY single-trial upload. Remove this route after the one live test.
 * Rendering the page does not read Stripe, write the ledger, or call Google.
 */
export default function GoogleAdsConversionPage() {
  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Google Ads trial conversion</h1>
        <p className="mt-1 text-sm text-gray-600">
          Sends one eligible live US trial for a Stripe subscription that already has a paid
          Google click. Automatic ingestion stays off. This page does not accept a click id.
        </p>
      </div>
      <GoogleAdsConversionForm />
    </main>
  );
}
