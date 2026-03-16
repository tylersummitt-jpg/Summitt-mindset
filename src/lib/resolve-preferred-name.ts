import { supabaseServer } from "@/lib/supabase-server";
import { getClerkUser } from "@/lib/clerk-rest";

/**
 * Resolves the display name for user-facing coaching messages.
 * Priority: preferred_name (from onboarding) > Clerk firstName > null
 */
export function resolvePreferredName(
  preferredName: string | null | undefined,
  clerkFirstName: string | null | undefined
): string | null {
  const preferred = typeof preferredName === "string" ? preferredName.trim() : "";
  if (preferred) return preferred;

  const clerk = typeof clerkFirstName === "string" ? clerkFirstName.trim() : "";
  if (clerk) return clerk;

  return null;
}

/**
 * Fetches preferred_name and Clerk firstName, then resolves display name.
 * Returns null if neither is available.
 */
export async function getDisplayNameForUser(
  userId: string
): Promise<string | null> {
  const [profileRes, clerkUser] = await Promise.all([
    supabaseServer
      .from("user_profiles")
      .select("preferred_name")
      .eq("clerk_user_id", userId)
      .maybeSingle(),
    getClerkUser(userId).catch(() => null),
  ]);

  const preferredName = profileRes?.data?.preferred_name ?? null;
  const clerkFirstName =
    (clerkUser as any)?.first_name ?? (clerkUser as any)?.firstName ?? null;

  return resolvePreferredName(preferredName, clerkFirstName);
}
