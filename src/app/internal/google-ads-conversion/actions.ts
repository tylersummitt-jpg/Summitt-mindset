"use server";

import {
  confirmOperatorGoogleAdsTrial,
  previewOperatorGoogleAdsTrial,
  type OperatorTrialView,
} from "@/lib/google-ads/stripe-conversions";
import { assertOperatorConsoleAccess } from "@/lib/operator-console-allowlist";

function subscriptionField(formData: FormData): string {
  const value = formData.get("subscriptionId");
  return typeof value === "string" ? value : "";
}

/** Operator POST only. Rendering the page does not call this. */
export async function previewOperatorGoogleAdsTrialAction(
  _previous: OperatorTrialView | null,
  formData: FormData
): Promise<OperatorTrialView> {
  await assertOperatorConsoleAccess();
  return previewOperatorGoogleAdsTrial(subscriptionField(formData));
}

/** Operator POST only. Revalidates the subscription and sends at most one trial. */
export async function confirmOperatorGoogleAdsTrialAction(
  _previous: OperatorTrialView | null,
  formData: FormData
): Promise<OperatorTrialView> {
  await assertOperatorConsoleAccess();
  return confirmOperatorGoogleAdsTrial(subscriptionField(formData));
}
