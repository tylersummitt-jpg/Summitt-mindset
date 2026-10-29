import "server-only";

import {
  clerkUserSummittSubscribed,
  listClerkUsersByEmail,
  listClerkUsersByIds,
  type ClerkUserResponse,
} from "@/lib/clerk-rest";
import type { MembershipClearance } from "@/lib/acquisition/video-first-prep";

export type MembershipPersonHint = {
  email: string;
  clerkUserId: string | null;
  stripeSubscriptionId: string | null;
};

/**
 * Live Clerk membership for a small Instantly batch.
 * Missing Clerk credentials or a failed lookup returns null so callers mark people unverified.
 */
export async function liveMembershipByEmail(
  people: readonly MembershipPersonHint[],
): Promise<Map<string, MembershipClearance> | null> {
  if (!process.env.CLERK_SECRET_KEY?.trim()) return null;
  const result = new Map<string, MembershipClearance>();
  const byClerkId = new Map<string, string[]>();
  const needEmailLookup: string[] = [];

  for (const person of people) {
    if (person.stripeSubscriptionId) {
      result.set(person.email, "member");
      continue;
    }
    const clerkId = person.clerkUserId?.trim() || "";
    if (clerkId) {
      const emails = byClerkId.get(clerkId) ?? [];
      emails.push(person.email);
      byClerkId.set(clerkId, emails);
      continue;
    }
    needEmailLookup.push(person.email);
  }

  const clerkIds = [...byClerkId.keys()];
  for (let i = 0; i < clerkIds.length; i += 100) {
    const chunk = clerkIds.slice(i, i + 100);
    let users: ClerkUserResponse[];
    try {
      users = await listClerkUsersByIds(chunk);
    } catch {
      return null;
    }
    const found = new Set(users.map((user) => user.id));
    for (const user of users) {
      const status: MembershipClearance = clerkUserSummittSubscribed(user) ? "member" : "clear";
      for (const email of byClerkId.get(user.id) ?? []) result.set(email, status);
    }
    for (const id of chunk) {
      if (found.has(id)) continue;
      for (const email of byClerkId.get(id) ?? []) result.set(email, "clear");
    }
  }

  for (const email of needEmailLookup) {
    let users: ClerkUserResponse[];
    try {
      users = await listClerkUsersByEmail(email);
    } catch {
      return null;
    }
    if (users.some((user) => clerkUserSummittSubscribed(user))) {
      result.set(email, "member");
    } else {
      result.set(email, "clear");
    }
  }

  return result;
}
