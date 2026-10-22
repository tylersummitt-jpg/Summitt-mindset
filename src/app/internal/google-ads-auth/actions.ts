"use server";

import { probeGoogleAdsFederation, type GoogleAdsAuthProbeResult } from "@/lib/google-ads/federation-probe";
import { assertOperatorConsoleAccess } from "@/lib/operator-console-allowlist";

/** Operator POST only. The page render does not call this. */
export async function runGoogleAdsAuthProbeAction(
  _previous: GoogleAdsAuthProbeResult | null,
  _formData: FormData
): Promise<GoogleAdsAuthProbeResult> {
  await assertOperatorConsoleAccess();
  return probeGoogleAdsFederation({ env: process.env });
}
