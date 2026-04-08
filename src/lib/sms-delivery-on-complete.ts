/**
 * Layer B `sms_delivery_state` sequencing is owned by apply/flex paths after SMS send.
 * This hook remains callable after day completion for API compatibility; it does not write state.
 */
export type ReconcileSmsDeliveryStateResult =
  | { ok: true }
  | { ok: false; error: string };

export async function reconcileSmsDeliveryStateAfterCompletion(
  clerkUserId: string
): Promise<ReconcileSmsDeliveryStateResult> {
  void clerkUserId;
  return { ok: true };
}
