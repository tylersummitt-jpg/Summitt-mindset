import "server-only";

import Stripe from "stripe";

import { getClerkPublicMetadata } from "@/lib/clerk-rest";
import {
  getClerkIdentity,
  lookupClerkUserIdsByEmail,
  replaceClerkEmailReserved,
} from "@/lib/stripe-first-checkout/clerk-provision";
import { STRIPE_FIRST_RESERVED_EMAIL_METADATA } from "@/lib/stripe-first-checkout/constants";
import { stripeKeyMatchesLivemode } from "@/lib/stripe-first-checkout/credentials";
import { normalizeCheckoutEmail } from "@/lib/stripe-first-checkout/email-typo";
import {
  loadLatestIntentForClerkUser,
  updateIntentEmail,
} from "@/lib/stripe-first-checkout/intent-store";

export type EmailCorrectionResult =
  | { status: "updated" }
  | { status: "taken" }
  | { status: "rejected" }
  | { status: "stripe_retry" }
  | { status: "retry" };

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("missing_stripe");
  return new Stripe(key);
}

async function stripeCustomerId(clerkUserId: string): Promise<string | null> {
  const metadata = await getClerkPublicMetadata(clerkUserId);
  const fromMetadata =
    typeof metadata.stripeCustomerId === "string" ? metadata.stripeCustomerId.trim() : "";
  if (fromMetadata) return fromMetadata;
  const intent = await loadLatestIntentForClerkUser(clerkUserId);
  return intent?.stripe_customer_id ?? null;
}

/**
 * Same Clerk user. The replacement stays reserved, then Stripe Customer email follows.
 * A verified address is left alone. Another person's email is refused.
 */
export async function correctReservedCheckoutEmail(args: {
  clerkUserId: string;
  nextEmail: string;
}): Promise<EmailCorrectionResult> {
  const email = normalizeCheckoutEmail(args.nextEmail);
  if (!email) return { status: "rejected" };

  const metadata = await getClerkPublicMetadata(args.clerkUserId);
  if (metadata[STRIPE_FIRST_RESERVED_EMAIL_METADATA] !== true) {
    return { status: "rejected" };
  }

  const identity = await getClerkIdentity(args.clerkUserId);
  if (!identity) return { status: "rejected" };
  if (identity.verificationStatus === "verified") return { status: "rejected" };

  const owners = await lookupClerkUserIdsByEmail(email);
  if (owners.some((id) => id !== args.clerkUserId)) return { status: "taken" };

  if (identity.primaryEmail !== email) {
    const replaced = await replaceClerkEmailReserved({
      userId: args.clerkUserId,
      email,
    });
    if (!replaced.ok) return replaced.taken ? { status: "taken" } : { status: "retry" };
  }

  const customerId = await stripeCustomerId(args.clerkUserId);
  if (!customerId) return { status: "stripe_retry" };

  try {
    const stripe = stripeClient();
    const existing = await stripe.customers.retrieve(customerId);
    if (existing.deleted) return { status: "stripe_retry" };
    if (!stripeKeyMatchesLivemode(process.env.STRIPE_SECRET_KEY, existing.livemode)) {
      return { status: "rejected" };
    }
    const customer = await stripe.customers.update(customerId, { email });
    if (customer.email?.toLowerCase() !== email) return { status: "stripe_retry" };
  } catch (err) {
    console.error("[stripe-first] customer email sync failed", {
      reason: err instanceof Error ? err.message : "stripe_email_failed",
    });
    return { status: "stripe_retry" };
  }

  const intent = await loadLatestIntentForClerkUser(args.clerkUserId);
  if (intent && intent.stripe_customer_id === customerId) {
    await updateIntentEmail({ intentId: intent.id, email });
  }
  return { status: "updated" };
}
