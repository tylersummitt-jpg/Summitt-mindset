/**
 * ======================================================
 * Clerk REST Helpers (CANONICAL)
 * ======================================================
 *
 * - We do NOT rely on Clerk server SDK helpers for metadata.
 * - Read + write via Clerk REST using CLERK_SECRET_KEY.
 */

type ClerkUserResponse = {
  id: string;
  public_metadata?: Record<string, any>;
  private_metadata?: Record<string, any>;
  unsafe_metadata?: Record<string, any>;
};

function getClerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) throw new Error("Missing CLERK_SECRET_KEY");
  return key;
}

export async function getClerkUser(userId: string): Promise<ClerkUserResponse> {
  const key = getClerkSecretKey();

  const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
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
