/**
 * Public wording for the current membership offer.
 * Stripe Checkout still decides the charge, the trial, and which plan is selected.
 * A page may mention monthly or yearly. It must not present both as due together.
 */

export const MEMBERSHIP_PUBLIC_OFFER = {
  dueToday: "$0 due today",
  trial: "7-day free trial",
  monthly: "$29/month",
  annual: "$249/year",
  cancel: "Cancel anytime",
} as const;
