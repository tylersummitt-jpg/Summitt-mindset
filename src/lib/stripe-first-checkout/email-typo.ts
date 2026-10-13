import { STRIPE_FIRST_RESERVED_EMAIL_METADATA } from "@/lib/stripe-first-checkout/constants";

const DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "icloud.co": "icloud.com",
};

/** Suggestion only. Unusual domains stay valid. */
export function suggestEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 1) return null;
  const domain = normalized.slice(at + 1);
  const fixed = DOMAIN_TYPOS[domain];
  if (!fixed) return null;
  const suggestion = `${normalized.slice(0, at)}@${fixed}`;
  return suggestion === normalized ? null : suggestion;
}

export function normalizeCheckoutEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function unconfirmedOnboardingEmail(user: {
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{
    id: string;
    emailAddress: string;
    verificationStatus?: string | null;
  }> | null;
}): string | null {
  const emails = user.emailAddresses ?? [];
  const primary =
    emails.find((email) => email.id === user.primaryEmailAddressId) ?? emails[0];
  if (!primary?.emailAddress) return null;
  if (primary.verificationStatus === "verified") return null;
  return primary.emailAddress;
}

/**
 * Onboarding email line for a Clerk user this checkout created.
 * Existing members and Apple subscribers do not carry the marker.
 */
export function stripeFirstOnboardingEmail(user: {
  publicMetadata?: Record<string, unknown> | null;
  primaryEmailAddressId?: string | null;
  emailAddresses?: Array<{
    id: string;
    emailAddress: string;
    verificationStatus?: string | null;
  }> | null;
}): string | null {
  if (user.publicMetadata?.[STRIPE_FIRST_RESERVED_EMAIL_METADATA] !== true) return null;
  return unconfirmedOnboardingEmail(user);
}
