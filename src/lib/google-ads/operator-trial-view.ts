/** Plain result for the operator page. No click value, token, email, or IP. */
export type OperatorClickType = "gclid" | "wbraid" | "gbraid";

export type OperatorTrialView = {
  eligibility: "eligible" | "ineligible";
  subscriptionId: string;
  clickType: OperatorClickType | null;
  requestCountry: string | null;
  transactionId: string | null;
  deliveryStatus: string;
  requestId: string | null;
};
