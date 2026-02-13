/**
 * ======================================================
 * Clerk REST Helpers (CANONICAL)
 * ======================================================
 *
 * - Do NOT rely on Clerk server SDK helpers for metadata.
 * - Read via Clerk REST using CLERK_SECRET_KEY.
 *
 * Added:
 * - listClerkUsers() for cron scanning (needed for SMS pulse)
 */

export type ClerkUserResponse = {
  id: string;
  public_metadata?: Record<string, any>;
  private_metadata?: Record<string, any>;
  unsafe_metadata?: Record<string, any>;
};

type ClerkUserListResponse = ClerkUserResponse[];

function getClerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("Missing CLERK_SECRET_KEY");
  return key;
}

export async function getClerkUser(userId: string): Promise<ClerkUserResponse> {
  const key = getClerkSecretKey();

  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch Clerk user: ${text}`);
  }

  return (await res.json()) as ClerkUserResponse;
}

export async function getClerkPublicMetadata(
  userId: string
): Promise<Record<string, any>> {
  const user = await getClerkUser(userId);
  return user.public_metadata || {};
}

/**
 * ✅ List users (paginated) — required for cron scans
 * Clerk supports limit (max 500) + offset.
 */
export async function listClerkUsers(args?: {
  limit?: number;
  offset?: number;
}): Promise<ClerkUserResponse[]> {
  const key = getClerkSecretKey();

  const limit =
    typeof args?.limit === "number"
      ? Math.min(Math.max(args.limit, 1), 500)
      : 200;

  const offset = typeof args?.offset === "number" ? Math.max(args.offset, 0) : 0;

  const url = new URL("https://api.clerk.com/v1/users");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list Clerk users: ${text}`);
  }

  return (await res.json()) as ClerkUserListResponse;
}
